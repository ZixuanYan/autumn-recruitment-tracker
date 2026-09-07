'use strict';
// ============================================================================
// index.js — 编排：连接 → 读水位 → 增量 fetch → 预筛 → 解析 → AI → 合并 → 写 meta → PATCH
// 两种模式：
//   node index.js                正常同步
//   node index.js --report-error 兜底：仅把 meta 标记为 error（保留已有 suggestions/水位），
//                                供 workflow `if: failure()` 步骤在硬崩溃后调用。
// 失败策略：
//   硬失败（连接/抓取/Gist/密钥缺失）→ 尽力写 error meta（保留旧 suggestions+旧水位）→ 退出码 1；
//   软失败（部分 AI 调用失败）→ 正常写建议与水位，meta.lastStatus='error'+lastError 上屏 → 退出码 0。
// ============================================================================

const { buildConfig, keywordRegex, applyMailConfigOverrides, gateReason, MAIL_CONFIG_FILENAME } = require('./src/config');
const { openInbox, closeInbox, planFetch, fetchMessages } = require('./src/imap');
const { classifyMail, DROP_REASONS } = require('./src/prefilter');
const { parseMessage } = require('./src/parse');
const { computeWatermark, buildSuggestion, mergeSuggestions, buildMeta, createDropTracker } = require('./src/state');
const { gistGet, readMailFile, patchMailFile } = require('./src/gist');
const { analyzeEmail, verdictOnAiResult } = require('./src/ai');

function assertGistSecrets(cfg) {
  const missing = [];
  if (!cfg.gist.id) missing.push('GIST_ID');
  if (!cfg.gist.token) missing.push('GIST_PAT');
  if (missing.length) throw new Error(`缺少必需 Secrets：${missing.join(', ')}`);
}
function assertImapSecrets(cfg) {
  const missing = [];
  if (!cfg.imap.user) missing.push('QQ_EMAIL');
  if (!cfg.imap.pass) missing.push('QQ_AUTHCODE');
  if (missing.length) throw new Error(`缺少必需 Secrets：${missing.join(', ')}`);
}

// 读一次 Gist：取回 mail-config.json（明文）与已有 mail-suggestions.json（可能加密）
async function loadGistState(cfg) {
  const gist = await gistGet(cfg);
  const mailConfig = await readMailFile(gist, MAIL_CONFIG_FILENAME); // 明文，不传 encKey
  const prevFile = await readMailFile(gist, cfg.gist.filename, cfg.mailEncKey);
  return {
    mailConfig,
    prev: {
      meta: (prevFile && prevFile.meta && typeof prevFile.meta === 'object') ? prevFile.meta : {},
      suggestions: (prevFile && Array.isArray(prevFile.suggestions)) ? prevFile.suggestions : []
    }
  };
}

async function loadPrev(cfg) {
  const { prev } = await loadGistState(cfg);
  return prev;
}

// 尽力写 error meta：保留旧 suggestions 与旧水位（本轮不可信）
async function writeErrorMeta(cfg, message) {
  try {
    const prev = await loadPrev(cfg);
    const meta = buildMeta({
      prevMeta: prev.meta,
      watermark: { lastUidValidity: Number(prev.meta.lastUidValidity) || 0, lastUid: Number(prev.meta.lastUid) || 0 },
      status: 'error',
      lastError: message,
      newCount: 0,
      pendingCount: prev.suggestions.length
    });
    await patchMailFile(cfg, { meta, suggestions: prev.suggestions });
    console.log(`[sync] 已把失败原因写入 meta.lastError：${message}`);
  } catch (e) {
    console.error(`[sync] 兜底写 error meta 也失败（Gist 不可达？）：${e.message}`);
  }
}

