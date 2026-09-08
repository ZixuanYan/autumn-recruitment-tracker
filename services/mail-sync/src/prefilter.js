'use strict';
// ============================================================================
// prefilter.js — 关键词预筛：只有候选邮件才进 AI，省 token、降噪
//
// v4.6.1 重构：判定结果从布尔改为结构化（带 reason），让「为什么丢」可观测、可上屏。
// 判定顺序（强信号优先，这是防误杀的最后一道保险）：
//   1. 主题命中强招聘信号 → 无条件放行（不看任何噪声表）
//   2. 发件人命中 FROM_NOISE → 丢（noise-from）
//   3. 主题命中 SUBJECT_NOISE → 丢（noise-subject）
//   4. 主题/正文命中关键词 → 放行；否则丢（no-keyword）
//
// 为什么强信号要排在噪声之前：两类错误的代价不对称。
//   误放行一封营销邮件 → 后面还有 AI 的 isRecruitment 判定、MIN_CONFIDENCE 阈值、
//                        网页端人工复核三道拦截，代价是几分钱 token；
//   误杀一封真面邀     → computeWatermark 会把水位推过它，后续运行永不回看，
//                        且在 v4.6.1 之前完全无记录，用户只能靠"感觉没拉到"来发现。
// 旧版正是因为把 no-?reply 当噪声，实测 21 个真实招聘系统发件地址误杀 18 个。
// ============================================================================

const { fromNoiseRegex, subjectNoiseRegex, strongSignalRegex, DROP_REASONS } = require('./config');

const FROM_NOISE_RE = fromNoiseRegex();
const SUBJECT_NOISE_RE = subjectNoiseRegex();
const STRONG_SIGNAL_RE = strongSignalRegex();

// 主题是否含强招聘信号（命中即无条件放行）
function hasStrongSignal(subject) {
  return STRONG_SIGNAL_RE.test(String(subject || ''));
}

// 兼容封装：发件人命中 FROM_NOISE，或主题命中 SUBJECT_NOISE。
// 注意本函数**不含**强信号放行逻辑（那是 classifyMail 的职责），保持语义单纯。
function isNoise(from, subject) {
  if (FROM_NOISE_RE.test(String(from || ''))) return true;
  return SUBJECT_NOISE_RE.test(String(subject || ''));
}

// 主判定：返回 { pass, reason }。reason 为空串表示通过。
function classifyMail(mail, kwRegex) {
  if (!mail) return { pass: false, reason: DROP_REASONS.NO_KEYWORD };
  const subject = String(mail.subject || '');

  // 1) 强信号优先：明确写着面试邀请/笔试通知/录用通知的，绝不因为发件人是机器地址而被丢
  if (hasStrongSignal(subject)) return { pass: true, reason: '' };

  // 2) 发件人确定性垃圾标记（postmaster / mailer-daemon / newsletter / unsubscribe）
  if (FROM_NOISE_RE.test(String(mail.from || ''))) return { pass: false, reason: DROP_REASONS.NOISE_FROM };

  // 3) 主题营销/金融推销特征
  if (SUBJECT_NOISE_RE.test(subject)) return { pass: false, reason: DROP_REASONS.NOISE_SUBJECT };

  // 4) 关键词命中（主题 + 正文）。无关键词配置时保守放行，交 AI 判定。
  if (!kwRegex) return { pass: true, reason: '' };
  // 正文已由 parse.js 的 truncateBody 截到 MAX_BODY，此处不再重复 slice
  const hay = `${subject} ${mail.textBody || ''}`;
  return kwRegex.test(hay) ? { pass: true, reason: '' } : { pass: false, reason: DROP_REASONS.NO_KEYWORD };
}

// 兼容封装：布尔版候选判定
function isCandidate(mail, kwRegex) {
  return classifyMail(mail, kwRegex).pass;
}

module.exports = { DROP_REASONS, hasStrongSignal, isNoise, classifyMail, isCandidate };
// DROP_REASONS 的权威定义在 config.js（ai.js 也要用），此处 re-export 保持既有引用点不变。
