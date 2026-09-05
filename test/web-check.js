'use strict';
// ============================================================================
// test/web-check.js — 网页端（autumn-recruitment-tracker/index.html）本地校验：
//   1) 内联 <script> 用 vm.Script 做语法校验（只编译不执行，无需 DOM）；
//   2) 抽取 /*__MAIL_PURE_START__*/…/*__MAIL_PURE_END__*/ 纯函数块，跑单测：
//      normalizeCompanySlug / diceCoefficient / matchRecordsByCompany / filterMailSuggestions
//      （0/1/多命中、后缀剥离、全半角）。
// 运行：node test/web-check.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const HTML_PATH = path.resolve(__dirname, '../../autumn-recruitment-tracker/index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failed += 1; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

// ---- 1) 内联脚本语法校验 ----
console.log('内联 <script> 语法校验（vm.Script 只编译不执行）');
const inlineScripts = [];
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m;
while ((m = re.exec(html)) !== null) inlineScripts.push(m[1]);
check(`提取到 ${inlineScripts.length} 个内联脚本（≥1）`, () => assert.ok(inlineScripts.length >= 1));
inlineScripts.forEach((code, i) => {
  check(`内联脚本 #${i + 1} 语法通过（${code.length} 字符）`, () => { new vm.Script(code, { filename: `inline-${i + 1}.js` }); });
});

// ---- 2) 抽取纯函数块并单测 ----
console.log('邮件匹配纯函数单测');
const startMark = '/*__MAIL_PURE_START__*/';
const endMark = '/*__MAIL_PURE_END__*/';
const si = html.indexOf(startMark);
const ei = html.indexOf(endMark);
check('找到纯函数块标记', () => { assert.ok(si !== -1 && ei !== -1 && ei > si, '未找到 __MAIL_PURE_START__/__END__ 标记'); });
const pureSrc = html.slice(si + startMark.length, ei);
const helpers = new Function(`${pureSrc}; return { normalizeCompanySlug, diceCoefficient, companyMatchScore, matchRecordsByCompany, filterMailSuggestions, unionIdList, unionMailState };`)();

check('normalizeCompanySlug 剥离后缀 + 全角转半角 + 小写', () => {
  const { normalizeCompanySlug, companyMatchScore } = helpers;
  assert.strictEqual(normalizeCompanySlug('腾讯科技有限公司'), '腾讯'); // 末尾后缀循环剥离
  assert.strictEqual(normalizeCompanySlug('Ｔｅｎｃｅｎｔ'), 'tencent'); // 全角拉丁→半角小写
  assert.strictEqual(normalizeCompanySlug('北京字节跳动科技有限公司'), '北京字节跳动');
  assert.strictEqual(normalizeCompanySlug('腾讯科技（深圳）有限公司'), '腾讯科技深圳'); // 全角括号去除、城市中缀保留
  assert.ok(companyMatchScore('腾讯科技（深圳）有限公司', '腾讯') >= 0.6); // 仍能经「互相包含」命中
  assert.strictEqual(normalizeCompanySlug(''), '');
});

check('diceCoefficient 相同=1、无关≈0', () => {
  const { diceCoefficient } = helpers;
  assert.strictEqual(diceCoefficient('abc', 'abc'), 1);
  assert.ok(diceCoefficient('腾讯', '阿里巴巴') < 0.2);
  assert.strictEqual(diceCoefficient('', 'x'), 0);
});

check('matchRecordsByCompany 单一命中（后缀差异）', () => {
  const { matchRecordsByCompany } = helpers;
  const records = [
    { id: 'r1', company: '腾讯', position: '后端' },
    { id: 'r2', company: '阿里巴巴', position: '前端' }
  ];
  const hits = matchRecordsByCompany('腾讯科技（深圳）有限公司', '后端', records);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].id, 'r1');
});

check('matchRecordsByCompany 多命中（同名不同岗位）', () => {
  const { matchRecordsByCompany } = helpers;
  const records = [
    { id: 'a', company: '字节跳动', position: '算法' },
    { id: 'b', company: '北京字节跳动科技有限公司', position: '客户端' }
  ];
  const hits = matchRecordsByCompany('字节跳动', '', records);
  assert.ok(hits.length >= 2, `期望多命中，实际 ${hits.length}`);
});