async function run() {
  const cfg0 = buildConfig();
  assertGistSecrets(cfg0);

  const { mailConfig, prev } = await loadGistState(cfg0);
  const cfg = applyMailConfigOverrides(cfg0, mailConfig);
  console.log(`[sync] 配置：enabled=${cfg.enabled} minIntervalHours=${cfg.minIntervalHours} keywords="${cfg.keywords}" minConf=${cfg.minConfidence} sinceDays=${cfg.sinceDays} maxPerRun=${cfg.maxPerRun} enc=${cfg.mailEncKey ? 'on' : 'off'} promptExtra=${cfg.promptExtra ? 'yes' : 'no'}`);

  const skip = gateReason(cfg, prev.meta);
  if (skip) { console.log(`[sync] ⏭️ 跳过本次（0 token）：${skip}`); return; }

  assertImapSecrets(cfg);
  console.log(`[sync] 读回水位 lastUid=${prev.meta.lastUid || 0} uidValidity=${prev.meta.lastUidValidity || 0}，已有建议 ${prev.suggestions.length} 条`);

  const { client, lock, mailbox } = await openInbox(cfg);
  let fetched = [];
  const incoming = [];
  let candidates = 0;
  let aiErrors = 0;
  let lastAiError = '';
  // 丢弃收集器：每封被丢的邮件都逐条打日志（只进 Actions 日志），汇总写进 meta.lastDropped（进 Gist、网页端可展开）。
  // 修复前这里是静默 continue，用户只能靠"感觉没拉到"来怀疑漏了邮件。
  const drops = createDropTracker((mail, reason) => {
    console.log(`[sync] 丢弃 uid=${mail.sourceUid} reason=${reason} from=${mail.from || '-'} subj=${String(mail.subject || '').slice(0, 60)}`);
  });

  try {
    const plan = planFetch(mailbox, prev.meta, cfg.sinceDays, cfg.uidFrom);
    console.log(`[sync] 抓取模式=${plan.mode}${plan.mode === 'uid' ? ` startUid=${plan.startUid}` : ` since=${plan.since.toISOString()}`}${plan.forced ? '（UID_FROM 强制回溯：已忽略云端水位）' : ''}${plan.resetWatermark ? '（UIDVALIDITY 变化→重置水位）' : ''}`);
    fetched = await fetchMessages(client, plan, cfg.maxPerRun);
    console.log(`[sync] 本次抓取 ${fetched.length} 封（上限 ${cfg.maxPerRun}），INBOX exists=${mailbox.exists}`);

    const kw = keywordRegex(cfg.keywords);
    // 已成功完成裁决的 UID（预筛判定 或 AI 判定，无论结论是入选还是丢弃）。
    //
    // 为什么不能用「本轮抓取的全部 UID」：AI 调用失败（fetch failed / 超时 / 超额）属于
    // **未能裁决**，不是「裁决为不该在队列里」。用抓取全集会让 AI 抖动时把已有的正确建议删掉——
    // 实测过一次：回溯重扫 20 封时百炼端点 6/6 全部 fetch failed，incoming=0，
    // 于是 uid 1881/1885/1887 三条已有建议（含招行素质测评通知 conf=0.98）被"重新裁决"删除，
    // 建议从 10 条掉到 7 条。AI 失败的邮件必须保留旧建议，等下次运行重试。
    const adjudicated = new Set();
    for (const msg of fetched) {
      const mail = await parseMessage(msg);
      const verdict = classifyMail(mail, kw);
      if (!verdict.pass) {
        drops.note(mail, verdict.reason);
        // 预筛丢弃是明确的裁决结论（规则变了就该按新规则清掉旧建议），计入已裁决
        if (mail.sourceUid) adjudicated.add(mail.sourceUid);
        continue;
      }
      candidates += 1;
      let result;
      try {
        result = await analyzeEmail(mail, cfg);
      } catch (e) {
        aiErrors += 1;
        lastAiError = e.message;
        drops.note(mail, DROP_REASONS.AI_ERROR);
        console.warn(`[sync] AI 分析失败 uid=${mail.sourceUid}：${e.message}`);
        continue; // 刻意不计入 adjudicated：本轮未能裁决，保留已有建议
      }
      if (mail.sourceUid) adjudicated.add(mail.sourceUid);
      // AI 结果的两道过滤（isRecruitment + 置信度）统一走 ai.verdictOnAiResult，
      // 判定逻辑只有一处、可单测。isRecruitment 那道在 v4.6.1 之前完全不存在：
      // 字段被 prompt 要求返回、被 normalizeAiResult 归一，却没有任何代码检查它，
      // 导致纯营销邮件照样入库（实测 10 条建议里 3 条是汇丰存款/恒生信用卡/理财峰会）。
      const aiVerdict = verdictOnAiResult(result, cfg.minConfidence);
      if (!aiVerdict.accept) {
        drops.note(mail, aiVerdict.reason);
        if (aiVerdict.reason === DROP_REASONS.LOW_CONF) {
          console.log(`[sync] 丢弃低置信 uid=${mail.sourceUid} conf=${result.confidence} < ${cfg.minConfidence}`);
        } else {
          console.log(`[sync] 丢弃 AI 判非招聘 uid=${mail.sourceUid} type=${result.emailType} conf=${result.confidence}`);
        }
        continue;
      }
      incoming.push(buildSuggestion(mail, result));
    }
  } finally {
    await closeInbox(client, lock);
  }

  const dropped = drops.summary();
  // 「重扫即重新裁决」只作用于**成功裁决过**的 UID：本轮扫过且判定为不该入队的旧建议会被移除
  // （这样 UID_FROM 回溯才能纠正已入库的营销邮件）；AI 失败而未能裁决的一律保留旧建议。
  const merged = mergeSuggestions(prev.suggestions, incoming, [...adjudicated]);
  const watermark = computeWatermark(mailbox, fetched.map(m => m.uid), prev.meta);
  const softError = aiErrors > 0;
  const meta = buildMeta({
    prevMeta: prev.meta,
    watermark,
    status: softError ? 'error' : 'ok',
    lastError: softError ? `AI 分析失败 ${aiErrors}/${candidates} 封：${lastAiError}` : '',
    newCount: incoming.length,
    pendingCount: merged.length,
    lastDropped: dropped
  });

  await patchMailFile(cfg, { meta, suggestions: merged });
  console.log(`[sync] ✅ 完成：候选 ${candidates}，新增/更新 ${incoming.length}，合并后 ${merged.length} 条，lastUid→${meta.lastUid}，lastStatus=${meta.lastStatus}`);
  console.log(`[sync] 丢弃 ${dropped.total} 封：噪声发件人 ${dropped.noiseFrom} / 营销主题 ${dropped.noiseSubject} / 无关键词 ${dropped.noKeyword} / AI判非招聘 ${dropped.aiNotRecruit} / 低置信 ${dropped.lowConf} / AI失败 ${dropped.aiError}`);
  if (softError) console.warn('[sync] ⚠️ 存在 AI 软失败，已写入 meta.lastError（网页端会上屏提示），本轮抓取/水位正常。');
}

async function reportError() {
  const cfg = buildConfig();
  if (!cfg.gist.id || !cfg.gist.token) {
    console.error('[sync] 无法兜底：缺少 GIST_ID / GIST_PAT');
    process.exitCode = 1;
    return;
  }
  const message = process.env.MAIL_SYNC_ERROR || '邮件同步失败，请查看本次 Action 日志（常见原因：QQ 授权码失效 / AI 超额 / IMAP 被风控）';
  await writeErrorMeta(cfg, message);
}

async function main() {
  const args = process.argv.slice(2);
  try {
    if (args.includes('--report-error')) await reportError();
    else await run();
  } catch (err) {
    const message = String((err && err.message) || err);
    console.error(`[sync] ❌ 硬失败：${message}`);
    // 尽力把失败原因上屏（保留旧建议与旧水位）
    const cfg = buildConfig();
    if (cfg.gist.id && cfg.gist.token) await writeErrorMeta(cfg, message);
    process.exitCode = 1;
  }
}

main();
