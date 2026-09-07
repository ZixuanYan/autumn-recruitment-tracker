'use strict';
// ============================================================================
// ai.js — 判定归属 + 阶段 + 细节（OpenAI 兼容 /chat/completions）
// 不变量②③：值只来自邮件真实内容、禁止编造；stage 仅限 STAGE_PRESETS；
//            AI Key 只从 env 读、只发往用户自配 AI_BASE_URL，永不进 Gist/浏览器。
// 未配 AI_API_KEY 时退化为 M1 占位启发式（保证链路可跑），配了则走 M2 真实分析。
// ============================================================================

const { STAGE_PRESETS, EMAIL_TYPES, DROP_REASONS } = require('./config');

// ===== 系统提示词：拆成「可被用户整体替换的解析偏好」与「不可覆盖的输出契约」=====
//
// 为什么必须拆：契约里的字段清单/枚举/JSON 格式是下游代码的硬依赖——
// extractJson 靠「只返回 JSON」才能解析，normalizeAiResult 靠固定字段名才能归一，
// verdictOnAiResult 靠 isRecruitment 与 confidence 语义才能过滤，buildSuggestion 靠
// emailType 枚举才能分类。用户若能改这些，整条链路会**静默失效**（建议队列永远为空，
// 而 Action 仍报 success）。所以 v0.4.0 开放「整体替换提示词」时，契约段永远强制拼在最后。
//
// 拼在最后的另一个原因：大模型对末尾指令的遵循度最高，用户就算在自定义提示词里写
// 「忽略以上所有规则」，也压不过后面的契约段。
const PROMPT_OVERRIDE_MAX = 4000;
const PROMPT_EXTRA_MAX = 2000;

// 可替换部分：角色、任务与解析偏好（怎么理解邮件、summary 写多长、拒信怎么归类）
const DEFAULT_PROMPT_BODY = [
  '你是招聘邮件解析引擎。只依据用户给出的邮件内容做判断。',
  '任务：判断这封邮件是否为招聘相关，识别其类型、归属公司/岗位、对应阶段与关键细节。',
  '解析偏好：',
  '- company/position/location/round：邮件里明确出现才填，否则留空；round 如「一面」「技术面」「HR 面」等原文轮次描述。',
  '- summary：≤60 字的中文要点，概括这封邮件说了什么（如「通知 9 月 12 日 14:00 线上二面」）。',
  '- 拒信（含「遗憾」「未通过」「进入人才库」等）→ emailType「拒信」、stage 可填「已结束」、confidence 偏低。'
].join('\n');

// 不可覆盖部分：输出结构与判定口径的硬约束
const OUTPUT_CONTRACT = [
  '【输出契约 · 不可覆盖】以下要求优先于上面的任何自定义说明，必须严格遵守：',
  '1. 严格只返回一个 JSON 对象，不要 markdown、不要 ```代码围栏```、不要任何解释文字。',
  '2. JSON 必须且只能包含这些字段：isRecruitment(bool), emailType(string), company(string), position(string), stage(string), scheduleAt(string), location(string), round(string), summary(string), confidence(number 0~1)。',
  `3. emailType 只能是这些之一：${EMAIL_TYPES.join(' | ')}。非招聘邮件填「其它」且 isRecruitment=false。`,
  '4. stage 只能从用户提供的 allowedStages 数组里原样选取；无法确定就留空字符串 ""，绝不臆造或改写阶段名。',
  '5. scheduleAt：面试/笔试/测评的时间，格式必须为 "YYYY-MM-DDTHH:mm"（24 小时制，本地时间）；邮件未给出明确时间就留空 ""，不要猜测。',
  '6. confidence：这封邮件「是招聘相关邮件、且你的字段解析正确」的置信度（0~1）。注意：这不是"你对自己判断有多确定"。若判定为非招聘邮件（营销/账单/订阅/系统通知/理财推销/课程促销），必须给 <= 0.1，即使你非常确定它不是招聘邮件。',
  '7. 严禁编造任何未在邮件中出现的信息；无法确定的字段一律留空字符串。'
].join('\n');