check('matchRecordsByCompany 0 命中', () => {
  const { matchRecordsByCompany } = helpers;
  const records = [{ id: 'x', company: '美团', position: '产品' }];
  assert.strictEqual(matchRecordsByCompany('特斯拉', '', records).length, 0);
  assert.strictEqual(matchRecordsByCompany('', '', records).length, 0);
});

check('filterMailSuggestions 过滤 applied/dismissed', () => {
  const { filterMailSuggestions } = helpers;
  const sugs = [{ id: 'uid-1' }, { id: 'uid-2' }, { id: 'uid-3' }];
  const out = filterMailSuggestions(sugs, ['uid-1'], ['uid-3']);
  assert.deepStrictEqual(out.map(s => s.id), ['uid-2']);
});

check('unionMailState 跨设备并集合并（去重、含远端项）', () => {
  const { unionMailState } = helpers;
  const local = { appliedIds: ['uid-1'], dismissedIds: ['uid-2', 'uid-3'] };
  const remote = { appliedIds: ['uid-1', 'uid-9'], dismissedIds: ['uid-4'] };
  const m = unionMailState(local, remote);
  assert.deepStrictEqual(m.appliedIds.sort(), ['uid-1', 'uid-9']);
  assert.deepStrictEqual(m.dismissedIds.sort(), ['uid-2', 'uid-3', 'uid-4']);
});
check('unionMailState 远端为 null（老 payload）时=本地不变', () => {
  const { unionMailState } = helpers;
  const local = { appliedIds: ['a'], dismissedIds: ['b'] };
  const m = unionMailState(local, null);
  assert.deepStrictEqual(m.appliedIds, ['a']);
  assert.deepStrictEqual(m.dismissedIds, ['b']);
});
check('unionIdList 去重且 cap 上限', () => {
  const { unionIdList } = helpers;
  assert.deepStrictEqual(unionIdList(['x', 'y'], ['y', 'z']), ['x', 'y', 'z']);
  const big = unionIdList(Array.from({ length: 600 }, (_, i) => `id${i}`), [], 500);
  assert.strictEqual(big.length, 500);
});

// ---- 3) v4.4.0：CORE 纯函数块 + normalizeRecord 新字段透传 ----
// 依赖函数（parseLocal / localDateInput / isActive / normalizeRecord …）不在标记块内，
// 这里按函数名从 index.html 现场抽取（花括号配平），避免在测试里复制一份实现而产生漂移。
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) return '';
  let i = src.indexOf('{', start);
  if (i === -1) return '';
  let depth = 0;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}
function extractBlock(src, startMark, endMark) {
  const s = src.indexOf(startMark);
  const e = src.indexOf(endMark);
  return (s !== -1 && e !== -1 && e > s) ? src.slice(s + startMark.length, e) : '';
}

console.log('v4.4.0 核心纯函数单测（截止日 / 日程事件 / ICS / 公司分组 / 漏斗 / 停留 / 卡点 / 查重）');
const coreSrc = extractBlock(html, '/*__CORE_PURE_START__*/', '/*__CORE_PURE_END__*/');
check('找到 CORE 纯函数块标记', () => assert.ok(coreSrc.length > 500, `CORE 块过短或未找到：${coreSrc.length}`));

const CORE_DEP_NAMES = ['stageOrder', 'parseLocal', 'localDateInput', 'localDateTimeInput', 'formatDate', 'formatDateTime', 'isActive', 'cryptoId', 'sanitizeTimeline', 'deriveStage', 'normalizeRecord'];
const coreDeps = CORE_DEP_NAMES.map(name => extractFunction(html, name));
check('CORE 依赖函数全部从 index.html 抽取到（无复制实现，避免漂移）', () => {
  const missing = CORE_DEP_NAMES.filter((name, idx) => !coreDeps[idx]);
  assert.deepStrictEqual(missing, []);
});

const core = new Function(
  'self',
  `const STAGE_PRESETS = ['待投递','已投递','测评','笔试','机试','一面','二面','三面','四面','五面','交叉面','HR面','Offer','已结束'];
   ${pureSrc}
   ${coreDeps.join('\n')}
   ${coreSrc}
   return {
     parseDay, daysUntil, deadlineInfo, collectScheduleEvents, icsEscape, buildIcs, foldIcsLine, utf8Octets,
     companyKeyOf, companyGroupKey, groupRecordsByCompany, companyGroupIndex, companyColor, computeFunnel, computeStageDwell,
     computeDailyApplications, sparklinePath, findStalled, findUpcomingDeadlines, collectAlerts,
     normalizePositionSlug, findDuplicateRecord, normalizeRecord
   };`
)(globalThis);

