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
const helpers = new Function(`${pureSrc}; return { normalizeCompanySlug, diceCoefficient, companyMatchScore, matchRecordsByCompany, filterMailSuggestions, unionIdList, unionMailState, describeDropReason, normalizeDropStats, mileNoteText };`)();

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

// ===== v4.6.1：邮件丢弃诊断 =====
check('describeDropReason 六种 reason 都有中文标签，未知 reason 回退原文', () => {
  const { describeDropReason } = helpers;
  const expected = {
    'noise-from': '发件人是邮件系统 / 订阅地址',
    'noise-subject': '主题像营销或金融推销',
    'no-keyword': '主题与正文都没命中预筛关键词',
    'ai-not-recruit': 'AI 判定为非招聘邮件',
    'low-conf': 'AI 置信度低于阈值',
    'ai-error': 'AI 调用失败'
  };
  for (const reason of Object.keys(expected)) {
    assert.strictEqual(describeDropReason(reason), expected[reason]);
  }
  // 未知 reason 回退原文而不是吞掉：两端枚举漂移时用户至少能看到原始值，便于报障
  assert.strictEqual(describeDropReason('some-new-reason'), 'some-new-reason');
  assert.strictEqual(describeDropReason(''), '未知原因');
  assert.strictEqual(describeDropReason(null), '未知原因');
  assert.strictEqual(describeDropReason(undefined), '未知原因');
});
check('normalizeDropStats：老 Gist 文件无 lastDropped / 结构非法 / 全 0 → 返回 null（状态栏不显示该段）', () => {
  const { normalizeDropStats } = helpers;
  assert.strictEqual(normalizeDropStats(undefined), null, 'v4.6.0 及更早的 Gist 文件没有该字段');
  assert.strictEqual(normalizeDropStats(null), null);
  assert.strictEqual(normalizeDropStats('oops'), null);
  assert.strictEqual(normalizeDropStats({}), null, '空对象无 total 也无明细 → 不显示');
  assert.strictEqual(normalizeDropStats({ total: 0, recent: [] }), null, '本次一封没丢时显示「丢弃 0 封」只是噪声');
});
check('normalizeDropStats：total 缺失时退回分类求和，明细上限 20 条', () => {
  const { normalizeDropStats } = helpers;
  const s = normalizeDropStats({ noiseFrom: 2, noKeyword: 3, recent: [] });
  assert.strictEqual(s.total, 5, 'Action 没给 total 时用分类求和');
  assert.strictEqual(s.noiseFrom, 2);
  assert.strictEqual(s.aiNotRecruit, 0, '缺失的分类补 0，网页端读取不会得到 undefined');
  const many = { total: 30, recent: Array.from({ length: 30 }, (_, i) => ({ uid: i + 1, from: 'f', subject: 's', reason: 'no-keyword' })) };
  assert.strictEqual(normalizeDropStats(many).recent.length, 20, '明细条数与 Action 侧 DROP_RECENT_MAX 一致');
  // 非法值一律夹到 0，负数不得出现
  const bad = normalizeDropStats({ total: -5, noiseFrom: 'abc', recent: [null, { uid: 1 }] });
  assert.strictEqual(bad.total, 1, 'total 非法时退回明细条数');
  assert.strictEqual(bad.noiseFrom, 0);
  assert.strictEqual(bad.recent.length, 1, '明细里的 null 被滤掉');
});
check('mileNoteText：把历史数据里的「邮件·其它」换成 summary，其余原样保留', () => {
  const { mileNoteText } = helpers;
  // 实测痛点：已入库的 5 条建议 note 都是「邮件·其它」（滴滴/字节/光大/中信/蚂蚁），
  // 而它们的 summary 明明写着有用内容。这条兜底让历史数据不必重扫就立刻变好。
  assert.strictEqual(
    mileNoteText('邮件·其它', '简历成功投递滴滴校招，等待后续流程推进。'),
    '邮件·简历成功投递滴滴校招，等待后续流程推进。'
  );
  assert.strictEqual(mileNoteText('邮件·其他', 'summary 内容'), '邮件·summary 内容', '「其他」写法也要认');
  assert.strictEqual(mileNoteText('邮件 · 其它', 's'), '邮件·s', '分隔符两侧有空格也要认');
  // 有明确类型的原样保留（更短、时间线里易扫读）
  assert.strictEqual(mileNoteText('邮件·测评', '通知参加素质测评，截止9月20日'), '邮件·测评');
  assert.strictEqual(mileNoteText('邮件·面试邀请', '二面通知'), '邮件·面试邀请');
  // 「其它」但没有 summary → 保留原文，不能变成空串或半截「邮件·」
  assert.strictEqual(mileNoteText('邮件·其它', ''), '邮件·其它');
  assert.strictEqual(mileNoteText('邮件·其它', '   '), '邮件·其它');
  assert.strictEqual(mileNoteText('邮件·其它', null), '邮件·其它');
  // 用户自己写的备注绝不能被改写（只有精确匹配「邮件·其它」才兜底）
  assert.strictEqual(mileNoteText('电话面试，面试官是张工', 'x'), '电话面试，面试官是张工');
  assert.strictEqual(mileNoteText('', 'x'), '');
  assert.strictEqual(mileNoteText(null, null), '');
  // 长度上限与 Action 侧 milestoneNote 一致（48 字），否则台账时间线会被长文本挤坏
  assert.ok(mileNoteText('邮件·其它', 'a'.repeat(120)).length <= 48);
});
check('跨仓库契约：网页端 mileNoteText 与 Action 侧 milestoneNote 对同一输入给出相同结果', () => {
  // 两处各自实现同一套「其它→summary」规则：Action 管新数据，网页管历史数据兜底。
  // 若规则漂移（比如一边截 48 字一边截 60 字），同一条建议在新旧两版下显示会不一致。
  const ai = require('../src/ai');
  const cases = [
    ['其它', '简历成功投递滴滴校招，等待后续流程推进。'],
    ['其它', ''],
    ['测评', '通知参加素质测评，截止9月20日12:00'],
    ['面试邀请', '二面通知'],
    ['其它', 'x'.repeat(120)]
  ];
  for (const [emailType, summary] of cases) {
    const actionSide = ai.milestoneNote({ emailType, summary });
    // 网页端拿到的是旧版 Action 写的 note（即「邮件·<type>」），再叠加 summary 兜底
    const webSide = helpers.mileNoteText(`邮件·${emailType}`, summary);
    assert.strictEqual(webSide, actionSide, `emailType=${emailType} summary=${summary.slice(0, 12)}… 两端结果不一致`);
  }
});
check('跨仓库契约：网页端 DROP_REASON_LABELS 的 key 必须与 Action 侧 DROP_REASONS 的值逐一对应', () => {
  // 两端各自维护一份 reason 字面量：Action 写进 meta.lastDropped.recent[].reason，
  // 网页端据此显示中文标签。任一侧增删档位而另一侧没跟上，用户就会看到英文原文
  // （describeDropReason 回退），因此这里把契约钉死。
  const actionConfig = require('../src/config');
  const actionReasons = Object.values(actionConfig.DROP_REASONS).sort();
  // 从 index.html 的纯函数块里取出 DROP_REASON_LABELS 的 key
  const block = pureSrc;
  const start = block.indexOf('const DROP_REASON_LABELS = {');
  assert.ok(start > -1, '未在 index.html 找到 DROP_REASON_LABELS');
  const end = block.indexOf('};', start);
  const literal = block.slice(start + 'const DROP_REASON_LABELS = '.length, end + 1);
  const webReasons = Object.keys(new Function(`return ${literal};`)()).sort();
  assert.deepStrictEqual(webReasons, actionReasons, '两端 reason 枚举必须完全一致');
});
check('跨仓库契约：网页端 MAIL_CFG_DEFAULTS 的键必须与 Action applyMailConfigOverrides 覆盖的键一致', () => {
  // mail-config.json 是「网页写、Action 读」的单向契约，两端各维护一份字段清单。
  // 任一侧加了字段而另一侧没跟上，失效是**静默**的：网页保存成功、Action 也照跑，
  // 只是那个字段永远不起作用（v0.4.0 加 promptOverride 时两端都得改，正是这个风险）。
  const cfgSrc = fs.readFileSync(path.join(__dirname, '../src/config.js'), 'utf8');
  const fnSrc = extractFunction(cfgSrc, 'applyMailConfigOverrides');
  assert.ok(fnSrc, '未在 src/config.js 找到 applyMailConfigOverrides');
  const body = fnSrc.slice(fnSrc.indexOf('return Object.freeze({'));
  assert.ok(body.length > 100, '未定位到 applyMailConfigOverrides 的返回对象');
  // 只取返回对象里的顶层键（4 空格缩进）；`...cfg` 展开与注释行都不会被这个正则命中
  const actionKeys = [...body.matchAll(/^\s{4}(\w+):/gm)].map(m => m[1]).sort();
  const defaultsLine = html.split('\n').find(l => l.includes('const MAIL_CFG_DEFAULTS ='));
  assert.ok(defaultsLine, '未在 index.html 找到 MAIL_CFG_DEFAULTS');
  const webKeys = Object.keys(new Function(`return ${/\{.*\}/.exec(defaultsLine)[0]};`)()).sort();
  assert.ok(actionKeys.length >= 8, `Action 侧应至少覆盖 8 个字段，实际 ${actionKeys.length}（正则可能失配）`);
  assert.deepStrictEqual(webKeys, actionKeys, '两端 mail-config.json 字段清单必须完全一致');
  // 逐个确认关键项都在（防止两边同时漏掉某项而断言仍然通过）
  for (const key of ['keywords', 'minConfidence', 'sinceDays', 'maxPerRun', 'enabled', 'minIntervalHours', 'promptExtra', 'promptOverride']) {
    assert.ok(webKeys.includes(key), `网页端 MAIL_CFG_DEFAULTS 缺 ${key}`);
    assert.ok(actionKeys.includes(key), `Action applyMailConfigOverrides 缺 ${key}`);
  }
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
  const marker = `function ${name}(`;
  let start = src.indexOf(marker);
  if (start === -1) return '';
  // 带上 async 前缀，避免抽出异步函数时 await 变成语法错误
  if (src.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  // 必须先配平参数列表的圆括号再找函数体的 '{'：默认参数写成 `options = {}` 时，
  // 直接 indexOf('{') 会命中默认值里的 '{'，配平后只返回 56 字符的签名（踩过这个坑）。
  let p = src.indexOf('(', start);
  if (p === -1) return '';
  let pDepth = 0;
  let bodyStart = -1;
  for (; p < src.length; p += 1) {
    if (src[p] === '(') pDepth += 1;
    else if (src[p] === ')') { pDepth -= 1; if (pDepth === 0) { bodyStart = p + 1; break; } }
  }
  if (bodyStart === -1) return '';
  let i = src.indexOf('{', bodyStart);
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

const CORE_DEP_NAMES = ['stageOrder', 'parseLocal', 'localDateInput', 'localDateTimeInput', 'formatDate', 'formatDateTime', 'isActive', 'cryptoId', 'sanitizeTimeline', 'deriveStage', 'normalizeRecord', 'escapeHtml'];
const coreDeps = CORE_DEP_NAMES.map(name => extractFunction(html, name));
check('CORE 依赖函数全部从 index.html 抽取到（无复制实现，避免漂移）', () => {
  const missing = CORE_DEP_NAMES.filter((name, idx) => !coreDeps[idx]);
  assert.deepStrictEqual(missing, []);
});

// 顶层常量也现场抽取，不在测试里复制字面量：否则枚举漂移（如企业性质加减档位）后测试仍然「绿」。
function extractConstLine(src, name) {
  const line = src.split('\n').find(l => l.includes(`const ${name} =`));
  return line ? line.trim() : '';
}
const CORE_CONST_NAMES = ['STAGE_PRESETS', 'COMPANY_TYPES', 'COMPANY_TYPE_UNSET'];
const coreConsts = CORE_CONST_NAMES.map(name => extractConstLine(html, name));
check('CORE 依赖的顶层常量全部从 index.html 抽取到', () => {
  const missing = CORE_CONST_NAMES.filter((name, idx) => !coreConsts[idx]);
  assert.deepStrictEqual(missing, []);
});

const core = new Function(
  'self',
  `${coreConsts.join('\n   ')}
   ${pureSrc}
   ${coreDeps.join('\n')}
   ${coreSrc}
   return {
     parseDay, daysUntil, deadlineInfo, collectScheduleEvents, icsEscape, buildIcs, foldIcsLine, utf8Octets,
     companyGroupKey, sameCompanyGroup, groupRecordsByCompany, companyGroupIndex, companyColor, computeFunnel, computeStageDwell,
     computeDailyApplications, sparklinePath, findStalled, findUpcomingDeadlines, collectAlerts,
     normalizeCityKey, cityKeysOf, computeCityStats, computeCompanyTypeStats, tipContentFor,
     normalizePositionSlug, loosePositionSlug, findDuplicateRecord, normalizeRecord
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

check('companyGroupKey + groupRecordsByCompany 把「腾讯」与「腾讯科技有限公司」归为一家', () => {
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

check('companyGroupKey 只剥法人形式后缀，保留行业词（查重与展示共用这一套键）', () => {
  assert.strictEqual(core.companyGroupKey({ company: '腾讯科技（深圳）有限公司' }), '腾讯科技深圳');
  assert.strictEqual(core.companyGroupKey({ company: '星海科技' }), '星海科技', '行业词「科技」不能被剥掉');
  assert.strictEqual(core.companyGroupKey({ company: '某集团股份有限公司' }), '某');
  assert.strictEqual(core.companyGroupKey({ company: 'Ｔｅｎｃｅｎｔ　Ｌｔｄ' }), 'tencent', '全角转半角 + 大小写归一 + 剥 Ltd');
  assert.strictEqual(core.companyGroupKey({ company: '' }), '');
});

check('sameCompanyGroup：与 groupRecordsByCompany 的聚类语义完全一致（相等或互相包含）', () => {
  assert.strictEqual(core.sameCompanyGroup('腾讯', '腾讯'), true);
  assert.strictEqual(core.sameCompanyGroup('腾讯', '腾讯科技'), true, '互相包含 → 同一家（简称与全称）');
  assert.strictEqual(core.sameCompanyGroup('字节', '字节跳动'), true);
  assert.strictEqual(core.sameCompanyGroup('星海科技', '星海互娱'), false, '两家不同公司不得合并');
  assert.strictEqual(core.sameCompanyGroup('小米科技', '小米智能'), false);
  assert.strictEqual(core.sameCompanyGroup('', '腾讯'), false);
  assert.strictEqual(core.sameCompanyGroup('腾', '腾讯'), false, '单字键不参与包含匹配，避免过度合并');
});

check('normalizePositionSlug 保留括号（区分性信息），loosePositionSlug 才去括号且只用于提示', () => {
  assert.strictEqual(core.normalizePositionSlug('后端开发工程师（深圳）'), '后端开发工程师(深圳)', '全角括号归一为半角但内容保留');
  assert.strictEqual(core.normalizePositionSlug('Java 开发工程师'), 'java开发工程师');
  assert.strictEqual(core.normalizePositionSlug('Android开发'), 'android开发');
  assert.notStrictEqual(
    core.normalizePositionSlug('后端开发工程师（深圳）'),
    core.normalizePositionSlug('后端开发工程师（北京）'),
    '两个不同工作地的岗位必须可区分，否则第二个岗位会被判成重复而录不进去'
  );
  assert.strictEqual(core.loosePositionSlug('后端开发工程师（深圳）'), '后端开发工程师');
  assert.strictEqual(core.loosePositionSlug('算法工程师-推荐'), '算法工程师');
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
  const dup = core.findDuplicateRecord(recs, { company: '腾讯', position: '后端开发', batch: '提前批' });
  assert.strictEqual(dup.mode, 'duplicate');
  assert.strictEqual(dup.reason, 'company+position+batch');
  assert.strictEqual(dup.matches[0].id, '1', '公司键统一后，简称与全称也能对上');
});

check('findDuplicateRecord：岗位名仅空格/大小写差异仍判重复（真重复不能漏）', () => {
  const recs = [{ id: '1', company: '字节跳动', position: 'Java 开发工程师', applicationUrl: '', batch: '' }];
  assert.strictEqual(core.findDuplicateRecord(recs, { company: '字节', position: 'Java开发工程师' }).mode, 'duplicate');
  const recs2 = [{ id: '1', company: '小米', position: 'Android开发', applicationUrl: '', batch: '' }];
  assert.strictEqual(core.findDuplicateRecord(recs2, { company: '小米', position: 'android开发' }).mode, 'duplicate');
});

check('findDuplicateRecord：括号里的城市/端/批次不同 → variant（修复「第二个岗位录不进去」）', () => {
  const cases = [
    ['后端开发工程师（深圳）', '后端开发工程师（北京）', '不同工作地'],
    ['客户端开发（iOS）', '客户端开发（Android）', 'iOS 与 Android'],
    ['产品经理（2026届校招）', '产品经理（社招）', '校招岗与社招岗'],
    ['算法工程师-推荐', '算法工程师-广告', '不同方向']
  ];
  for (const [existing, incoming, note] of cases) {
    const recs = [{ id: '1', company: '腾讯', position: existing, applicationUrl: '', batch: '' }];
    const res = core.findDuplicateRecord(recs, { company: '腾讯', position: incoming });
    assert.ok(res, `${note}：应有判定结果`);
    assert.strictEqual(res.mode, 'variant', `${note}：「${existing}」vs「${incoming}」应为 variant 而非 duplicate`);
    assert.strictEqual(res.reason, 'company+position-loose');
  }
});

check('findDuplicateRecord：批次不同 → variant（提前批/正式批不再被误合并）', () => {
  const recs = [{ id: '1', company: '腾讯', position: '后端开发', applicationUrl: '', batch: '提前批' }];
  const res = core.findDuplicateRecord(recs, { company: '腾讯', position: '后端开发', batch: '正式批' });
  assert.strictEqual(res.mode, 'variant');
  assert.strictEqual(res.matches.length, 1);
});

check('findDuplicateRecord：插件不传批次时不再误判为 duplicate（旧版 ignoreBatch:true 的后果）', () => {
  const recs = [{ id: '1', company: '腾讯', position: '后端开发', applicationUrl: '', batch: '提前批' }];
  // 插件收录路径没有批次字段 → seed.batch 恒为空 → 与已有「提前批」不等 → 非阻断放行
  const res = core.findDuplicateRecord(recs, { company: '腾讯', position: '后端开发' });
  assert.strictEqual(res.mode, 'variant');
  assert.notStrictEqual(res.mode, 'duplicate', '绝不能再强制打开旧记录编辑，否则会污染已有里程碑');
});

check('findDuplicateRecord：同公司不同岗位 → same-company；无关联 → null', () => {
  const recs = [{ id: '1', company: '腾讯', position: '后端', applicationUrl: '', batch: '' }];
  assert.strictEqual(core.findDuplicateRecord(recs, { company: '腾讯', position: '前端' }).mode, 'same-company');
  assert.strictEqual(core.findDuplicateRecord(recs, { company: '阿里', position: '前端' }), null);
  assert.strictEqual(core.findDuplicateRecord(recs, { company: '' }), null);
});

check('展示分组与查重判定必须同源（修复前 5 个案例里 3 个自相矛盾，现在 0 个）', () => {
  // 期望值按 companyGroupKey 的实际语义推导：LEGAL_SUFFIX_RE 会剥掉「集团/有限公司/股份」等法人后缀，
  // 因此「商汤集团」→「商汤」，与「商汤科技」构成互相包含 → 判为同一家（保守键的既定取舍）。
  const cases = [
    ['星海科技', '星海互娱', false, '行业词不同 → 两家'],
    ['字节', '字节跳动', true, '简称与全称'],
    ['腾讯', '腾讯科技（深圳）有限公司', true, '简称与法人全称'],
    ['商汤科技', '商汤集团', true, '「集团」是法人后缀被剥掉 → 商汤 ⊂ 商汤科技'],
    ['小米科技', '小米智能', false, '行业词不同 → 两家']
  ];
  for (const [a, b, expectSame, note] of cases) {
    const groups = core.groupRecordsByCompany([
      { id: '1', company: a, position: '后端' }, { id: '2', company: b, position: '前端' }
    ]);
    const displaySame = groups.length === 1;
    const dup = core.findDuplicateRecord(
      [{ id: '1', company: a, position: '后端', batch: '' }],
      { company: b, position: '前端' }
    );
    // 岗位不同 → 同公司时应命中（same-company），不同公司时应为 null
    const dedupSame = !!dup;
    assert.strictEqual(displaySame, expectSame, `${a} / ${b} 展示分组（${note}）`);
    assert.strictEqual(dedupSame, expectSame, `${a} / ${b} 查重判定必须与展示分组一致（${note}）`);
  }
});

console.log('v4.6.0 城市分布与企业性质统计');

check('洞察面板信息层级：概览 → 行动 → 转化 → 明细（重构后不得回退）', () => {
  // 重构前指标条夹在两张图之后、最需要行动的「需要关注」被压到第 5 块。
  // 这条断言把顺序钉住：以后往面板里加块时若插错位置会立刻失败，而不是靠人眼复核。
  const panel = html.slice(html.indexOf('id="insightsBody"'), html.indexOf('id="distributionTitle"'));
  assert.ok(panel.length > 500, '未定位到洞察面板 HTML');
  const order = ['insightMetrics', 'alertList', 'funnelRow', 'insightDetails', 'cityList', 'ctypeBar', 'sparkSvg', 'dwellList', 'multiCompanyWrap', 'offerMatrixWrap'];
  const positions = order.map(id => panel.indexOf(`id="${id}"`));
  assert.ok(positions.every(p => p > 0), `有块缺失：${order.filter((id, i) => positions[i] < 0).join(', ')}`);
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i] > positions[i - 1], `${order[i]} 应排在 ${order[i - 1]} 之后（概览→行动→转化→明细）`);
  }
  // 明细块必须都在 insightDetails 容器内，精简模式才能整块折叠
  const detailsStart = panel.indexOf('id="insightDetails"');
  for (const id of ['cityList', 'ctypeBar', 'sparkSvg', 'dwellList', 'multiCompanyWrap', 'offerMatrixWrap']) {
    assert.ok(panel.indexOf(`id="${id}"`) > detailsStart, `${id} 必须在 #insightDetails 内`);
  }
  // 概览与行动块不能被折进明细容器，否则精简模式会把最该看的信息一起藏掉
  for (const id of ['insightMetrics', 'alertList', 'funnelRow']) {
    assert.ok(panel.indexOf(`id="${id}"`) < detailsStart, `${id} 必须在 #insightDetails 之外`);
  }
});

check('normalizeCityKey：剥行政后缀、全角归一、占位值等同未填', () => {
  assert.strictEqual(core.normalizeCityKey('深圳市'), '深圳');
  assert.strictEqual(core.normalizeCityKey('深圳'), '深圳');
  assert.strictEqual(core.normalizeCityKey(' 上海 '), '上海');
  assert.strictEqual(core.normalizeCityKey('上海'), '上海', '「海」不是行政后缀，不能被剥掉');
  assert.strictEqual(core.normalizeCityKey('香港特别行政区'), '香港');
  assert.strictEqual(core.normalizeCityKey('ＳＨＥＮＺＨＥＮ'), 'shenzhen', '全角字母 → 半角小写');
  assert.strictEqual(core.normalizeCityKey('市'), '', '纯后缀输入不留残骸');
  for (const unknown of ['待确认', '待定', '待补充', '未知', '不限', '', null, undefined, '   ', 'N/A', '-']) {
    assert.strictEqual(core.normalizeCityKey(unknown), '', `${JSON.stringify(unknown)} 应归为未填`);
  }
});

check('cityKeysOf：多城市拆分、归一化后去重、占位值不产出键', () => {
  assert.deepStrictEqual(core.cityKeysOf({ city: '深圳/广州' }), ['深圳', '广州']);
  assert.deepStrictEqual(core.cityKeysOf({ city: '北京、上海' }), ['北京', '上海']);
  assert.deepStrictEqual(core.cityKeysOf({ city: '深圳,深圳市' }), ['深圳'], '归一化后重复要去掉');
  assert.deepStrictEqual(core.cityKeysOf({ city: '待确认' }), []);
  assert.deepStrictEqual(core.cityKeysOf({ city: '' }), []);
  assert.deepStrictEqual(core.cityKeysOf({}), []);
  assert.deepStrictEqual(core.cityKeysOf(null), []);
});

check('computeCityStats：多城市各计一次、Offer 率、未填桶排最后且不计入城市数', () => {
  const recs = [
    { id: '1', company: '腾讯', position: 'a', city: '深圳', stage: 'Offer' },
    { id: '2', company: '腾讯科技', position: 'b', city: '深圳', stage: '一面' },
    { id: '3', company: '阿里', position: 'c', city: '杭州/北京', stage: '已投递' },
    { id: '4', company: '某司', position: 'd', city: '待确认', stage: '已投递' },
    { id: '5', company: '某司2', position: 'e', city: '', stage: 'Offer' }
  ];
  const stats = core.computeCityStats(recs);
  const byCity = Object.fromEntries(stats.map(row => [row.city, row]));
  assert.strictEqual(byCity['深圳'].total, 2);
  assert.strictEqual(byCity['深圳'].offers, 1);
  assert.strictEqual(byCity['深圳'].offerRate, 0.5);
  assert.strictEqual(byCity['深圳'].companies, 1, '腾讯与腾讯科技算同一家公司');
  assert.strictEqual(byCity['杭州'].total, 1);
  assert.strictEqual(byCity['北京'].total, 1, '一条记录写了两个城市 → 各计一次');
  assert.strictEqual(byCity[''].total, 2, '「待确认」与空值都进未填桶');
  assert.strictEqual(byCity[''].offers, 1, '未填桶的 Offer 数是真实统计，不是假 0');
  assert.strictEqual(stats[0].city, '深圳', '按投递数降序');
  assert.strictEqual(stats[stats.length - 1].city, '', '未填桶永远排最后');
  assert.strictEqual(stats.filter(row => row.city).length, 3, '「覆盖 N 个城市」不含未填桶');
  // 各城市之和 > 台账条数，这是刻意口径（多城市各计一次），面板必须写明，否则会被当成算错
  assert.strictEqual(stats.reduce((sum, row) => sum + row.total, 0), 6);
  assert.deepStrictEqual(core.computeCityStats([]), []);
  assert.deepStrictEqual(core.computeCityStats(null), []);
});

check('computeCompanyTypeStats：固定 4 行顺序，非法值落未设置，空台账也给出 4 行', () => {
  const recs = [
    { id: '1', company: '国家电网', position: 'a', city: '北京', companyType: '央国企', stage: 'Offer' },
    { id: '2', company: '字节', position: 'b', city: '北京', companyType: '民企', stage: '一面' },
    { id: '3', company: '宝洁', position: 'c', city: '广州', companyType: '外企', stage: '已结束' },
    { id: '4', company: '某司', position: 'd', city: '上海', companyType: '', stage: '已投递' },
    { id: '5', company: '某司2', position: 'e', city: '上海', companyType: '国企', stage: '已投递' }
  ];
  const stats = core.computeCompanyTypeStats(recs);
  assert.deepStrictEqual(stats.map(row => row.label), ['央国企', '民企', '外企', '未设置'], '顺序固定，面板结构才稳定');
  assert.deepStrictEqual(stats.map(row => row.type), ['央国企', '民企', '外企', ''], 'type 用空串表示未设置，便于按值查色');
  assert.strictEqual(stats[0].total, 1);
  assert.strictEqual(stats[0].offers, 1);
  assert.strictEqual(stats[0].offerRate, 1);
  assert.strictEqual(stats[1].active, 1, '一面算在流程中');
  assert.strictEqual(stats[2].active, 0, '已结束不算在流程中');
  assert.strictEqual(stats[3].total, 2, '空值与非法值「国企」都落未设置');
  assert.strictEqual(stats.reduce((sum, row) => sum + row.total, 0), recs.length, '四档之和 = 台账条数（不像城市那样会重复计）');
  const empty = core.computeCompanyTypeStats([]);
  assert.strictEqual(empty.length, 4, '空台账也必须给 4 行，用户才能分辨「这档没有」与「没渲染出来」');
  assert.ok(empty.every(row => row.total === 0 && row.offers === 0 && row.offerRate === 0));
});

check('tipContentFor metric：每个指标都有口径说明，未知 key 返回空串', () => {
  for (const key of ['companies', 'cities', 'flow', 'stalled', 'offers', 'alerts']) {
    const out = core.tipContentFor([], 'metric', key);
    assert.ok(out.includes('tip-note'), `${key} 应给出说明`);
    assert.ok(out.length > 30, `${key} 的说明不能是一句空话`);
  }
  // 城市口径必须写明「多城市各计一次」，否则各城市之和 > 台账条数会被当成算错
  assert.ok(core.tipContentFor([], 'metric', 'cities').includes('各计一次'));
  assert.strictEqual(core.tipContentFor([], 'metric', 'nope'), '', '未知 key 不弹空壳');
  assert.strictEqual(core.tipContentFor([], 'metric', ''), '');
});

check('tipContentFor city：头部给汇总、明细列到记录，未填桶也有内容，超量截断', () => {
  const recs = [
    { id: '1', company: '腾讯', position: '后端', city: '深圳', stage: 'Offer', batch: '提前批' },
    { id: '2', company: '腾讯科技', position: '前端', city: '深圳市', stage: '一面', batch: '' },
    { id: '3', company: '某司', position: '运营', city: '待确认', stage: '已投递' }
  ];
  const out = core.tipContentFor(recs, 'city', '深圳');
  assert.ok(out.includes('深圳 · 2 条投递'), '「深圳市」归一化后与「深圳」同桶');
  assert.ok(out.includes('1 家公司'), '腾讯与腾讯科技聚类为一家');
  assert.ok(out.includes('1 个 Offer'));
  assert.ok(out.includes('后端（提前批）'), '岗位带批次');
  assert.ok(out.includes('data-stage="Offer"'), '每行带阶段徽章');
  // 未填桶（key=''）也要能查，否则灰显那一行悬浮没反应像是坏了
  const unknown = core.tipContentFor(recs, 'city', '');
  assert.ok(unknown.includes('没填城市'), '用用户能懂的话，而不是空白标题');
  assert.ok(unknown.includes('运营'));
  assert.strictEqual(core.tipContentFor(recs, 'city', '成都'), '', '没有该城市不弹空壳');
  // 超过上限要截断并交代还剩多少，不能悄悄丢掉
  const many = Array.from({ length: 15 }, (_, i) => ({ id: `m${i}`, company: `公司${i}`, position: `岗位${i}`, city: '北京', stage: '已投递' }));
  const big = core.tipContentFor(many, 'city', '北京');
  assert.strictEqual((big.match(/tip-row/g) || []).length, 12, '最多列 12 条');
  assert.ok(big.includes('另有 3 条'), '交代剩余条数');
});

check('tipContentFor ctype：按公司聚类列出并给最好阶段，空档返回空串', () => {
  const recs = [
    { id: '1', company: '国家电网', position: 'a', city: '北京', companyType: '央国企', stage: '一面' },
    { id: '2', company: '国家电网', position: 'b', city: '上海', companyType: '央国企', stage: 'Offer' },
    { id: '3', company: '字节', position: 'c', city: '北京', companyType: '民企', stage: '已投递' }
  ];
  const out = core.tipContentFor(recs, 'ctype', '央国企');
  assert.ok(out.includes('央国企 · 2 条投递 · 1 家公司'), '同一家公司两个岗位只算一家');
  assert.ok(out.includes('1 个 Offer'));
  assert.ok(out.includes('2 个岗位'), '标出该公司岗位数');
  assert.ok(out.includes('data-stage="Offer"'), '最好阶段取 stageOrder 最大的那个，而不是第一条');
  assert.ok(core.tipContentFor(recs, 'ctype', '民企').includes('字节'));
  assert.strictEqual(core.tipContentFor(recs, 'ctype', '外企'), '', '这一档没有记录 → 不弹空壳');
  // 未设置档用空串做 key（与 data-ct="" 对应）
  assert.ok(core.tipContentFor([{ id: '9', company: 'X', position: 'p', city: 'C', companyType: '', stage: '已投递' }], 'ctype', '').includes('未设置'));
});

check('tipContentFor record：只列有值的字段，企业性质未设置显式标注，未知 id 返回空串', () => {
  const recs = [{ id: 'r1', company: '腾讯', position: '后端', city: '深圳', batch: '', companyType: '', stage: '一面', nextAction: '准备二面' }];
  const out = core.tipContentFor(recs, 'record', 'r1');
  assert.ok(out.includes('tip-head">腾讯'), '标题是公司名');
  assert.ok(out.includes('准备二面'));
  assert.ok(out.includes('未设置'), '企业性质没填也要显式说出来');
  assert.ok(!out.includes('>批次<'), '空字段不占一行');
  assert.strictEqual(core.tipContentFor(recs, 'record', 'nope'), '');
  assert.strictEqual(core.tipContentFor(recs, 'unknown-kind', 'r1'), '', '未知 kind 不弹空壳');
});

check('tipContentFor：用户数据一律转义（悬浮层是 innerHTML 注入点）', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const recs = [{ id: 'e1', company: evil, position: evil, city: '深圳', stage: '已投递', nextAction: evil }];
  for (const out of [core.tipContentFor(recs, 'city', '深圳'), core.tipContentFor(recs, 'record', 'e1')]) {
    assert.ok(!out.includes('<img'), '不得出现原始标签');
    assert.ok(out.includes('&lt;img'), '应被转义');
  }
  const evilType = [{ id: 'e2', company: evil, position: 'p', city: 'C', companyType: '央国企', stage: '已投递' }];
  assert.ok(!core.tipContentFor(evilType, 'ctype', '央国企').includes('<img'));
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

check('normalizeRecord companyType：白名单校验，老数据与非法值一律归「未设置」', () => {
  // 老数据（v4.5.0 之前，完全没有该字段）→ ''，且不报错、其余字段零丢失
  const legacy = core.normalizeRecord({ id: 'old2', company: '星海科技', position: '产品', city: '上海', applicationDate: '2026-09-01', stage: '一面', batch: '提前批', intent: 3 });
  assert.strictEqual(legacy.companyType, '');
  assert.strictEqual(legacy.batch, '提前批', '既有字段不受新字段影响');
  assert.strictEqual(legacy.intent, 3);
  // 三个合法档位原样保留
  for (const type of ['央国企', '民企', '外企']) {
    assert.strictEqual(core.normalizeRecord({ company: 'x', companyType: type }).companyType, type);
  }
  // 非法值一律归 ''：自由文本、近似写法、null、数字、带空格
  for (const bad of ['国企', '央企', '民营企业', 'state-owned', null, undefined, 0, 1, {}, '央国企 ']) {
    const got = core.normalizeRecord({ company: 'x', companyType: bad }).companyType;
    // '央国企 ' 带尾空格应被 trim 后接受，其余全部归 ''
    assert.strictEqual(got, bad === '央国企 ' ? '央国企' : '', `companyType=${JSON.stringify(bad)} 应归一，实际 ${JSON.stringify(got)}`);
  }
});

console.log('hidden 与 display 的冲突守卫（防「幽灵占位 + 吞点击」）');
// 作者层的 display 会覆盖 UA 的 [hidden]{display:none}。凡是被 hidden 切换、自身又设了 display 的容器，
// 必须显式补一条 [hidden] 守卫，否则关闭态仍然占位并拦截点击（.view 早有守卫，.drawer/.insights-body 曾漏）。
check('被 hidden 切换且设了 display 的容器都有 [hidden]{display:none} 守卫', () => {
  const styleStart = html.indexOf('<style>');
  const styleEnd = html.indexOf('</style>');
  // 必须先去掉注释：注释里常出现「display:none」「[hidden]」这类字样，会把选择器解析污染
  const css = html.slice(styleStart, styleEnd).replace(/\/\*[\s\S]*?\*\//g, '');
  const setsDisplay = new Set();   // 设了非 none display 的选择器
  const hiddenGuards = new Set();  // 形如 .x[hidden] / #x[hidden] 的守卫目标
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = ruleRe.exec(css)) !== null) {
    const selectors = match[1].split(',').map(s => s.trim()).filter(Boolean);
    const body = match[2];
    const displayNone = /(?:^|;|\s)display:\s*none/.test(body);
    const displayOther = /(?:^|;|\s)display:\s*(?!none)[a-z-]+/i.test(body);
    for (const sel of selectors) {
      if (displayOther && !sel.includes('[hidden]')) setsDisplay.add(sel);
      if (displayNone && sel.includes('[hidden]')) {
        const guardMatch = /^([.#][\w-]+)\[hidden\]$/.exec(sel);
        if (guardMatch) hiddenGuards.add(guardMatch[1]);
      }
    }
  }
  // 目标元素：① HTML 上带 hidden 属性的；② JS 里通过 $('#id').hidden 切换的（HTML 上未必有初始属性）
  const targets = [];
  const pushTarget = (id, classes) => targets.push({ id, classes });
  const hiddenAttrRe = /<([a-z]+)([^>]*\shidden)([^>]*)>/gi;
  while ((match = hiddenAttrRe.exec(html)) !== null) {
    const attrs = `${match[2]}${match[3]}`;
    const id = /id="([\w-]+)"/.exec(attrs);
    const cls = /class="([^"]+)"/.exec(attrs);
    pushTarget(id ? id[1] : null, cls ? cls[1].trim().split(/\s+/) : []);
  }
  const jsBody = html.slice(html.indexOf('<script>'));
  const jsHiddenIds = new Set();
  const jsRe = /\$\('#([\w-]+)'\)\s*\.\s*hidden\s*=/g;
  while ((match = jsRe.exec(jsBody)) !== null) jsHiddenIds.add(match[1]);
  for (const id of jsHiddenIds) {
    const tagRe = new RegExp(`<[a-z]+[^>]*\\sid="${id}"[^>]*>`, 'i');
    const tagMatch = tagRe.exec(html);
    const cls = tagMatch ? /class="([^"]+)"/.exec(tagMatch[0]) : null;
    pushTarget(id, cls ? cls[1].trim().split(/\s+/) : []);
  }
  // 由 JS 变量间接切换（如 body.hidden = showGuide、details.hidden = compact）的容器：显式登记，避免漏检。
  // 这两个都设了作者层 display，是「幽灵占位 + 吞点击」的高危对象。
  pushTarget('insightsBody', ['insights-body']);
  pushTarget('insightDetails', ['insight-details']);

  const problems = [];
  for (const target of targets) {
    const keys = [...(target.id ? [`#${target.id}`] : []), ...target.classes.map(c => `.${c}`)];
    for (const key of keys) {
      if (setsDisplay.has(key) && !hiddenGuards.has(key)) {
        problems.push(`${key} 设了 display 却没有 ${key}[hidden]{display:none} 守卫`);
      }
    }
  }
  assert.deepStrictEqual(problems, []);
  // 守卫本身也要真的被识别到（防止解析漏判导致空过）
  assert.ok(hiddenGuards.has('.view'), '.view 的守卫应被识别到');
  assert.ok(hiddenGuards.has('.drawer'), '.drawer 的守卫应被识别到');
  assert.ok(hiddenGuards.has('.insights-body'), '.insights-body 的守卫应被识别到');
  assert.ok(hiddenGuards.has('.ocr-results'), '.ocr-results 的守卫应被识别到');
  assert.ok(targets.length >= 8, `应扫到足够多的 hidden 目标，实际 ${targets.length}`);
});

console.log(`\n${failed ? `存在 ${failed} 个失败` : '网页端校验全部通过'}`);
if (failed) process.exitCode = 1;