// 完整默认提示词（保留此导出：既有测试与文档都以它为「内置提示词」的指代）
const SYSTEM_PROMPT = `${DEFAULT_PROMPT_BODY}\n\n${OUTPUT_CONTRACT}`;

// 组装本次实际生效的系统提示词。
//   promptOverride（v0.4.0）：非空则**整体替换** DEFAULT_PROMPT_BODY，用于完全定制解析行为
//   promptExtra            ：追加个性化要求（与 override 可同时使用）
//   OUTPUT_CONTRACT        ：永远拼在最后，用户无法删除
function buildSystemPrompt(promptExtra, promptOverride) {
  const override = String(promptOverride || '').trim();
  const body = override ? override.slice(0, PROMPT_OVERRIDE_MAX) : DEFAULT_PROMPT_BODY;
  const parts = [body];
  const extra = String(promptExtra || '').trim();
  if (extra) parts.push(`用户附加要求（须在不违反上述输出契约的前提下参考）：\n${extra.slice(0, PROMPT_EXTRA_MAX)}`);
  parts.push(OUTPUT_CONTRACT);
  return parts.join('\n\n');
}

function pad2(n) { return String(n).padStart(2, '0'); }

function clampConfidence(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function cleanStr(v, max) {
  const s = String(v == null ? '' : v).trim();
  return max ? s.slice(0, max) : s;
}

// emailType 归一到枚举（含中英/同义词）
function normalizeEmailType(v) {
  const s = String(v || '').trim();
  if (!s) return '其它';
  const low = s.toLowerCase();
  if (EMAIL_TYPES.includes(s)) return s;
  if (/offer|录用|意向书?|入职通知/.test(low)) return 'Offer';
  if (/拒|淘汰|遗憾|未通过|regret|reject|人才库|感谢信/.test(low)) return '拒信';
  if (/测评|评估|性格测试|在线测试|assessment/.test(low)) return '测评';
  if (/机试|机考/.test(low)) return '机试';
  if (/笔试|written/.test(low)) return '笔试';
  if (/面试|interview|面邀|复试|终面/.test(low)) return '面试邀请';
  return '其它';
}

// stage 严格校验：必须原样命中 STAGE_PRESETS，否则置空（不臆造）
function normalizeStage(v) {
  const s = String(v || '').trim();
  return STAGE_PRESETS.includes(s) ? s : '';
}

// 时间归一：返回 { scheduleAt:'YYYY-MM-DDTHH:mm'|'', scheduleDate:'YYYY-MM-DD'|'' }
function normalizeScheduleAt(v) {
  const s = String(v || '').trim();
  if (!s) return { scheduleAt: '', scheduleDate: '' };
  const dt = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})[T\s]+(\d{1,2}):(\d{2})/);
  if (dt) {
    const date = `${dt[1]}-${pad2(dt[2])}-${pad2(dt[3])}`;
    return { scheduleAt: `${date}T${pad2(dt[4])}:${dt[5]}`, scheduleDate: date };
  }
  const d = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (d) return { scheduleAt: '', scheduleDate: `${d[1]}-${pad2(d[2])}-${pad2(d[3])}` };
  const cn = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?(?:\s*(\d{1,2})\s*[:：时]\s*(\d{2})?)?/);
  if (cn) {
    const date = `${cn[1]}-${pad2(cn[2])}-${pad2(cn[3])}`;
    const scheduleAt = cn[4] && cn[5] ? `${date}T${pad2(cn[4])}:${cn[5]}` : '';
    return { scheduleAt, scheduleDate: date };
  }
  return { scheduleAt: '', scheduleDate: '' };
}