const DAY = 86400000;
function dayOffset(n, base = new Date('2026-09-06T12:00:00')) {
  const d = new Date(base.getTime() + n * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const NOW = new Date('2026-09-06T12:00:00');

check('parseDay 把 date-only 当本地午夜（避开 new Date(YYYY-MM-DD) 的 UTC 陷阱）', () => {
  const d = core.parseDay('2026-09-10');
  assert.strictEqual(d.getHours(), 0);
  assert.strictEqual(d.getMinutes(), 0);
  assert.strictEqual(core.parseDay(''), null);
  assert.strictEqual(core.parseDay('不是日期'), null);
});

check('daysUntil 按日历日取整', () => {
  assert.strictEqual(core.daysUntil(new Date('2026-09-09T23:30:00'), NOW), 3);
  assert.strictEqual(core.daysUntil(new Date('2026-09-06T01:00:00'), NOW), 0);
  assert.strictEqual(core.daysUntil(new Date('2026-09-04T01:00:00'), NOW), -2);
});

check('deadlineInfo 分级：>3天正常 / ≤3天 warn / 今天与逾期 danger', () => {
  assert.strictEqual(core.deadlineInfo(dayOffset(10), NOW).level, '');
  assert.strictEqual(core.deadlineInfo(dayOffset(3), NOW).level, 'warn');
  assert.strictEqual(core.deadlineInfo(dayOffset(0), NOW).level, 'danger');
  assert.strictEqual(core.deadlineInfo(dayOffset(-2), NOW).level, 'danger');
  assert.ok(core.deadlineInfo(dayOffset(-2), NOW).text.includes('已过期 2 天'));
  assert.strictEqual(core.deadlineInfo('', NOW), null);
});

check('collectScheduleEvents 逾期置顶 + 已结束不计截止 + limit 生效', () => {
  const recs = [
    { id: 'a', company: 'A', position: 'p', stage: '一面', scheduleAt: '2026-09-20T10:00', deadline: '' },
    { id: 'b', company: 'B', position: 'p', stage: '已投递', scheduleAt: '', deadline: dayOffset(-1, NOW) },
    { id: 'c', company: 'C', position: 'p', stage: '已结束', scheduleAt: '', deadline: dayOffset(2, NOW) },
    { id: 'd', company: 'D', position: 'p', stage: 'Offer', scheduleAt: '', deadline: dayOffset(2, NOW) }
  ];
  const events = core.collectScheduleEvents(recs, NOW, 6);
  assert.strictEqual(events[0].record.id, 'b', '逾期项应置顶');
  assert.strictEqual(events[0].overdue, true);
  assert.ok(!events.some(e => e.record.id === 'c' || e.record.id === 'd'), '已结束/Offer 的截止不应出现');
  assert.strictEqual(core.collectScheduleEvents(recs, NOW, 1).length, 1);
});

check('buildIcs 结构、CRLF、UID 与文本转义', () => {
  const events = core.collectScheduleEvents([
    { id: 'r1', company: '腾讯,深圳', position: '后端;基础平台', stage: '一面', scheduleAt: '2026-09-20T10:00', deadline: '', recentSchedule: '线上一面\n腾讯会议', applicationUrl: 'https://x.example/a' }
  ], NOW, 10);
  const ics = core.buildIcs(events);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(ics.includes('\r\n'), '必须用 CRLF');
  assert.ok(ics.includes('UID:r1-schedule@autumn-recruitment-tracker'));
  assert.ok(ics.includes('DTSTART:20260920T100000'), '浮动本地时间');
  assert.ok(/DTSTAMP:\d{8}T\d{6}Z/.test(ics), 'DTSTAMP 必须是 UTC');
  assert.ok(ics.includes('腾讯\\,深圳'), '逗号需转义');
  assert.ok(ics.includes('后端\\;基础平台'), '分号需转义');
  assert.ok(ics.includes('线上一面\\n腾讯会议'), '换行需转义成 \\n');
  assert.ok(ics.includes('URL:https://x.example/a'));
});

// ---- RFC 5545 严格校验器：结构 + 75 octets 折行 + 展开还原 ----
// 展开规则（§3.1）：CRLF 后紧跟的单个空白是折叠标记，去掉即还原逻辑行。
function unfoldIcs(ics) {
  return ics.replace(/\r\n[ \t]/g, '').split('\r\n').filter(l => l !== '');
}
function validateIcs(ics) {
  const problems = [];
  if (!ics.endsWith('\r\n')) problems.push('未以 CRLF 结尾');
  if (/[\n\r]/.test(ics.replace(/\r\n/g, ''))) problems.push('存在裸 LF 或 CR（必须全部是 CRLF）');
  const physical = ics.split('\r\n').filter(l => l !== '');
  for (const line of physical) {
    const octets = Buffer.byteLength(line, 'utf8');
    if (octets > 75) problems.push(`行超过 75 octets（${octets}）：${line.slice(0, 30)}…`);
  }
  // 续行必须以单个空白开头
  for (let i = 1; i < physical.length; i += 1) {
    const isContinuation = Buffer.byteLength(physical[i - 1], 'utf8') > 60 && /^[ \t]/.test(physical[i]);
    if (isContinuation && !/^[ \t]/.test(physical[i])) problems.push(`第 ${i + 1} 行应为折叠续行但缺前导空白`);
  }
  const logical = unfoldIcs(ics);
  const count = (re) => logical.filter(l => re.test(l)).length;
  if (count(/^VERSION:2\.0$/) !== 1) problems.push('VERSION:2.0 缺失或非唯一');
  if (count(/^PRODID:/) !== 1) problems.push('PRODID 缺失或非唯一');
  if (count(/^BEGIN:VCALENDAR$/) !== 1 || count(/^END:VCALENDAR$/) !== 1) problems.push('VCALENDAR BEGIN/END 不配对');
  if (count(/^BEGIN:VEVENT$/) !== count(/^END:VEVENT$/)) problems.push('VEVENT BEGIN/END 不配对');
  if (count(/^UID:/) !== count(/^BEGIN:VEVENT$/)) problems.push('每个 VEVENT 必须有且仅有一个 UID');
  if (count(/^DTSTAMP:/) !== count(/^BEGIN:VEVENT$/)) problems.push('每个 VEVENT 必须有 DTSTAMP');
  if (count(/^DTSTART/) !== count(/^BEGIN:VEVENT$/)) problems.push('每个 VEVENT 必须有 DTSTART');
  const uids = logical.filter(l => l.startsWith('UID:')).map(l => l.slice(4));
  if (new Set(uids).size !== uids.length) problems.push('UID 重复（日历会当成同一事件更新）');
  return { problems, logical, events: count(/^BEGIN:VEVENT$/) };
}

check('buildIcs 通过严格 RFC 5545 校验（长中文描述按 UTF-8 字节折叠，可无损展开还原）', () => {
  const longChinese = '梳理项目经历，准备三分钟自我介绍；提前测试摄像头、麦克风与网络，备好作品集与岗位 JD 的关键要求逐条对照，并复习上一轮面试官提到的系统设计题目';
  const events = core.collectScheduleEvents([
    { id: 'cjk1', company: '星海科技', position: '产品经理校招生', city: '上海', stage: '一面', scheduleAt: '2026-09-20T10:00', deadline: '', recentSchedule: '线上一面（腾讯会议）', nextAction: longChinese, applicationUrl: '' },
    { id: 'cjk2', company: '山岚智能', position: '算法工程师', city: '北京', stage: '笔试', scheduleAt: '', deadline: '2026-09-25', nextAction: '', applicationUrl: '' }
  ], NOW, 10);
  const ics = core.buildIcs(events);
  const { problems, logical, events: n } = validateIcs(ics);
  assert.deepStrictEqual(problems, [], `RFC 5545 校验失败：${problems.join('；')}`);
  assert.strictEqual(n, 2);
  // 展开还原：折叠只是物理换行，逻辑值必须与原始内容逐字一致（含转义后的中文与标点）
  const desc = logical.find(l => l.startsWith('DESCRIPTION:') && l.includes('星海科技') === false && l.includes('产品经理校招生'));
  assert.ok(desc, '应能找到含长中文的 DESCRIPTION');
  assert.ok(desc.includes(core.icsEscape(longChinese)), '展开后必须无损还原长中文下一步行动');
  assert.ok(!/\r|\n/.test(desc), '逻辑行内不得再有真实换行');
});

check('foldIcsLine 按字节预算折叠且不拆多字节字符', () => {
  const ascii = 'X'.repeat(200);
  const foldedAscii = core.foldIcsLine(ascii);
  assert.ok(foldedAscii.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75));
  assert.strictEqual(foldedAscii.replace(/\r\n /g, ''), ascii, 'ASCII 展开无损');
  const cjk = '面'.repeat(120); // 每字 3 字节 = 360 octets
  const foldedCjk = core.foldIcsLine(cjk);
  assert.ok(foldedCjk.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75), '每行不超过 75 octets');
  assert.strictEqual(foldedCjk.replace(/\r\n /g, ''), cjk, '中文展开无损（未在多字节字符中间断开）');
  const emoji = '🎯'.repeat(60); // 代理对，每字 4 字节
  const foldedEmoji = core.foldIcsLine(emoji);
  assert.ok(foldedEmoji.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75));
  assert.strictEqual(foldedEmoji.replace(/\r\n /g, ''), emoji, '代理对不被拆开');
  assert.strictEqual(core.utf8Octets('面'), 3);
  assert.strictEqual(core.utf8Octets('🎯'), 4);
  assert.strictEqual(core.utf8Octets('abc'), 3);
  assert.strictEqual(core.foldIcsLine('SHORT:1'), 'SHORT:1', '短行原样返回');
});

