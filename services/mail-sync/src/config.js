'use strict';
// ============================================================================
// config.js — 唯一配置入口：读 env（由 workflow 从 Secrets / dispatch 输入注入）
// 不变量③：密钥只从环境变量读，永不写盘、永不进 Gist 建议文件、永不进浏览器。
// ============================================================================

// 单一事实源：14 个阶段值来自仓库根 shared/stages.js，与网页版 index.html、浏览器插件同源——
// 此前这里是一份独立字面量，靠注释「必须与网页端完全一致」维持；谁改了网页版忘了改这里，
// AI 就会把「交叉面」判成非法阶段而**静默置空**（邮件照样入库，只是阶段字段没了）。
//
// 路径与可移植性——同步到独立仓库时必须一并处理，否则 Action 起不来：
// 1. 本文件在 monorepo 的 services/mail-sync/src/（深三层），回到仓库根 shared/ 需要**三个** ../；
//    写成 ../../shared/stages 只到 services/shared/，MODULE_NOT_FOUND。
// 2. 但**独立仓库**（私有运行实例 autumn-mail-sync、公开 template）的布局是根级 src/，
//    本文件到仓库根只需**一个** ../，而且那些仓库里本来没有 shared/。所以同步脚本必须做两件事：
//      ① 把 shared/stages.js 一并拷进目标仓库的 shared/；
//      ② 把这一行的 ../../../ 改写为 ../（scripts/sync-template.js 自动做）。
//    缺任何一步，目标仓库的 Action 启动即崩，且 test/run.js 也会连带失败（它 require 本文件）。
//    改写层级时别想当然：曾在同步脚本里写成 ../../（以为独立仓库"深两层"），而且在 monorepo 内
//    验证时**假绿**——staging/src 往上两层恰好是仓库根，那里真有 shared/；只有把产物复制到
//    monorepo 之外跑才暴露 MODULE_NOT_FOUND。所以 sync-template.js 的 --test 刻意在隔离目录里跑。
// 3. 在同步脚本落地之前，独立仓库里这一行**仍是字面量副本**（那边跑的是 v0.4.0，功能正常）。
//    请勿手工把本文件覆盖过去——那会直接打死线上定时任务。
//
// AI 只能从这 14 个里选 stage，选不出留空（严格校验见 ai.js 的 normalizeStage）。
const { STAGE_PRESETS } = require('../../../shared/stages');

// 建议文件名：Action 只 PATCH 这一个文件，永不读写 vault-*.json（不变量①⑥）
const MAIL_SUGGEST_FILENAME = 'mail-suggestions.json';
// 配置文件名：网页端写、Action 端读（明文，绝不含任何密钥）；用于网页可调项下发
const MAIL_CONFIG_FILENAME = 'mail-config.json';

// 邮件类型枚举（AI 归一后的取值域）
const EMAIL_TYPES = ['测评', '笔试', '机试', '面试邀请', 'Offer', '拒信', '其它'];

// 预筛关键词默认值（可用 KEYWORDS Secret/env 覆盖，用 | 分隔）
// 已收紧：移除过于宽泛、易命中营销/理财邮件的 评估|offer|assessment；补充校招强相关词。
// 说明：银行/理财营销常含「限時 offer / 風險評估 / assessment」而漏进；去掉这几个后，
//       真正的招聘邮件仍会被 面试/笔试/录用/招聘/校招/应聘/网申/入职/简历/interview 命中。
const DEFAULT_KEYWORDS = '面试|笔试|机试|测评|录用|应聘|招聘|校招|网申|入职|简历|interview';

// ===== 噪声排除：拆成「发件人」与「主题」两张表，各自只作用于该作用的对象 =====
//
// 为什么必须拆开（v4.6.1 修复的核心缺陷）：
// 旧版只有一张 NOISE_PATTERN，同时匹配 from 与 subject，其中含 no-?reply|donotreply|noreply。
// 而招聘系统的通知邮件几乎全部由机器地址发出——实测 21 个真实招聘发件地址
// （Moka / 北森 iTalent / 牛客 / 智联 / 猎聘 / 实习僧 / 腾讯校招 / 阿里校招 / 字节 / 美团 /
//   京东 / 大易 / 24Talent / 用友 …）在主题明确写着「【面试邀请】…」的情况下，18 个被误杀。
// 更要命的是误杀不可逆：computeWatermark 会把水位推过这些邮件，后续运行永不回看。
//
// 取舍原则：预筛只为省 token，准确性由 AI 把关。
//   漏掉一封真面邀 = 不可逆的损失（水位推过就永久跳过，且用户无从察觉）；
//   多放行一封营销邮件 = 几分钱 token，且后面还有 AI 的 isRecruitment 判定、
//   MIN_CONFIDENCE 阈值、以及网页端人工复核三道拦截。
// 因此这两张表只保留「高确定性的垃圾特征」，绝不用「机器发件人」这种招聘常态当噪声。

