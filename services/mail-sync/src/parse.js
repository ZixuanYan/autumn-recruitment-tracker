'use strict';
// ============================================================================
// parse.js — MIME 解析：原始消息 → { sourceUid, receivedAt, from, subject, textBody }
// 正文截断 ≤4000 字。mailparser 采用惰性 require：这样本模块在只跑纯函数单测
// （htmlToText / truncateBody / pickReceivedAt）时无需安装依赖也能被 require。
// ============================================================================

// 正文上限：8000 字（v4.6.1 由 4000 提到 8000）。
// 招聘邮件的关键信息常在正文靠后位置——长邮件底部的「请于 X 日前完成测评」「点击链接确认参加面试」
// 在 4000 字截断下会丢失，导致 AI 解析不出 scheduleAt。8000 字对 token 成本影响很小。
const MAX_BODY = 8000;
// 写进建议里的正文上限（v4.22.0）：建议要落进 Gist 的 mail-suggestions.json，
// 而 Gist 单文件超过 ~1MB 会被截断读取。按 8000 字存，100 条建议就是 ~800KB，太接近上限；
// 归档只用来回看，2000 字足够看清"这封邮件说了什么"。AI 用的仍是 8000 字的全文，不受影响。
const MAX_ARCHIVE_BODY = 2000;

let _simpleParser = null;
function getSimpleParser() {
  if (!_simpleParser) {
    // eslint-disable-next-line global-require
    _simpleParser = require('mailparser').simpleParser;
  }
  return _simpleParser;
}

// 极简 HTML→纯文本：去 script/style、换行块级标签、剥标签、解常见实体、压空白
function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<\s*(script|style)[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ');
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\/\s*(p|div|tr|li|h[1-6]|table)\s*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&hellip;/gi, '…');
  return s.replace(/[ \t\r\f\v]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function truncateBody(text) {
  const s = String(text || '').replace(/\s+\n/g, '\n').trim();
  return s.length > MAX_BODY ? `${s.slice(0, MAX_BODY)}…` : s;
}

// 归档用的短正文：与 truncateBody 同源（先规范化空白），再按更小的上限截断。
function truncateForArchive(text) {
  const s = String(text || '').replace(/\s+\n/g, '\n').trim();
  return s.length > MAX_ARCHIVE_BODY ? `${s.slice(0, MAX_ARCHIVE_BODY)}…` : s;
}

// Message-ID 归一：剥掉尖括号，形状不对就返回空串（宁空勿假 —— 一个坏 ID 会让网页端关联到错误的邮件）。
// ⚠️ Message-ID **不保证存在**（部分营销/系统邮件没有），所以它只是"优先标识"，
// 缺失时由调用方回落到 mailbox + uidValidity + uid 的组合。
function normalizeMessageId(value) {
  const s = String(value || '').trim().replace(/^</, '').replace(/>$/, '');
  return /^[^<>\s]+@[^<>\s]+$/.test(s) ? s : '';
}

// 收取时间：优先 parsed.date，回退 internalDate / envelope.date，最后当前时间；统一 ISO
function pickReceivedAt(parsedDate, internalDate, envelopeDate) {
  const cand = parsedDate || internalDate || envelopeDate;
  const d = cand instanceof Date ? cand : new Date(cand || Date.now());
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

async function parseMessage(msg) {
  const simpleParser = getSimpleParser();
  const source = msg.source; // Buffer（BODY.PEEK[]）
  const parsed = source ? await simpleParser(source) : {};
  const env = msg.envelope || {};

  const fromAddr =
    (parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].address) ||
    (env.from && env.from[0] && env.from[0].address) || '';
  const fromName =
    (parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].name) ||
    (env.from && env.from[0] && env.from[0].name) || '';
  const subject = parsed.subject || env.subject || '';

  let textBody = parsed.text || '';
  if (!textBody && parsed.html) textBody = htmlToText(parsed.html);
  textBody = truncateBody(textBody);

  return {
    sourceUid: Number(msg.uid) || 0,
    // v4.22.0：稳定标识（换邮箱/换服务器后 UID 会变，Message-ID 不会）
    messageId: normalizeMessageId(parsed.messageId || env.messageId),
    receivedAt: pickReceivedAt(parsed.date, msg.internalDate, env.date),
    from: fromAddr,
    fromName,
    subject: String(subject).trim(),
    textBody
  };
}

module.exports = { parseMessage, htmlToText, truncateBody, truncateForArchive, normalizeMessageId, pickReceivedAt, MAX_BODY, MAX_ARCHIVE_BODY };
