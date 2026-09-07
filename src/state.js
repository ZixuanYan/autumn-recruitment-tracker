'use strict';
// ============================================================================
// state.js — 建议文件的状态管理：高水位、suggestions 合并/去重/prune、meta 组装
// 全部为纯函数，便于本地单测（不触网、不依赖 imapflow/mailparser）。
// ============================================================================

const PRUNE_DAYS = 30;
const PRUNE_MAX = 100;

// ===== 丢弃可观测性（v4.6.1）=====
// 修复前 index.js 是 `if (!isCandidate(mail, kw)) continue;` —— 无日志、无计数、meta 不记录。
// 实测某次运行「抓取 17 封 → 候选 3」，那 14 封为什么被丢、发件人是谁，用户完全无从查证，
// 只能靠"感觉没拉到"来怀疑。现在每封被丢的邮件都有原因、有计数、有明细。
//
// reason → meta.lastDropped 字段名。字面量与 prefilter.js 的 DROP_REASONS 一一对应，
// 网页端 describeDropReason 也用同一套 reason 值做中文映射。
const DROP_REASON_FIELDS = {
  'noise-from': 'noiseFrom',
  'noise-subject': 'noiseSubject',
  'no-keyword': 'noKeyword',
  'ai-not-recruit': 'aiNotRecruit',
  'low-conf': 'lowConf',
  'ai-error': 'aiError'
};
// meta 里保留的明细条数上限（约 3KB）。全量收集后按 uid 倒序取前 N 条，
// 这样留下的是「最新被丢的」而不是「最旧被丢的」。
const DROP_RECENT_MAX = 20;

function emptyDropCounts() {
  return { noiseFrom: 0, noiseSubject: 0, noKeyword: 0, aiNotRecruit: 0, lowConf: 0, aiError: 0 };
}

// 丢弃收集器：note(mail, reason) 累加，summary() 产出可直接塞进 meta.lastDropped 的对象。
// onDrop 回调用于打日志（把 I/O 留在调用方，本函数保持纯粹可测）。
function createDropTracker(onDrop) {
  const counts = emptyDropCounts();
  const recent = [];
  return {
    note(mail, reason) {
      const field = DROP_REASON_FIELDS[reason];
      if (field) counts[field] += 1;
      recent.push({
        uid: Number(mail && mail.sourceUid) || 0,
        from: String((mail && mail.from) || '').slice(0, 80),
        subject: String((mail && mail.subject) || '').slice(0, 60),
        reason: String(reason || '')
      });
      if (typeof onDrop === 'function') onDrop(mail, reason);
    },
    summary() {
      const total = Object.keys(counts).reduce((sum, key) => sum + counts[key], 0);
      return {
        total,
        ...counts,
        recent: recent.slice().sort((a, b) => b.uid - a.uid).slice(0, DROP_RECENT_MAX)
      };
    }
  };
}

// 高水位：推进到本次「已抓取」的最大 UID（不论是否候选），避免非候选邮件被反复重扫。
// UIDVALIDITY 变化时以当前邮箱的 uidValidity 为准（水位随之重置）。
function computeWatermark(mailbox, fetchedUids, prevMeta) {
  const uidValidity = Number(mailbox && mailbox.uidValidity) || 0;
  let lastUid = Number(prevMeta && prevMeta.lastUid) || 0;
  for (const uid of (fetchedUids || [])) {
    const n = Number(uid) || 0;
    if (n > lastUid) lastUid = n;
  }
  return { lastUidValidity: uidValidity, lastUid };
}

// 由邮件 + AI/占位结果组装一条建议（契约见计划文件「建议文件契约」）
function buildSuggestion(mail, result) {
  const r = result || {};
  return {
    id: `uid-${mail.sourceUid}`,
    sourceUid: Number(mail.sourceUid) || 0,
    receivedAt: mail.receivedAt || '',
    from: mail.from || '',
    subject: mail.subject || '',
    emailType: r.emailType || '其它',
    // AI 的招聘相关性判定，落盘备查（网页端不读它，纯附加字段）。
    // 能进到这里的一律是 true —— index.js 已在 AI 返回 false 时丢弃该邮件；
    // 保留此字段是为了日后审计"已入库的建议当时 AI 是怎么判的"。
    isRecruitment: r.isRecruitment !== false,
    company: r.company || '',
    position: r.position || '',
    stage: r.stage || '',
    scheduleAt: r.scheduleAt || '',
    location: r.location || '',
    round: r.round || '',
    summary: r.summary || '',
    confidence: Number.isFinite(Number(r.confidence)) ? Number(r.confidence) : 0,
    proposed: r.proposed || { milestone: { stage: '', at: '', note: '' }, scheduleAt: '', recentSchedule: '', nextAction: '' }
  };
}