// 只匹配发件人：确定性垃圾/邮件系统标记。刻意不含 noreply 家族。
const FROM_NOISE_PATTERN = 'postmaster|mailer-daemon|newsletter|unsubscribe|list-?subscribe';

// 只匹配主题：营销与金融推销特征。金融词直接针对实测已入库的 3 条纯营销邮件
// （汇丰「開立…定期存款享額外現金獎賞」/ 恒生「立即申請…信用卡」/ 汇丰「卓越理財…教育峰会」）。
// 刻意不含「服务通知|通知中心」：那是招聘门户常用的主题前缀，会把真通知一起丢掉。
const SUBJECT_NOISE_PATTERN = '营销|推廣|推广|廣告|广告|退订|退訂|unsubscribe|newsletter|限時|限时|優惠|优惠|現金獎賞|现金奖赏|签賬|簽賬|開立|开立|定期存款|理財|理财|信用卡|貸款|贷款';

// 强招聘信号：主题命中即**无条件放行**，不受上面两张噪声表影响。
// 这是防误杀的最后一道保险——即便日后有人往噪声表里加了过宽的词，
// 明确写着「面试邀请 / 笔试通知 / 录用通知」的邮件也不会被丢掉。
const STRONG_SIGNAL_PATTERN = '面试邀请|面試邀請|面试通知|面試通知|笔试通知|筆試通知|机试通知|機試通知|测评通知|測評通知|評估通知|录用通知|錄用通知|意向书|意向書|入职通知|入職通知|复试通知|複試通知|终面|終面|体检通知|體檢通知|网申|網申|校园招聘|校園招聘|offer';

// 丢弃原因枚举：预筛（prefilter）与 AI 结果判定（ai.verdictOnAiResult）共用同一套字面量，
// 三处消费——Action 计数、Gist 的 meta.lastDropped、网页端 describeDropReason 的中文映射。
// 放在 config.js（唯一配置入口）而不是 prefilter.js，避免 ai.js 反向依赖 prefilter.js。
const DROP_REASONS = Object.freeze({
  NOISE_FROM: 'noise-from',       // 发件人命中 FROM_NOISE_PATTERN
  NOISE_SUBJECT: 'noise-subject', // 主题命中 SUBJECT_NOISE_PATTERN
  NO_KEYWORD: 'no-keyword',       // 主题+正文都没命中关键词
  AI_NOT_RECRUIT: 'ai-not-recruit', // AI 明确判定 isRecruitment=false
  LOW_CONF: 'low-conf',           // AI 置信度低于 MIN_CONFIDENCE
  AI_ERROR: 'ai-error'            // AI 调用失败（同时会写进 meta.lastError）
});

function strEnv(name, fallback = '') {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const s = String(raw).trim();
  return s === '' ? fallback : s;
}