function receivedDate(mail) {
  const iso = String((mail && mail.receivedAt) || '');
  const m = iso.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

const NEXT_ACTION_BY_TYPE = {
  面试邀请: '按时参加面试，提前测试设备或规划路线',
  笔试: '按时参加笔试，提前调试环境',
  机试: '按时参加机试，确认平台与账号',
  测评: '在截止时间前完成在线测评',
  Offer: '核对 Offer 细节并按时回复确认',
  拒信: '记录结果，继续推进其他机会',
  其它: '查看邮件原文并按需跟进'
};

// 由归一结果生成 proposed（网页端逐字段勾选应用的来源）
function buildProposed(n, mail) {
  const at = n.scheduleDate || receivedDate(mail);
  const timePart = n.scheduleAt ? n.scheduleAt.replace('T', ' ') : (n.scheduleDate || '');
  const recentSchedule = [n.round, timePart, n.location].filter(Boolean).join(' · ').slice(0, 100);
  return {
    // 里程碑备注：这条会被用户勾选后**永久写进台账时间线**，所以要有信息量。
    // emailType 为「其它」时改用 AI 写的 summary —— 实测「其它」覆盖了投递确认/宣讲会/系统认证
    // 等一大类邮件，显示成「邮件·其它」等于什么都没说，而同一封邮件的 summary 是
    // 「简历成功投递滴滴校招，等待后续流程推进」这种三个月后回看仍有用的内容。
    // 其余类型（测评/笔试/面试邀请/Offer/拒信）本身已足够明确且更短，保留类型名便于扫读。
    milestone: { stage: n.stage, at, note: milestoneNote(n) },
    scheduleAt: n.scheduleAt,
    recentSchedule,
    nextAction: NEXT_ACTION_BY_TYPE[n.emailType] || '查看邮件原文并按需跟进'
  };
}

// 里程碑备注文本（纯函数，便于单测）。「邮件·」前缀 + 类型名或 summary，整体截到 48 字。
function milestoneNote(n) {
  const type = String((n && n.emailType) || '其它');
  const summary = String((n && n.summary) || '').trim();
  const body = (type === '其它' && summary) ? summary : type;
  return `邮件·${body}`.slice(0, 48);
}

// 校验/钳制 AI 原始输出 → 最终结果对象（纯函数，可单测）
function normalizeAiResult(raw, mail) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const emailType = normalizeEmailType(r.emailType);
  const sched = normalizeScheduleAt(r.scheduleAt);
  const n = {
    // 缺省视为相关：AI 未返回该字段时不丢弃（预筛已滤掉确定性垃圾，且漏掉真面邀不可逆）。
    // 只有 AI **明确**返回 false 才判为非招聘 —— index.js 会据此丢弃并计入 meta.lastDropped.aiNotRecruit。
    // v4.6.1 之前这个字段被归一了却从未被任何代码检查，导致 AI 判定的营销邮件照样入库
    // （实测 10 条建议里 3 条是汇丰存款/恒生信用卡/理财峰会这类纯营销，emailType 全为「其它」）。
    isRecruitment: r.isRecruitment !== false,
    emailType,
    company: cleanStr(r.company, 60),
    position: cleanStr(r.position, 80),
    stage: normalizeStage(r.stage),
    scheduleAt: sched.scheduleAt,
    scheduleDate: sched.scheduleDate,
    location: cleanStr(r.location, 60),
    round: cleanStr(r.round, 20),
    summary: cleanStr(r.summary, 60),
    confidence: clampConfidence(r.confidence)
  };
  n.proposed = buildProposed(n, mail);
  return n;
}

// AI 结果是否可入库（纯函数，便于单测）。两道判定：
//   ① AI 明确返回 isRecruitment=false → 丢（ai-not-recruit）
//   ② 置信度低于 MIN_CONFIDENCE      → 丢（low-conf）
// ①在 v4.6.1 之前完全不存在：字段被 prompt 要求返回、被 normalizeAiResult 归一，
// 却没有任何代码检查它，导致 AI 判定为营销的邮件照样入库（实测 10 条里 3 条是纯营销）。
function verdictOnAiResult(result, minConfidence) {
  if (!result || typeof result !== 'object') return { accept: false, reason: DROP_REASONS.AI_NOT_RECRUIT };
  if (result.isRecruitment === false) return { accept: false, reason: DROP_REASONS.AI_NOT_RECRUIT };
  if (Number(result.confidence) < Number(minConfidence)) return { accept: false, reason: DROP_REASONS.LOW_CONF };
  return { accept: true, reason: '' };
}

// 去掉 ```json 围栏，截取首个 { 到末个 } 后 JSON.parse
function extractJson(content) {
  let s = String(content || '').trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('AI 返回内容中未找到 JSON 对象');
  return JSON.parse(s.slice(start, end + 1));
}