check('buildIcs 全天截止用 VALUE=DATE', () => {
  const events = core.collectScheduleEvents([
    { id: 'r2', company: 'A', position: 'p', stage: '已投递', scheduleAt: '', deadline: '2026-09-20' }
  ], NOW, 10);
  const ics = core.buildIcs(events);
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20260920'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20260921'), '全天事件 DTEND 为次日（RFC 排他）');
});

check('companyKeyOf + groupRecordsByCompany 把「腾讯」与「腾讯科技有限公司」归为一家', () => {
  const groups = core.groupRecordsByCompany([
    { id: '1', company: '腾讯', position: '后端' },
    { id: '2', company: '腾讯科技有限公司', position: '前端' },
    { id: '3', company: '阿里巴巴', position: '算法' }
  ]);
  assert.strictEqual(groups.length, 2);
  assert.strictEqual(groups[0].records.length, 2, '多岗位公司排前');
  assert.strictEqual(groups[0].label, '腾讯');
  assert.strictEqual(groups[0].key, '腾讯', '规范键取成员里最短的那个');
});

check('companyGroupKey 只剥法人形式后缀，保留行业词（与查重用的激进 slug 区分开）', () => {
  assert.strictEqual(core.companyGroupKey({ company: '腾讯科技（深圳）有限公司' }), '腾讯科技深圳');
  assert.strictEqual(core.companyGroupKey({ company: '星海科技' }), '星海科技', '行业词「科技」不能被剥掉');
  assert.strictEqual(core.companyGroupKey({ company: '某集团股份有限公司' }), '某');
  assert.strictEqual(core.companyGroupKey({ company: 'Ｔｅｎｃｅｎｔ　Ｌｔｄ' }), 'tencent', '全角转半角 + 大小写归一 + 剥 Ltd');
  assert.strictEqual(core.companyGroupKey({ company: '' }), '');
  // 查专用的激进键仍会把行业词剥掉（这是刻意的：查重允许多合并，有人工确认兜底）
  assert.strictEqual(core.companyKeyOf({ company: '星海科技' }), '星海');
});