// prune：近 PRUNE_DAYS 天、按 receivedAt 倒序、最多 PRUNE_MAX 条
function pruneSuggestions(list) {
  const cutoff = Date.now() - PRUNE_DAYS * 86400000;
  return (Array.isArray(list) ? list : [])
    .filter(s => {
      const t = Date.parse(s && s.receivedAt || '');
      return !Number.isFinite(t) || t >= cutoff; // 无法判定时间的保守保留
    })
    .sort((a, b) => (Date.parse(b.receivedAt || '') || 0) - (Date.parse(a.receivedAt || '') || 0))
    .slice(0, PRUNE_MAX);
}

// 合并：按 sourceUid 去重（同一封以本次结果覆盖旧结果），保留 id 稳定（uid-<sourceUid>），
// 这样网页端 appliedIds/dismissedIds（按 id）在建议被重新分析后依然生效。
//
// scannedUids（v4.6.1）：本次实际扫描过的 UID 集合，用于「重扫即重新裁决」——
//   prev 中 uid ∈ scannedUids 但 ∉ incoming → 删除（本轮重新判定后认为它不该在队列里）；
//   prev 中 uid ∉ scannedUids            → 保留（本轮没扫到，不对它下任何结论）。
// 没有这个参数时，用 UID_FROM 回溯重扫只能新增建议、无法纠正已入库的错误建议
// （实测有 3 条纯营销邮件已在队列里，重扫后仍会留着）。
// 常规增量运行时 scannedUids 就是本轮抓取的全部 UID，语义自然一致。
function mergeSuggestions(prevList, incoming, scannedUids) {
  const scanned = new Set((Array.isArray(scannedUids) ? scannedUids : []).map(n => Number(n) || 0).filter(Boolean));
  const incomingUids = new Set(
    (Array.isArray(incoming) ? incoming : []).map(s => Number(s && s.sourceUid) || 0).filter(Boolean)
  );
  const byUid = new Map();
  for (const s of (Array.isArray(prevList) ? prevList : [])) {
    const uid = Number(s && s.sourceUid) || 0;
    if (!uid) continue;
    // 本轮扫过、但重新裁决后没入选 → 丢弃旧条目
    if (scanned.size && scanned.has(uid) && !incomingUids.has(uid)) continue;
    byUid.set(uid, s);
  }
  for (const s of (Array.isArray(incoming) ? incoming : [])) {
    const uid = Number(s && s.sourceUid) || 0;
    if (uid) byUid.set(uid, s); // 覆盖
  }
  return pruneSuggestions([...byUid.values()]);
}

function buildMeta({ prevMeta, watermark, status, lastError, newCount, pendingCount, lastDropped, promptSnapshot }) {
  // 丢弃统计：本轮有传入就用本轮的；没传（如 --report-error 兜底路径，本轮数据不可信）则保留旧值，
  // 避免硬崩溃时把上一次的诊断信息抹成空。老文件没有该字段时补一份全 0 结构，保证网页端读到的形状稳定。
  const dropped = (lastDropped && typeof lastDropped === 'object')
    ? lastDropped
    : ((prevMeta && prevMeta.lastDropped && typeof prevMeta.lastDropped === 'object')
      ? prevMeta.lastDropped
      : { ...emptyDropCounts(), total: 0, recent: [] });
  return {
    version: 1,
    lastRunAt: new Date().toISOString(),
    lastStatus: status === 'error' ? 'error' : 'ok',
    lastError: status === 'error' ? String(lastError || '同步失败') : '',
    lastUidValidity: Number(watermark && watermark.lastUidValidity) || Number(prevMeta && prevMeta.lastUidValidity) || 0,
    lastUid: Number(watermark && watermark.lastUid) || Number(prevMeta && prevMeta.lastUid) || 0,
    newCount: Number(newCount) || 0,
    pendingCount: Number(pendingCount) || 0,
    lastDropped: dropped,
    // 本次**实际生效**的系统提示词全文（内置或用户 override 的解析偏好 + 附加要求 + 强制契约段）。
    // 网页端设置面板只读展示的就是它——展示真实生效的那一份，而不是前端硬编码的副本，
    // 否则 Action 改了提示词后前端展示的就是错的（这类漂移无法被任何测试发现）。
    // 未传时（--report-error 兜底）保留上一次的值；上限 8000 字防止 Gist 文件膨胀。
    promptSnapshot: String(promptSnapshot || (prevMeta && prevMeta.promptSnapshot) || '').slice(0, 8000)
  };
}

module.exports = {
  PRUNE_DAYS,
  PRUNE_MAX,
  DROP_REASON_FIELDS,
  DROP_RECENT_MAX,
  emptyDropCounts,
  createDropTracker,
  computeWatermark,
  buildSuggestion,
  pruneSuggestions,
  mergeSuggestions,
  buildMeta
};