function buildUserContent(mail) {
  return JSON.stringify({
    allowedStages: STAGE_PRESETS,
    allowedEmailTypes: EMAIL_TYPES,
    email: {
      from: mail.from || '',
      fromName: mail.fromName || '',
      subject: mail.subject || '',
      receivedAt: mail.receivedAt || '',
      body: String(mail.textBody || '').slice(0, 8000) // 与 parse.js 的 MAX_BODY 对齐
    }
  });
}

async function aiAnalyze(mail, cfg, useResponseFormat, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  const url = `${String(cfg.ai.baseUrl).replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: cfg.ai.model,
    temperature: 0,
    messages: [
      { role: 'system', content: buildSystemPrompt(cfg.promptExtra, cfg.promptOverride) },
      { role: 'user', content: buildUserContent(mail) }
    ]
  };
  if (useResponseFormat) body.response_format = { type: 'json_object' };
  let res;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.ai.apiKey}` },
      body: JSON.stringify(body)
    });
  } catch (e) {
    // 网络层失败时 e.message 只有笼统的 "fetch failed"，真正的原因（DNS 解析不到 /
    // 连接被拒 / TLS 证书 / 超时）在 e.cause 里。不带上它，用户在网页端看到的就是
    // 一句无法据以排查的 "AI 分析失败 6/6 封：fetch failed"（实测踩过：百炼专属端点
    // 从 GitHub runner 持续不可达，但日志给不出任何可行动的线索）。
    const cause = e && e.cause
      ? ` | cause: ${(e.cause.code || '')} ${(e.cause.message || e.cause)}`.trim()
      : '';
    throw new Error(`${e.message}${cause}（端点 ${url}）`);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch (_) {}
    throw new Error(`AI 接口 HTTP ${res.status}${detail ? `：${detail}` : ''}`);
  }
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('AI 返回为空');
  return extractJson(content);
}

// M1 占位启发式：无 AI Key 时用，保证链路可跑（company 从发件名/域名粗提取，stage 留空）
function placeholderAnalyze(mail) {
  const company = guessCompany(mail);
  const n = {
    isRecruitment: true,
    emailType: '其它',
    company,
    position: '',
    stage: '',
    scheduleAt: '',
    scheduleDate: '',
    location: '',
    round: '',
    summary: cleanStr(mail.subject, 60) || '（占位）未配置 AI，仅粗提取',
    confidence: 0
  };
  n.proposed = buildProposed(n, mail);
  return n;
}

function guessCompany(mail) {
  const name = cleanStr(mail.fromName, 40);
  if (name && !/@/.test(name) && name.length >= 2) return name;
  const addr = String(mail.from || '');
  const domain = addr.includes('@') ? addr.split('@').pop() : '';
  if (!domain) return '';
  const label = domain.split('.').slice(-2, -1)[0] || domain.split('.')[0] || '';
  return cleanStr(label, 40);
}

// 对外主入口：无 Key→占位；有 Key→真实分析（失败重试 1 次，第 2 次去掉 response_format）
async function analyzeEmail(mail, cfg, fetchImpl) {
  if (!cfg.ai.apiKey || !cfg.ai.baseUrl) return placeholderAnalyze(mail);
  let raw;
  try {
    raw = await aiAnalyze(mail, cfg, true, fetchImpl);
  } catch (_) {
    raw = await aiAnalyze(mail, cfg, false, fetchImpl); // 重试 1 次；仍失败则抛出交上层记 lastError
  }
  return normalizeAiResult(raw, mail);
}

module.exports = {
  SYSTEM_PROMPT,
  DEFAULT_PROMPT_BODY,
  OUTPUT_CONTRACT,
  PROMPT_OVERRIDE_MAX,
  PROMPT_EXTRA_MAX,
  buildSystemPrompt,
  analyzeEmail,
  aiAnalyze,
  placeholderAnalyze,
  normalizeAiResult,
  verdictOnAiResult,
  normalizeEmailType,
  normalizeStage,
  normalizeScheduleAt,
  buildProposed,
  milestoneNote,
  extractJson,
  guessCompany
};