check('分组不会把「星海科技」与「星海互娱」误并成一家（浏览器实证发现的缺陷）', () => {
  const groups = core.groupRecordsByCompany([
    { id: '1', company: '星海科技', position: '产品' },
    { id: '2', company: '星海互娱', position: '运营' }
  ]);
  assert.strictEqual(groups.length, 2, '两家不同公司必须分开');
  assert.notStrictEqual(groups[0].key, groups[1].key);
});

check('companyGroupIndex 把每条记录映射到所属公司的规范键', () => {
  const index = core.companyGroupIndex([
    { id: '1', company: '腾讯', position: '后端' },
    { id: '2', company: '腾讯科技（深圳）有限公司', position: '前端' },
    { id: '3', company: '星海科技', position: '产品' },
    { id: '4', company: '星海互娱', position: '运营' }
  ]);
  assert.strictEqual(index.get('1'), index.get('2'), '腾讯两条同键');
  assert.strictEqual(index.get('3'), '星海科技');
  assert.strictEqual(index.get('4'), '星海互娱');
  assert.notStrictEqual(index.get('3'), index.get('4'), '星海科技与星海互娱不同键');
  assert.strictEqual(index.get('1'), '腾讯');
});

check('companyColor 同键稳定、取值在色板内', () => {
  const c1 = core.companyColor('腾讯');
  assert.strictEqual(c1, core.companyColor('腾讯'));
  assert.ok(/^#[0-9a-f]{6}$/i.test(c1));
  assert.strictEqual(core.companyColor(''), core.companyColor(''));
});

check('computeFunnel 以「时间线出现过」计入，已结束仍算面试；公司口径去重', () => {
  const recs = [
    { id: '1', company: '腾讯', position: 'A', stage: '已结束', timeline: [{ stage: '已投递', at: '' }, { stage: '笔试', at: '' }, { stage: '一面', at: '' }, { stage: '已结束', at: '' }] },
    { id: '2', company: '腾讯科技有限公司', position: 'B', stage: '已投递', timeline: [{ stage: '已投递', at: '' }] },
    { id: '3', company: '阿里', position: 'C', stage: 'Offer', timeline: [{ stage: '已投递', at: '' }, { stage: '测评', at: '' }, { stage: '一面', at: '' }, { stage: 'Offer', at: '' }] }
  ];
  const f = core.computeFunnel(recs);
  const byKey = list => Object.fromEntries(list.map(s => [s.key, s]));
  const r = byKey(f.byRecord);
  assert.strictEqual(r.applied.count, 3);
  assert.strictEqual(r.assess.count, 2, '笔试与测评各一条');
  assert.strictEqual(r.interview.count, 2, '已结束的那条仍算进面试');
  assert.strictEqual(r.offer.count, 1);
  assert.strictEqual(f.companies, 2);
  assert.strictEqual(byKey(f.byCompany).applied.count, 2, '公司口径去重后为 2 家');
});

check('computeStageDwell 用相邻里程碑日期差求平均', () => {
  const recs = [
    { id: '1', stage: '一面', timeline: [{ stage: '已投递', at: dayOffset(-10, NOW) }, { stage: '笔试', at: dayOffset(-7, NOW) }, { stage: '一面', at: dayOffset(-1, NOW) }] },
    { id: '2', stage: '笔试', timeline: [{ stage: '已投递', at: dayOffset(-9, NOW) }, { stage: '笔试', at: dayOffset(-4, NOW) }] }
  ];
  const dwell = core.computeStageDwell(recs, 5);
  const submitted = dwell.find(d => d.stage === '已投递');
  assert.ok(submitted, '应有「已投递」的停留统计');
  assert.strictEqual(submitted.count, 2);
  // 记录1：已投递(-10) → 笔试(-7) = 3 天；记录2：已投递(-9) → 笔试(-4) = 5 天 → 平均 4 天
  assert.strictEqual(Math.round(submitted.avgDays), 4);
  const written = dwell.find(d => d.stage === '笔试');
  assert.strictEqual(written.count, 1);
  assert.strictEqual(Math.round(written.avgDays), 6, '笔试(-7) → 一面(-1) = 6 天');
  assert.deepStrictEqual(core.computeStageDwell([], 5), []);
});

check('computeDailyApplications + sparklinePath 长度与路径', () => {
  const recs = [
    { id: '1', applicationDate: dayOffset(0, NOW) },
    { id: '2', applicationDate: dayOffset(0, NOW) },
    { id: '3', applicationDate: dayOffset(-3, NOW) },
    { id: '4', applicationDate: dayOffset(-99, NOW) } // 窗口外，不计
  ];
  const daily = core.computeDailyApplications(recs, 14, NOW);
  assert.strictEqual(daily.length, 14);
  assert.strictEqual(daily[13].count, 2, '最后一天是今天');
  const spark = core.sparklinePath(daily, 280, 46);
  assert.strictEqual(spark.total, 3);
  assert.strictEqual(spark.max, 2);
  assert.strictEqual(spark.dots.length, 14);
  assert.ok(spark.line.includes(','));
  assert.ok(spark.area.startsWith('M') && spark.area.endsWith('Z'));
  assert.deepStrictEqual(core.sparklinePath([]), { line: '', area: '', max: 0, total: 0, dots: [] });
});

check('findStalled 只统计进行中且超过阈值', () => {
  const recs = [
    { id: '1', company: 'A', position: 'p', stage: '一面', applicationDate: dayOffset(-20, NOW), timeline: [{ stage: '一面', at: dayOffset(-20, NOW) }] },
    { id: '2', company: 'B', position: 'p', stage: 'Offer', applicationDate: dayOffset(-40, NOW), timeline: [{ stage: 'Offer', at: dayOffset(-40, NOW) }] },
    { id: '3', company: 'C', position: 'p', stage: '已投递', applicationDate: dayOffset(-2, NOW), timeline: [{ stage: '已投递', at: dayOffset(-2, NOW) }] }
  ];
  const stalled = core.findStalled(recs, NOW, 14);
  assert.strictEqual(stalled.length, 1);
  assert.strictEqual(stalled[0].record.id, '1');
  assert.strictEqual(stalled[0].days, 20);
});

check('findUpcomingDeadlines 只返回逾期与 withinDays 内临期，且按紧急度排序、排除已结束/Offer', () => {
  const recs = [
    { id: 'far', company: 'A', position: 'p', stage: '一面', deadline: dayOffset(20, NOW) },
    { id: 'soon', company: 'B', position: 'p', stage: '一面', deadline: dayOffset(2, NOW) },
    { id: 'today', company: 'C', position: 'p', stage: '已投递', deadline: dayOffset(0, NOW) },
    { id: 'over', company: 'D', position: 'p', stage: '已投递', deadline: dayOffset(-5, NOW) },
    { id: 'closed', company: 'E', position: 'p', stage: '已结束', deadline: dayOffset(1, NOW) },
    { id: 'offer', company: 'F', position: 'p', stage: 'Offer', deadline: dayOffset(1, NOW) },
    { id: 'none', company: 'G', position: 'p', stage: '一面', deadline: '' }
  ];
  const hits = core.findUpcomingDeadlines(recs, NOW, 3);
  assert.strictEqual(hits.map(h => h.record.id).join('|'), 'over|today|soon', '逾期最久在前，20 天后的与已结束/Offer/无截止都被排除');
  assert.strictEqual(hits[0].info.level, 'danger');
  assert.strictEqual(hits[1].info.level, 'danger', '今天截止算 danger');
  assert.strictEqual(hits[2].info.level, 'warn');
  // withinDays 放宽后，更远期的也会被纳入
  assert.ok(core.findUpcomingDeadlines(recs, NOW, 30).some(h => h.record.id === 'far'));
  assert.deepStrictEqual(core.findUpcomingDeadlines([], NOW, 3), []);
});

check('collectAlerts danger 优先且受 limit 约束', () => {
  const recs = [
    { id: '1', company: 'A', position: 'p', stage: '已投递', deadline: dayOffset(-1, NOW), scheduleAt: '', applicationDate: dayOffset(-1, NOW), timeline: [{ stage: '已投递', at: dayOffset(-1, NOW) }] },
    { id: '2', company: 'B', position: 'p', stage: '一面', deadline: dayOffset(2, NOW), scheduleAt: '', applicationDate: dayOffset(-30, NOW), timeline: [{ stage: '一面', at: dayOffset(-30, NOW) }] },
    { id: '3', company: 'C', position: 'p', stage: '二面', deadline: '', scheduleAt: '', applicationDate: dayOffset(-40, NOW), timeline: [{ stage: '二面', at: dayOffset(-40, NOW) }] }
  ];
  const alerts = core.collectAlerts(recs, NOW, 5);
  assert.ok(alerts.length >= 3);
  assert.strictEqual(alerts[0].level, 'danger', 'danger 必须排在最前');
  assert.ok(alerts.some(a => a.level === 'warn' && a.text.includes('停在「一面」')));
  assert.ok(alerts.every(a => a.id), '每条都要带 recordId 以便点击跳转');
  assert.strictEqual(core.collectAlerts(recs, NOW, 1).length, 1);
});

check('findDuplicateRecord：同链接判重', () => {
  const recs = [{ id: '1', company: '腾讯', position: '后端', applicationUrl: 'https://x/a', batch: '' }];
  const hit = core.findDuplicateRecord(recs, { company: '别家', position: '别的', applicationUrl: 'https://x/a' });
  assert.strictEqual(hit.mode, 'duplicate');
  assert.strictEqual(hit.reason, 'url');
});

check('findDuplicateRecord：同公司+同岗位+同批次才算重复', () => {
  const recs = [{ id: '1', company: '腾讯科技有限公司', position: '后端开发', applicationUrl: '', batch: '提前批' }];
  const dup = core.findDuplicateRecord(recs, { company: '腾讯', position: '后端开发（提前批）', batch: '提前批' });
  assert.strictEqual(dup.mode, 'duplicate');
  assert.strictEqual(dup.reason, 'company+position+batch');
});

check('findDuplicateRecord：批次不同 → same-company（修复提前批/正式批被误合并）', () => {
  const recs = [{ id: '1', company: '腾讯', position: '后端开发', applicationUrl: '', batch: '提前批' }];
  const res = core.findDuplicateRecord(recs, { company: '腾讯', position: '后端开发', batch: '正式批' });
  assert.strictEqual(res.mode, 'same-company');
  assert.strictEqual(res.matches.length, 1);
});

check('findDuplicateRecord：ignoreBatch=true 时批次不同也判重（插件收录路径）', () => {
  const recs = [{ id: '1', company: '腾讯', position: '后端开发', applicationUrl: '', batch: '提前批' }];
  const res = core.findDuplicateRecord(recs, { company: '腾讯', position: '后端开发' }, { ignoreBatch: true });
  assert.strictEqual(res.mode, 'duplicate');
  assert.strictEqual(res.reason, 'company+position');
});

check('findDuplicateRecord：同公司不同岗位 → same-company；无关联 → null', () => {
  const recs = [{ id: '1', company: '腾讯', position: '后端', applicationUrl: '', batch: '' }];
  assert.strictEqual(core.findDuplicateRecord(recs, { company: '腾讯', position: '前端' }).mode, 'same-company');
  assert.strictEqual(core.findDuplicateRecord(recs, { company: '阿里', position: '前端' }), null);
  assert.strictEqual(core.findDuplicateRecord(recs, { company: '' }), null);
});

check('normalizeRecord 新字段透传：老数据零迁移、新字段不丢、intent 夹取、notes 清洗', () => {
  // 老数据（完全没有 v4.4.0 字段）
  const legacy = core.normalizeRecord({ id: 'old1', company: '星海科技', position: '产品', city: '上海', applicationDate: '2026-09-01', stage: '一面', updatedAt: 1 });
  assert.strictEqual(legacy.deadline, '');
  assert.strictEqual(legacy.batch, '');
  assert.strictEqual(legacy.channel, '');
  assert.strictEqual(legacy.referral, '');
  assert.strictEqual(legacy.salary, '');
  assert.strictEqual(legacy.intent, 0);
  assert.deepStrictEqual(legacy.notes, []);
  assert.strictEqual(legacy.stage, '一面', '旧 stage 仍合成里程碑并派生');
  assert.strictEqual(legacy.timeline.length, 1);
  // 新字段必须原样保留（漏一个就会在每次 load/sync 静默丢失）
  const full = core.normalizeRecord({
    id: 'n1', company: 'A', position: 'B', city: 'C', applicationDate: '2026-09-01',
    deadline: '2026-09-20', batch: '提前批', channel: '内推', referral: '张三', salary: '25k×16', intent: 4,
    notes: [{ id: 'k1', at: 5, text: '一面问了项目' }, { text: '' }, null, { text: '  补一条  ' }],
    timeline: [{ stage: '已投递', at: '2026-09-01', note: '' }, { stage: '一面', at: '2026-09-05', note: '' }]
  });
  assert.strictEqual(full.deadline, '2026-09-20');
  assert.strictEqual(full.batch, '提前批');
  assert.strictEqual(full.channel, '内推');
  assert.strictEqual(full.referral, '张三');
  assert.strictEqual(full.salary, '25k×16');
  assert.strictEqual(full.intent, 4);
  assert.strictEqual(full.notes.length, 2, '空文本与 null 被过滤');
  assert.strictEqual(full.notes[1].text, '补一条', '文本被 trim');
  assert.ok(full.notes[1].id && Number(full.notes[1].at) > 0, '缺 id/at 会补齐');
  // intent 越界夹取
  assert.strictEqual(core.normalizeRecord({ company: 'x', intent: 99 }).intent, 5);
  assert.strictEqual(core.normalizeRecord({ company: 'x', intent: -3 }).intent, 0);
  assert.strictEqual(core.normalizeRecord({ company: 'x', intent: 'abc' }).intent, 0);
});

console.log(`\n${failed ? `存在 ${failed} 个失败` : '网页端校验全部通过'}`);
if (failed) process.exitCode = 1;