function intEnv(name, fallback) {
  const n = Number.parseInt(strEnv(name, ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function floatEnv(name, fallback) {
  const n = Number.parseFloat(strEnv(name, ''));
  return Number.isFinite(n) ? n : fallback;
}

// 组装运行时配置（冻结，防误改）。所有默认值严格按计划文件。
function buildConfig() {
  return Object.freeze({
    imap: Object.freeze({
      host: strEnv('IMAP_HOST', 'imap.qq.com'),
      port: intEnv('IMAP_PORT', 993),
      user: strEnv('QQ_EMAIL', ''),
      pass: strEnv('QQ_AUTHCODE', ''),
      // clientInfo 触发 imapflow 在 connect() 时发送 RFC2971 ID 命令，破 QQ 'Unsafe Login'
      clientInfo: Object.freeze({ name: 'autumn-mail-sync', version: '0.1.0', vendor: 'personal' })
    }),
    sinceDays: intEnv('SINCE_DAYS', 30),
    maxPerRun: intEnv('MAX_PER_RUN', 30),
    // 回溯起点（仅手动 dispatch 传）：>0 时忽略云端水位，从该 UID 起重新扫描。
    // 用途：捞回被旧噪声规则误杀、且水位已永久越过的邮件（水位推过就不会再回看）。
    // 注意配合 MAX_PER_RUN 一起调大，否则一次只能重扫 maxPerRun 封。
    uidFrom: intEnv('UID_FROM', 0),
    minConfidence: floatEnv('MIN_CONFIDENCE', 0.3),
    keywords: strEnv('KEYWORDS', DEFAULT_KEYWORDS),
    ai: Object.freeze({
      // 换百炼：AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1 AI_MODEL=qwen-plus
      baseUrl: strEnv('AI_BASE_URL', 'https://api.deepseek.com'),
      apiKey: strEnv('AI_API_KEY', ''),
      model: strEnv('AI_MODEL', 'deepseek-chat')
    }),
    gist: Object.freeze({
      id: strEnv('GIST_ID', ''),
      token: strEnv('GIST_PAT', ''),
      apiBase: strEnv('GIST_API', 'https://api.github.com'),
      filename: MAIL_SUGGEST_FILENAME
    }),
    // 邮件建议加密密钥（可选）：设了则 mail-suggestions.json 加密存储；留空则明文（向后兼容）
    mailEncKey: strEnv('MAIL_ENC_KEY', ''),
    // 以下几项默认值，可被 Gist 里的 mail-config.json 覆盖（见 applyMailConfigOverrides）
    enabled: true,
    minIntervalHours: 0,
    promptExtra: '',
    // 整体替换内置提示词的「解析偏好」部分（v0.4.0）。留空则用 ai.js 的 DEFAULT_PROMPT_BODY。
    // 注意：无论这里写什么，ai.js 的 OUTPUT_CONTRACT（只返回 JSON、字段清单、枚举、格式）
    // 都会被强制拼在最后，用户改不掉——否则 extractJson/normalizeAiResult 会拿不到数据，
    // 整条链路静默失效（建议队列永远为空，而 Action 仍报 success）。
    promptOverride: ''
  });
}

// 用网页端写入 Gist 的 mail-config.json 覆盖可调项（非密钥）。缺省/非法值回落到 cfg 原值。
// 只覆盖：keywords / minConfidence / sinceDays / maxPerRun / enabled / minIntervalHours / promptExtra。
function applyMailConfigOverrides(cfg, mailConfig) {
  const mc = mailConfig && typeof mailConfig === 'object' ? mailConfig : {};
  const num = (v, fb) => (String(v == null ? '' : v).trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : fb);
  const str = (v, fb, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max || 4000) : fb);
  // 数值范围夹取。范围与网页端设置面板的 clampNum **逐项一致**（index.html 保存 mail-config 处）：
  // 两端不一致的话，网页里存不进去的值手改 Gist 就能塞进来，行为分叉且无从察觉。
  // 缺夹取的真实后果：minConfidence 填 5 → 所有建议都被当低置信丢弃；maxPerRun 填 99999 → 一次拉爆。
  const clampInt = (v, fb, min, max) => Math.min(max, Math.max(min, Math.round(num(v, fb))));
  return Object.freeze({
    ...cfg,
    keywords: str(mc.keywords, cfg.keywords, 2000),
    minConfidence: Math.min(1, Math.max(0, num(mc.minConfidence, cfg.minConfidence))),
    sinceDays: clampInt(mc.sinceDays, cfg.sinceDays, 1, 365),
    maxPerRun: clampInt(mc.maxPerRun, cfg.maxPerRun, 1, 200),
    enabled: mc.enabled === false ? false : true, // 仅显式 false 才禁用
    minIntervalHours: clampInt(mc.minIntervalHours, cfg.minIntervalHours, 0, 168),
    promptExtra: str(mc.promptExtra, cfg.promptExtra, 2000),
    // 清空即回落内置提示词：str() 对空串返回 fallback（cfg.promptOverride 默认 ''），
    // 而 buildSystemPrompt 见到空 override 就用 DEFAULT_PROMPT_BODY，语义天然正确
    promptOverride: str(mc.promptOverride, cfg.promptOverride, 4000)
  });
}

// 运行门禁（纯函数）：返回跳过原因字符串或 null（继续）。跳过发生在 IMAP/AI 之前 → 0 token。
function gateReason(cfg, prevMeta) {
  if (cfg && cfg.enabled === false) return 'mail-config.json 中 enabled=false（网页端已关闭邮件同步）';
  const hours = Number(cfg && cfg.minIntervalHours) || 0;
  if (hours > 0 && prevMeta && prevMeta.lastRunAt) {
    const last = Date.parse(prevMeta.lastRunAt);
    if (Number.isFinite(last) && (Date.now() - last) < hours * 3600e3) {
      return `距上次运行不足 ${hours} 小时（minIntervalHours=${hours}）`;
    }
  }
  return null;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 由 KEYWORDS 字符串（| 分隔）构建大小写不敏感正则
function keywordRegex(keywords) {
  const parts = String(keywords || DEFAULT_KEYWORDS).split('|').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  return new RegExp(parts.map(escapeRegExp).join('|'), 'i');
}

function fromNoiseRegex() {
  return new RegExp(FROM_NOISE_PATTERN, 'i');
}

function subjectNoiseRegex() {
  return new RegExp(SUBJECT_NOISE_PATTERN, 'i');
}

function strongSignalRegex() {
  return new RegExp(STRONG_SIGNAL_PATTERN, 'i');
}

module.exports = {
  STAGE_PRESETS,
  EMAIL_TYPES,
  MAIL_SUGGEST_FILENAME,
  MAIL_CONFIG_FILENAME,
  DEFAULT_KEYWORDS,
  FROM_NOISE_PATTERN,
  SUBJECT_NOISE_PATTERN,
  STRONG_SIGNAL_PATTERN,
  DROP_REASONS,
  buildConfig,
  applyMailConfigOverrides,
  gateReason,
  keywordRegex,
  fromNoiseRegex,
  subjectNoiseRegex,
  strongSignalRegex,
  escapeRegExp
};
