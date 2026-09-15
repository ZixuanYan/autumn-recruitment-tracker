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
// 链接（v4.26.0）：上限 8 条 / 单条 400 字 / 标签 80 字。见 extractLinks 的说明。
const LINK_MAX = 8;
const LINK_URL_MAX = 400;
const LINK_TEXT_MAX = 80;
// 每封邮件都有的模板链接（退订 / 隐私政策 / 客服入口），与本次投递无关：
// 抽出来只会把真正的「开始测评」挤出上限（每封邮件最多留 8 条）
const LINK_NOISE = /(退订|取消订阅|unsubscribe|隐私政策|privacy|帮助中心|help\s*center|举报|投诉)/i;

let _simpleParser = null;
function getSimpleParser() {
  if (!_simpleParser) {
    // eslint-disable-next-line global-require
    _simpleParser = require('mailparser').simpleParser;
  }
  return _simpleParser;
}

// HTML 实体解码。单独成函数是为了**统一口径**：正文与链接都要解一次，而 `&amp;` 在
// 链接里是致命的（`?a=1&amp;b=2` 直接打不开，且看起来只是"链接失效"，没人会想到是实体）。
function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&hellip;/gi, '…');
}

// 极简 HTML→纯文本：去 script/style、换行块级标签、剥标签、解常见实体、压空白
function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<\s*(script|style)[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ');
  // 锚点保留成「文字 [地址]」（v4.26.0）：此前 href 被下面的剥标签规则整个吃掉，
  // 于是 HTML-only 的测评邮件里那句「点击这里开始测评」后面什么都不剩，地址彻底失联。
  // 用方括号而不是尖括号：`<地址>` 会被自己的剥标签规则当成标签删掉。
  s = s.replace(/<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (all, href, label) => {
    const text = String(label || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const url = decodeEntities(href).trim();
    if (!/^https?:\/\//i.test(url)) return text;
    return text ? `${text} [${url}]` : `[${url}]`;
  });
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\/\s*(p|div|tr|li|h[1-6]|table)\s*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  return decodeEntities(s).replace(/[ \t\r\f\v]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// 抽出邮件里可点的链接（v4.26.0）。**由代码机械抽取，不交给 AI**：给出「开始测评」的地址
// 不需要任何语义理解，而错一个字符就跳不出去——这件事上代码比模型可靠，也不花 token。
//
// 为什么单独成字段而不靠归档正文：正文只留 2000 字，链接常在邮件末尾被截掉；
// 且 v4.26.0 之前 HTML→文本会把 href 整个剥掉（只有纯文本部分本来就写了地址的邮件才留得下）。
// 只认 http/https 绝对地址：邮件里的相对地址没有可信的 base（HTML 里也没有 <base>），
// 拼出来的地址大多打不开，存下来只会让用户点一次空。
function extractLinks(html, text) {
  const out = [];
  const seen = new Set();
  const push = (rawUrl, rawLabel) => {
    const url = decodeEntities(rawUrl).trim().replace(/[.,;:!?]+$/, '');
    if (!/^https?:\/\//i.test(url) || url.length > LINK_URL_MAX) return;
    if (LINK_NOISE.test(url)) return;
    const label = String(rawLabel || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LINK_TEXT_MAX);
    // 退订 / 隐私政策这类每一封都有的模板链接是噪声：抽出来只会把真正的测评链接挤出上限
    if (label && LINK_NOISE.test(label)) return;
    if (seen.has(url) || out.length >= LINK_MAX) return;
    seen.add(url);
    out.push({ text: label, url });
  };
  const src = String(html || '');
  const anchor = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchor.exec(src)) !== null) push(m[1], m[2]);
  // 纯文本里裸写的地址（text/plain 邮件，或正文里直接贴着 URL）。
  // 刻意**不扫 HTML 源码**：那会把 src=、追踪像素、内联样式的 url() 一起当成"链接"捞进来。
  const bare = /https?:\/\/[^\s<>"'）)】\]，。；]+/gi;
  while ((m = bare.exec(String(text || ''))) !== null) push(m[0], '');
  return out;
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
  const html = parsed.html || '';
  if (!textBody && html) textBody = htmlToText(html);
  textBody = truncateBody(textBody);

  return {
    sourceUid: Number(msg.uid) || 0,
    // v4.22.0：稳定标识（换邮箱/换服务器后 UID 会变，Message-ID 不会）
    messageId: normalizeMessageId(parsed.messageId || env.messageId),
    receivedAt: pickReceivedAt(parsed.date, msg.internalDate, env.date),
    from: fromAddr,
    fromName,
    subject: String(subject).trim(),
    textBody,
    // v4.26.0：测评 / 笔试邮件里那条「点击开始测评」的地址。从 HTML 的锚点抽（标签里带着真实
    // href），纯文本部分再扫一遍裸地址；不扫 HTML 源码，否则 src=/追踪像素都会被当成链接。
    links: extractLinks(html, parsed.text || '')
  };
}

module.exports = { parseMessage, htmlToText, decodeEntities, extractLinks, truncateBody, truncateForArchive, normalizeMessageId, pickReceivedAt, MAX_BODY, MAX_ARCHIVE_BODY, LINK_MAX, LINK_URL_MAX };
