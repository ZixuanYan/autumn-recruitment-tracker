'use strict';
// ============================================================================
// imap.js — 连接（复用 M0 的 ID 命令）+ 增量抓取
// 增量策略：从 Gist 读回的 meta.lastUidValidity/lastUid 决定起点；
//   UIDVALIDITY 变化（邮箱重建）→ 回退到 SINCE_DAYS 全量重扫并重置水位；
//   否则按 UID 增量抓取 (lastUid+1):*，上限 MAX_PER_RUN。
// 抓取内容：ENVELOPE + BODY.PEEK[]（source），internalDate 作时间兜底。
// ============================================================================

const { ImapFlow } = require('imapflow');

function createClient(cfg) {
  return new ImapFlow({
    host: cfg.imap.host,
    port: cfg.imap.port,
    secure: true,
    auth: { user: cfg.imap.user, pass: cfg.imap.pass },
    clientInfo: cfg.imap.clientInfo, // 触发 RFC2971 ID，破 QQ 'Unsafe Login'
    logger: false,
    connectionTimeout: 30000,
    greetingTimeout: 20000,
    socketTimeout: 120000
  });
}

// 打开 INBOX 并持锁；返回 { client, lock, mailbox }
async function openInbox(cfg) {
  const client = createClient(cfg);
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  return { client, lock, mailbox: client.mailbox || {} };
}

async function closeInbox(client, lock) {
  if (lock) { try { lock.release(); } catch (_) {} }
  if (client) { try { await client.logout(); } catch (_) { try { client.close(); } catch (__) {} } }
}

// 依据旧水位与当前 UIDVALIDITY 规划本次抓取方式（纯函数，便于单测）
// uidFrom > 0（手动 dispatch 传入）时强制从该 UID 重扫，忽略水位与 UIDVALIDITY 判定：
// 这是唯一的回溯手段——被噪声规则误杀的邮件，水位已经推过它们，常规增量运行永远不会再回看。
function planFetch(mailbox, meta, sinceDays, uidFrom) {
  const uidValidity = Number(mailbox && mailbox.uidValidity) || 0;
  const forced = Number(uidFrom) || 0;
  if (forced > 0) return { mode: 'uid', startUid: forced, uidValidity, forced: true, resetWatermark: false };
  const lastValidity = Number(meta && meta.lastUidValidity) || 0;
  const lastUid = Number(meta && meta.lastUid) || 0;
  const validityChanged = Boolean(lastValidity && uidValidity && lastValidity !== uidValidity);
  // 首次运行（无水位）或 UIDVALIDITY 变化 → 按日期窗口全量重扫
  if (!lastUid || validityChanged) {
    const since = new Date(Date.now() - (Number(sinceDays) || 30) * 86400000);
    return { mode: 'since', since, resetWatermark: validityChanged, uidValidity, forced: false };
  }
  return { mode: 'uid', startUid: lastUid + 1, uidValidity, forced: false, resetWatermark: false };
}

// 执行抓取，返回原始消息数组（含 source Buffer）。绝不在 fetch 循环内发其他 IMAP 命令。
async function fetchMessages(client, plan, maxPerRun) {
  const cap = Number(maxPerRun) > 0 ? Number(maxPerRun) : 30;
  const query = { uid: true, envelope: true, source: true, internalDate: true };
  const out = [];
  if (plan.mode === 'uid') {
    // (startUid):* —— 当 startUid 超过最大 UID 时，IMAP 会返回最大 UID 那封，
    // 用 msg.uid < startUid 过滤即可安全得到空集（不依赖 uidNext）。
    for await (const msg of client.fetch(`${plan.startUid}:*`, query, { uid: true })) {
      if (Number(msg.uid) < plan.startUid) continue;
      out.push(msg);
      if (out.length >= cap) break;
    }
  } else {
    // 日期窗口全量（SINCE）：SearchObject { since: Date }
    for await (const msg of client.fetch({ since: plan.since }, query)) {
      out.push(msg);
      if (out.length >= cap) break;
    }
  }
  return out;
}

module.exports = { createClient, openInbox, closeInbox, planFetch, fetchMessages };
