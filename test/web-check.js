'use strict';
// ============================================================================
// test/web-check.js — 网页端（autumn-recruitment-tracker/index.html）本地校验：
//   1) 内联 <script> 用 vm.Script 做语法校验（只编译不执行，无需 DOM）；
//   2) 按 src/bundle.js 的清单加载已拆分的纯函数模块（mail/ 与 core/），跑单测：
//      normalizeCompanySlug / diceCoefficient / matchRecordsByCompany / filterMailSuggestions
//      （0/1/多命中、后缀剥离、全半角）。
//   3) 构建链守卫：清单与磁盘一致、模块标记顶格、splice 不得用 String.replace、产物一致。
// 运行：node test/web-check.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const HTML_PATH = path.resolve(__dirname, '../index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');
// 阶段 3 起 index.html 是**构建产物**（源在 src/）。本文件绝大多数断言检查的是产物
// （CSS 规则、版本号、[hidden] 显示冲突、窄屏列轨道……），所以继续读产物是对的；
// 只有"抠函数体丢进沙箱跑"那类才改读 src/，见下面的 loadSrc 用法。
const loadSrc = require('./lib/load-src');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failed += 1; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

// ---- 阶段 3：构建链守卫 ----
// 这四条守的是"拆分本身"引入的新失效面。共同特征都是**不报错型**：清单漏文件、标记带缩进、
// splice 被改成 replace、忘记 build——构建全绿、语法全对，但上线的代码与你以为的不是同一份。
console.log('构建链守卫（src/ 清单 · 标记形态 · splice 实现 · 产物一致性）');

check('src/bundle.js 清单与磁盘双向一致：清单里的文件都在，磁盘上没有清单外的孤儿', () => {
  const listed = new Set([
    'template.html',
    ...loadSrc.BUNDLE.styles,
    ...loadSrc.BUNDLE.app.flatMap(e => (typeof e === 'string' ? [e] : e.files))
  ]);
  const absent = [...listed].filter(rel => !fs.existsSync(path.join(loadSrc.SRC, rel)));
  assert.deepStrictEqual(absent, [], '清单里这些文件在磁盘上不存在');
  // 反向：磁盘上不在清单里的文件永远不会进产物，等于死代码（更糟的是它看起来像有效源码）
  const walk = (dir, prefix) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name), prefix + e.name + '/') : [prefix + e.name]);
  const orphans = walk(loadSrc.SRC, '').filter(f => f !== 'bundle.js' && !listed.has(f));
  assert.deepStrictEqual(orphans, [], '这些 src/ 文件不在拼接清单里，永远不会进产物');
});

check('模块标记必须顶格：带缩进的话那几个空格会残留进产物（多出的缩进让 SHA 变化）', () => {
  for (const rel of loadSrc.BUNDLE.app.filter(e => typeof e === 'string')) {
    for (const line of loadSrc.read(rel).split('\n')) {
      if (line.includes('__MODULE:')) {
        assert.strictEqual(line, line.trim(),
          `src/${rel} 里的模块标记带了缩进：${JSON.stringify(line)}`);
      }
    }
  }
});

check('build.js 的 splice 用 split/join，不得用 String.replace（$& 陷阱会静默改写代码）', () => {
  const buildSrc = fs.readFileSync(path.resolve(__dirname, '../build.js'), 'utf8');
  const m = /function splice\([\s\S]*?\n\}/.exec(buildSrc);
  assert.ok(m, 'build.js 里找不到 splice 函数');
  assert.ok(!/\.replace\(/.test(m[0]),
    'splice 里出现了 .replace(：replace 的第二个字符串参数会把 $& 当成「匹配到的内容」、' +
    "$' 当成「匹配点之后的文本」，而内联 JS 有 156 个模板字面量满是这类字符——" +
    '代码被静默改写、语法仍合法、构建也不报错');
  assert.ok(/\.split\(m\)\.join\(content\)/.test(m[0]), 'splice 应当是 split(marker).join(content)');
});

check('产物一致性：dist/index.html 与入库的 index.html 逐字节相同', () => {
  const distHtml = path.resolve(__dirname, '../dist/index.html');
  if (!fs.existsSync(distHtml)) {
    console.log('    （dist/ 不存在，跳过；npm test 会先跑 node build.js）');
    return;
  }
  const built = fs.readFileSync(distHtml, 'utf8');
  if (built !== html) {
    const a = built.split('\n'), b = html.split('\n');
    let i = 0;
    while (i < Math.min(a.length, b.length) && a[i] === b[i]) i += 1;
    assert.fail(`构建产物与入库的 index.html 不同，首个差异在第 ${i + 1} 行。\n` +
      '      要么改了 src/ 忘记 `npm run build:write`，要么手改了 index.html 而没改 src/。');
  }
});

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

// ---- 2) 加载已拆分的纯函数模块并单测 ----
console.log('邮件匹配纯函数单测');
// 阶段 3：这一块已拆成 src/mail/pure.js（140 行，10 个函数只调用彼此与内置方法，完全自洽）。
// 原先这里是手写 indexOf/slice 从 6892 行产物里抠两个标记之间的内容——标记名拼错、或有人
// 改动了那行注释，就会静默抠出空串，接着 new Function 里 10 个符号全成 undefined，
// 报错信息（"normalizeCompanySlug is not defined"）离真实原因（一个标记名）非常远。
const pureSrc = loadSrc.mailSrc;
check('邮件纯函数模块已按清单加载（不再靠标记文本定位）', () => {
  assert.deepStrictEqual(loadSrc.moduleFiles('mail'), ['mail/pure.js']);
  assert.ok(pureSrc.length > 500, `mail/pure.js 过短或未读到：${pureSrc.length}`);
});
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
  const ai = require('../services/mail-sync/src/ai');
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
  const actionConfig = require('../services/mail-sync/src/config');
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
  const cfgSrc = fs.readFileSync(path.join(__dirname, '../services/mail-sync/src/config.js'), 'utf8');
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
// extractBlock 已删除：CORE_PURE 拆成 src/core/ 六个文件后，本文件不再需要从产物里
// 按标记抠块（web-runtime.js 还在用它抽洞察段与台账段，那两处本轮不动）。

console.log('v4.4.0 核心纯函数单测（截止日 / 日程事件 / ICS / 公司分组 / 漏斗 / 停留 / 卡点 / 查重）');
const coreSrc = loadSrc.coreSrc;
check('CORE 纯函数模块已按清单加载（6 个文件，531 行）', () => {
  assert.strictEqual(loadSrc.moduleFiles('core').length, 6, 'src/core/ 应为 6 个文件');
  assert.ok(coreSrc.length > 500, `CORE 块过短或未读到：${coreSrc.length}`);
});

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
const CORE_CONST_NAMES = ['STAGE_PRESETS', 'COMPANY_TYPES', 'COMPANY_TYPE_UNSET', 'COMPANY_TYPE_ALIASES'];
const coreConsts = CORE_CONST_NAMES.map(name => extractConstLine(html, name));
check('CORE 依赖的顶层常量全部从 index.html 抽取到', () => {
  const missing = CORE_CONST_NAMES.filter((name, idx) => !coreConsts[idx]);
  assert.deepStrictEqual(missing, []);
});

// v4.9.0：跨端常量与归一化实现移入仓库根 shared/，index.html 里只剩**转发别名**
// （块外的 `const STAGE_PRESETS = AJA.STAGE_PRESETS;`，与 CORE 块内的
// `const companyGroupKey = AJA.companyGroupKey;` 等四个）。沙箱必须注入真实的 AJA，
// 否则这些行会因 AJA 未定义直接抛错。
// ⚠️ 注入之后**防护强度不得降级**：extractConstLine 原本的价值是「抓 index.html 里真实生效的
// 字面量」，现在字面量没了，就必须另有断言盯着"那几行只能是转发"——见下面的别名守卫。
// 少了它，谁把 index.html 改回字面量并写错一个值，测试依然全绿（那正是本机制原本要防的事）。
const AJA_SHARED = Object.assign({},
  require(path.resolve(__dirname, '../shared/stages.js')),
  require(path.resolve(__dirname, '../shared/company-types.js')),
  require(path.resolve(__dirname, '../shared/company-key.js')),
  require(path.resolve(__dirname, '../shared/default-resume.js'))
);

// 别名守卫：index.html 里这些行只能是 `= AJA.X`，不得是数组/对象字面量或实现体。
// 用正则而不是求值比对——求值比对会因为"沙箱里的 AJA 就来自 shared"而恒真（自己比自己）。
const ALIAS_ONLY = {
  STAGE_PRESETS: /^const STAGE_PRESETS = AJA\.STAGE_PRESETS;$/,
  COMPANY_TYPES: /^const COMPANY_TYPES = AJA\.COMPANY_TYPES;$/,
  COMPANY_TYPE_UNSET: /^const COMPANY_TYPE_UNSET = AJA\.COMPANY_TYPE_UNSET;$/,
  COMPANY_TYPE_ALIASES: /^const COMPANY_TYPE_ALIASES = AJA\.COMPANY_TYPE_ALIASES;$/,
  DEFAULT_RESUME: /^const DEFAULT_RESUME = AJA\.DEFAULT_RESUME;$/,
  companyGroupKey: /^const companyGroupKey = AJA\.companyGroupKey;$/,
  sameCompanyGroup: /^const sameCompanyGroup = AJA\.sameCompanyGroup;$/,
  normalizePositionSlug: /^const normalizePositionSlug = AJA\.normalizePositionSlug;$/,
  loosePositionSlug: /^const loosePositionSlug = AJA\.loosePositionSlug;$/
};
check('别名守卫：index.html 的九个跨端符号只能是 shared 的转发，不得再出现第二份字面量/实现', () => {
  for (const [name, re] of Object.entries(ALIAS_ONLY)) {
    const line = html.split('\n').find(l => l.includes(`const ${name} =`));
    assert.ok(line, `index.html 里找不到 ${name} 的声明行`);
    assert.ok(re.test(line.trim()),
      `${name} 不是 shared 的转发别名（可能又出现了第二份字面量或实现体）：\n      ${line.trim()}`);
  }
  // 反向兜底：整份 index.html 里不该再有这些字面量/实现体
  assert.ok(!/const STAGE_PRESETS = \[/.test(html), 'index.html 又出现了阶段字面量');
  assert.ok(!/const COMPANY_TYPES = \[/.test(html), 'index.html 又出现了企业性质字面量');
  assert.ok(!/const COMPANY_TYPE_ALIASES = \{/.test(html), 'index.html 又出现了企业性质别名表字面量');
  assert.ok(!/const LEGAL_SUFFIX_RE = \//.test(html), 'index.html 又出现了法人后缀正则副本');
  assert.ok(!/function companyGroupKey\(/.test(html), 'index.html 又出现了 companyGroupKey 的实现体');
  assert.ok(!/function sameCompanyGroup\(/.test(html), 'index.html 又出现了 sameCompanyGroup 的实现体');
  assert.ok(!/function normalizePositionSlug\(/.test(html), 'index.html 又出现了 normalizePositionSlug 的实现体');
  assert.ok(!/function loosePositionSlug\(/.test(html), 'index.html 又出现了 loosePositionSlug 的实现体');
  assert.ok(!/const DEFAULT_RESUME = \{/.test(html), 'index.html 又出现了默认简历字面量');
});

const core = new Function(
  'self', 'AJA',
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
)(globalThis, AJA_SHARED);

// 注入的 AJA 必须真的被用上了：core 里的这四个符号应与 shared 的实现是同一引用。
// 这条断言把「沙箱注入了 AJA」与「index.html 的别名确实转发」两件事绑在一起验证，
// 缺任何一边都会红——比只看文本正则强。
check('CORE 沙箱里的归一化函数与 shared 是同一引用（转发链路真的通了）', () => {
  assert.strictEqual(core.companyGroupKey, AJA_SHARED.companyGroupKey);
  assert.strictEqual(core.sameCompanyGroup, AJA_SHARED.sameCompanyGroup);
  assert.strictEqual(core.normalizePositionSlug, AJA_SHARED.normalizePositionSlug);
  assert.strictEqual(core.loosePositionSlug, AJA_SHARED.loosePositionSlug);
});

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
  const recs = [{ id: '1', company: '腾讯', position: '后端', applicationUrl: 'https://x/a' }];
  const hit = core.findDuplicateRecord(recs, { company: '别家', position: '别的', applicationUrl: 'https://x/a' });
  assert.strictEqual(hit.mode, 'duplicate');
  assert.strictEqual(hit.reason, 'url');
});

check('findDuplicateRecord：同公司+同机构+同岗位才算重复', () => {
  const recs = [{ id: '1', company: '腾讯科技有限公司', position: '后端开发', applicationUrl: '', orgUnit: '云计算事业部' }];
  const dup = core.findDuplicateRecord(recs, { company: '腾讯', position: '后端开发', orgUnit: '云计算事业部' });
  assert.strictEqual(dup.mode, 'duplicate');
  assert.strictEqual(dup.reason, 'company+unit+position');
  assert.strictEqual(dup.matches[0].id, '1', '公司键统一后，简称与全称也能对上');
});

check('findDuplicateRecord：岗位名仅空格/大小写差异仍判重复（真重复不能漏）', () => {
  const recs = [{ id: '1', company: '字节跳动', position: 'Java 开发工程师', applicationUrl: '' }];
  assert.strictEqual(core.findDuplicateRecord(recs, { company: '字节', position: 'Java开发工程师' }).mode, 'duplicate');
  const recs2 = [{ id: '1', company: '小米', position: 'Android开发', applicationUrl: '' }];
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
    const recs = [{ id: '1', company: '腾讯', position: existing, applicationUrl: '' }];
    const res = core.findDuplicateRecord(recs, { company: '腾讯', position: incoming });
    assert.ok(res, `${note}：应有判定结果`);
    assert.strictEqual(res.mode, 'variant', `${note}：「${existing}」vs「${incoming}」应为 variant 而非 duplicate`);
    assert.strictEqual(res.reason, 'company+position-loose');
  }
});

check('findDuplicateRecord：机构不同 → variant（杭州分行/成都分行不再被误合并）', () => {
  const recs = [{ id: '1', company: '招商银行', position: '客户经理', applicationUrl: '', orgUnit: '杭州分行' }];
  const res = core.findDuplicateRecord(recs, { company: '招商银行', position: '客户经理', orgUnit: '成都分行' });
  assert.strictEqual(res.mode, 'variant');
  assert.strictEqual(res.matches.length, 1);
});

check('findDuplicateRecord：新记录没填机构、已有记录填了 → 不误判 duplicate（旧版 ignoreBatch:true 的后果）', () => {
  const recs = [{ id: '1', company: '招商银行', position: '客户经理', applicationUrl: '', orgUnit: '杭州分行' }];
  // seed.orgUnit 为空 → 与已有「杭州分行」不等 → 非阻断放行，让用户自己决定是不是同一条
  const res = core.findDuplicateRecord(recs, { company: '招商银行', position: '客户经理' });
  assert.strictEqual(res.mode, 'variant');
  assert.notStrictEqual(res.mode, 'duplicate', '绝不能再强制打开旧记录编辑，否则会污染已有里程碑');
});

check('findDuplicateRecord：同公司不同岗位 → same-company；无关联 → null', () => {
  const recs = [{ id: '1', company: '腾讯', position: '后端', applicationUrl: '' }];
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
      [{ id: '1', company: a, position: '后端' }],
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
  // v4.8.0：阶段分布（stageGrid）从独立 panel 并入洞察常驻区，与转化漏斗同排；
  // 面板结束边界随之从已删除的 distributionTitle 改为紧随其后的「未来安排」aside（id="upcoming"）。
  const panel = html.slice(html.indexOf('id="insightsBody"'), html.indexOf('id="upcoming"'));
  assert.ok(panel.length > 500, '未定位到洞察面板 HTML');
  // v4.11.0 换位：阶段分布提到整宽第 2 位（14 个色阶块在半宽的一半里每块只有 ~44px，
  // 灰→蓝→绿的递进看不清），需要关注移进 grid 与漏斗并排。常驻区仍是这四块，精简模式不变。
  const order = ['insightMetrics', 'stageGrid', 'funnelRow', 'alertList', 'insightDetails', 'cityList', 'ctypeBar', 'sparkSvg', 'dwellList', 'multiCompanyWrap', 'offerMatrixWrap'];
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
  // 概览、行动、转化漏斗与阶段分布都是常驻区，不能被折进明细容器（否则精简模式会把它们一起藏掉）
  for (const id of ['insightMetrics', 'alertList', 'funnelRow', 'stageGrid']) {
    assert.ok(panel.indexOf(`id="${id}"`) < detailsStart, `${id} 必须在 #insightDetails 之外（常驻区）`);
  }
});

check('阶段分布独占整宽、漏斗与需要关注同排（v4.11.0 换位后的结构）', () => {
  // stageGrid 的 id 不变（els.stageGrid / renderDistribution 零改动）。旧的独立
  // <section class="panel distribution"> 必须消失，否则会出现两个 stageGrid 或两处标题。
  assert.ok(!/class="panel distribution"/.test(html), '独立的 .distribution panel 外壳应已删除');
  assert.ok(!/id="distributionTitle"/.test(html), '旧的 distributionTitle 应随外壳一起删除');
  const stageGridCount = (html.match(/id="stageGrid"/g) || []).length;
  assert.strictEqual(stageGridCount, 1, '#stageGrid 必须唯一');
  // 换位前 stageGrid 与 funnelRow 同在两列 grid 里各占一半；换位后 stageGrid 必须是
  // **整宽的独立块**（不在任何 .insight-grid 内），漏斗与需要关注并排。
  const gridStart = html.lastIndexOf('class="insight-grid"', html.indexOf('id="funnelRow"'));
  const gridSlice = html.slice(gridStart, html.indexOf('id="insightDetails"'));
  assert.ok(gridSlice.includes('id="funnelRow"') && gridSlice.includes('id="alertList"'), '漏斗与需要关注应同处一个 .insight-grid');
  assert.ok(!gridSlice.includes('id="stageGrid"'), '阶段分布必须移出 .insight-grid——整宽才放得下 14 个色阶块');
  assert.ok(html.indexOf('id="stageGrid"') < gridStart, '阶段分布应排在 .insight-grid 之前');
  assert.ok(/阶段分布[\s\S]*?当前存量，按阶段计数/.test(html.slice(html.indexOf('id="insightsBody"'), gridStart)),
    '阶段分布块头应带口径说明，与漏斗的「累计转化」区分');
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
    { id: '2', company: '字节', position: 'b', city: '北京', companyType: '私企', stage: '一面' },
    { id: '3', company: '宝洁', position: 'c', city: '广州', companyType: '外企', stage: '已结束' },
    { id: '4', company: '某司', position: 'd', city: '上海', companyType: '', stage: '已投递' },
    { id: '5', company: '某司2', position: 'e', city: '上海', companyType: '国企', stage: '已投递' }
  ];
  const stats = core.computeCompanyTypeStats(recs);
  assert.deepStrictEqual(stats.map(row => row.label), ['央国企', '私企', '外企', '未设置'], '顺序固定，面板结构才稳定');
  assert.deepStrictEqual(stats.map(row => row.type), ['央国企', '私企', '外企', ''], 'type 用空串表示未设置，便于按值查色');
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
    { id: '1', company: '腾讯', position: '后端', city: '深圳', stage: 'Offer', orgUnit: '云计算事业部' },
    { id: '2', company: '腾讯科技', position: '前端', city: '深圳市', stage: '一面', orgUnit: '' },
    { id: '3', company: '某司', position: '运营', city: '待确认', stage: '已投递' }
  ];
  const out = core.tipContentFor(recs, 'city', '深圳');
  assert.ok(out.includes('深圳 · 2 条投递'), '「深圳市」归一化后与「深圳」同桶');
  assert.ok(out.includes('1 家公司'), '腾讯与腾讯科技聚类为一家');
  assert.ok(out.includes('1 个 Offer'));
  assert.ok(out.includes('后端（云计算事业部）'), '岗位带机构');
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
    { id: '3', company: '字节', position: 'c', city: '北京', companyType: '私企', stage: '已投递' }
  ];
  const out = core.tipContentFor(recs, 'ctype', '央国企');
  assert.ok(out.includes('央国企 · 2 条投递 · 1 家公司'), '同一家公司两个岗位只算一家');
  assert.ok(out.includes('1 个 Offer'));
  assert.ok(out.includes('2 个岗位'), '标出该公司岗位数');
  assert.ok(out.includes('data-stage="Offer"'), '最好阶段取 stageOrder 最大的那个，而不是第一条');
  assert.ok(core.tipContentFor(recs, 'ctype', '私企').includes('字节'));
  assert.strictEqual(core.tipContentFor(recs, 'ctype', '外企'), '', '这一档没有记录 → 不弹空壳');
  // 未设置档用空串做 key（与 data-ct="" 对应）
  assert.ok(core.tipContentFor([{ id: '9', company: 'X', position: 'p', city: 'C', companyType: '', stage: '已投递' }], 'ctype', '').includes('未设置'));
});

check('tipContentFor record：只列有值的字段，企业性质未设置显式标注，未知 id 返回空串', () => {
  const recs = [{ id: 'r1', company: '腾讯', position: '后端', city: '深圳', orgUnit: '', companyType: '', stage: '一面', nextAction: '准备二面' }];
  const out = core.tipContentFor(recs, 'record', 'r1');
  assert.ok(out.includes('tip-head">腾讯'), '标题是公司名');
  assert.ok(out.includes('准备二面'));
  assert.ok(out.includes('未设置'), '企业性质没填也要显式说出来');
  assert.ok(!out.includes('>机构<'), '空字段不占一行');
  assert.ok(!out.includes('>批次<'), '批次一行已随字段删除（不是"值为空所以不显示"）');
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

check('企业性质改名（民企→私企）：别名表合法、读时迁移生效、CSS 选择器与枚举一一对应', () => {
  const aliases = require(path.resolve(__dirname, '../shared/company-types.js')).COMPANY_TYPE_ALIASES;
  const types = require(path.resolve(__dirname, '../shared/company-types.js')).COMPANY_TYPES;
  // ① 别名的**值**必须都是合法档位。迁到一个不在枚举里的值等于没迁：
  //    紧接着的白名单校验会把它打回「未设置」，用户看到的就是"我明明选过、统计里没有"。
  for (const [from, to] of Object.entries(aliases)) {
    assert.ok(types.includes(to), `别名 ${from} → ${to}，但 ${to} 不在 COMPANY_TYPES 里（迁移后会被白名单打回未设置）`);
    assert.ok(!types.includes(from), `别名键 ${from} 仍是现行档位，说明改名没改干净`);
  }
  assert.strictEqual(aliases['民企'], '私企', '旧档位「民企」必须能迁到「私企」');
  // ② 读时迁移真的生效（不是只写在注释里）
  assert.strictEqual(core.normalizeRecord({ id: 'm1', company: 'A', position: 'B', city: 'C', applicationDate: '2026-09-01', companyType: '民企' }).companyType, '私企');
  assert.strictEqual(core.normalizeRecord({ id: 'm2', company: 'A', position: 'B', city: 'C', applicationDate: '2026-09-01', companyType: '私企' }).companyType, '私企');
  assert.strictEqual(core.normalizeRecord({ id: 'm3', company: 'A', position: 'B', city: 'C', applicationDate: '2026-09-01', companyType: '不存在档' }).companyType, '', '非法值仍归未设置');
  // ③ CSS 的 [data-ct="…"] 选择器必须与枚举**一一对应**。
  //    企业性质的配色靠属性选择器命中，改档位名而漏改 CSS 不会报错 —— 徽章还在、字还在，
  //    只是静默退化成灰色兜底色。三处：洞察比例条 .ctype-seg、图例圆点 .ctype-legend-row、台账徽章 .ct-chip。
  const cssSelectors = [...new Set([...html.matchAll(/\[data-ct="([^"]+)"\]/g)].map(m => m[1]))].filter(v => v !== '');
  assert.deepStrictEqual(cssSelectors.slice().sort(), [...types].sort(),
    `CSS 的 data-ct 选择器 ${JSON.stringify(cssSelectors)} 与企业性质枚举 ${JSON.stringify(types)} 不一致`);
  for (const t of types) {
    for (const sel of ['.ctype-seg', '.ctype-legend-row', '.ct-chip']) {
      assert.ok(html.includes(`${sel}[data-ct="${t}"]`), `${sel} 缺 ${t} 的配色规则（会静默变灰）`);
    }
  }
});

check('normalizeRecord 新字段透传：老数据零迁移、新字段不丢、intent 夹取、notes 清洗', () => {
  // 老数据（完全没有 v4.4.0 字段）
  const legacy = core.normalizeRecord({ id: 'old1', company: '星海科技', position: '产品', city: '上海', applicationDate: '2026-09-01', stage: '一面', updatedAt: 1 });
  assert.strictEqual(legacy.deadline, '');
  assert.strictEqual(legacy.orgUnit, '', 'v4.11.0 新增的机构：老数据缺省为空');
  assert.strictEqual(legacy.referral, '');
  assert.strictEqual(legacy.salary, '');
  assert.strictEqual(legacy.intent, 0);
  assert.deepStrictEqual(legacy.notes, []);
  assert.strictEqual(legacy.stage, '一面', '旧 stage 仍合成里程碑并派生');
  assert.strictEqual(legacy.timeline.length, 1);
  // 新字段必须原样保留（漏一个就会在每次 load/sync 静默丢失）
  const full = core.normalizeRecord({
    id: 'n1', company: 'A', position: 'B', city: 'C', applicationDate: '2026-09-01',
    deadline: '2026-09-20', orgUnit: '云计算事业部', referral: '张三', salary: '25k×16', intent: 4,
    // 旧备份里还可能带着已删除的字段：导入时应当被**忽略**（不报错、也不留成僵尸数据）
    batch: '提前批', channel: '内推',
    notes: [{ id: 'k1', at: 5, text: '一面问了项目' }, { text: '' }, null, { text: '  补一条  ' }],
    timeline: [{ stage: '已投递', at: '2026-09-01', note: '' }, { stage: '一面', at: '2026-09-05', note: '' }]
  });
  assert.strictEqual(full.deadline, '2026-09-20');
  assert.strictEqual(full.orgUnit, '云计算事业部');
  assert.strictEqual(full.referral, '张三');
  // 已删除的字段必须**真的不在**结果里（而不是留一个空值）。
  // normalizeRecord 是白名单式重建，留着不显示的字段会变成僵尸数据：
  // 导入导出还在传、每次 load/sync 还在清洗，但界面上没人看得见 —— 比删掉更容易出问题。
  assert.ok(!('batch' in full), 'batch 应已彻底删除，不得复活');
  assert.ok(!('channel' in full), 'channel 应已彻底删除，不得复活');
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
  // 这里用 referral 当"既有字段"的代表：它和 batch/channel 同属 v4.4.0 那批新增字段，
  // 但 batch 与 channel 已在 v4.11.0 删除（机构 orgUnit 接替了 batch 的区分职责），
  // referral 承载的是具体的人与联系方式，与「渠道=内推」这种分类标签不是一回事，刻意保留。
  const legacy = core.normalizeRecord({ id: 'old2', company: '星海科技', position: '产品', city: '上海', applicationDate: '2026-09-01', stage: '一面', referral: '张三', intent: 3 });
  assert.strictEqual(legacy.companyType, '');
  assert.strictEqual(legacy.referral, '张三', '既有字段不受新字段影响');
  assert.strictEqual(legacy.intent, 3);
  // 三个合法档位原样保留
  for (const type of ['央国企', '私企', '外企']) {
    assert.strictEqual(core.normalizeRecord({ company: 'x', companyType: type }).companyType, type);
  }
  // 非法值一律归 ''：自由文本、近似写法、null、数字、带空格
  // 注意「民营企业」**不在**这个清单里 —— v4.11.0 起它是「私企」的旧写法别名（读时迁移）。
  // 把它归 '' 才是 bug：用户的老数据会静默从企业性质统计里消失，而界面上看不出任何异常。
  // 别名表与迁移行为由前面那条「企业性质改名（民企→私企）」专门盯。
  for (const bad of ['国企', '央企', 'state-owned', null, undefined, 0, 1, {}, '央国企 ']) {
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

console.log('v4.8.0 投递记录独立视图：路由 / 导航 / 命令面板 / 视图容器');

check('投递记录视图容器存在，且位于总览之后、岗位库之前（与导航顺序一致）', () => {
  const overview = html.indexOf('data-view="overview"');
  const records = html.indexOf('data-view="records"');
  const jobPool = html.indexOf('data-view="jobPool"');
  assert.ok(overview > 0 && records > 0 && jobPool > 0, '三个视图容器都应存在');
  assert.ok(overview < records && records < jobPool, `顺序应为 overview < records < jobPool，实际 ${overview} / ${records} / ${jobPool}`);
  // 记录视图默认隐藏，靠既有的 .view[hidden]{display:none} 守卫（下方 hidden 守卫会复核）
  assert.ok(/<div class="view" data-view="records" hidden>/.test(html), 'records 视图初始应带 hidden');
});

check('记录面板迁移后所有既有 id 原样保留（els 映射与事件绑定零改动的前提）', () => {
  // 迁移的铁律：id 一个都不能变，否则 els.* / addEventListener 全部失联
  const ids = ['records', 'resultCaption', 'viewTableBtn', 'viewBoardBtn', 'searchInput', 'stageFilter', 'sortSelect', 'groupToggle', 'recordsTableScroll', 'recordBody', 'boardView', 'boardCols', 'emptyState'];
  const missing = ids.filter(id => !new RegExp(`id="${id}"`).test(html));
  assert.deepStrictEqual(missing, [], `记录面板缺失 id：${missing.join(', ')}`);
  // 这些 id 都必须落在 records 视图容器内（而不是散落到别处）
  const recStart = html.indexOf('data-view="records"');
  const recEnd = html.indexOf('data-view="jobPool"');
  const recSlice = html.slice(recStart, recEnd);
  const outside = ids.filter(id => !recSlice.includes(`id="${id}"`));
  assert.deepStrictEqual(outside, [], `这些 id 不在 records 视图内：${outside.join(', ')}`);
});

check('VIEW_META 新增 records、overview 副标题不再提「台账」', () => {
  const start = html.indexOf('const VIEW_META = {');
  assert.ok(start > -1, '未找到 VIEW_META');
  const end = html.indexOf('};', start);
  const meta = new Function(`return ${html.slice(start + 'const VIEW_META = '.length, end + 1)};`)();
  assert.ok(meta.records, 'VIEW_META 应有 records 项');
  assert.strictEqual(meta.records.title, '投递记录');
  assert.strictEqual(meta.records.kicker, 'PIPELINE');
  assert.ok(/看板|表格/.test(meta.records.subtitle), 'records 副标题应点出表格/看板双视图');
  assert.ok(!meta.overview.subtitle.includes('台账'), '台账已移出总览，overview 副标题不应再提「台账」');
});

check('ROUTE_ALIASES：records 恢复为独立视图，upcoming 仍并入总览', () => {
  const line = html.split('\n').find(l => l.includes('const ROUTE_ALIASES ='));
  assert.ok(line, '未找到 ROUTE_ALIASES');
  const aliases = new Function(`return ${/\{.*\}/.exec(line)[0]};`)();
  assert.strictEqual(aliases.records, 'records', '#/records 应解析到 records 视图本身，而非重定向到 overview');
  assert.strictEqual(aliases.upcoming, 'overview', '未来安排仍在总览');
  assert.strictEqual(aliases.overview, 'overview');
});

check('导航 6 项且顺序为 总览 / 投递记录 / 邮件提醒 / 我的简历 / 岗位库 / 工具', () => {
  const navStart = html.indexOf('<nav class="sidebar-nav">');
  const navEnd = html.indexOf('</nav>', navStart);
  const nav = html.slice(navStart, navEnd);
  const routes = [...nav.matchAll(/data-route="([\w-]+)"/g)].map(m => m[1]);
  const labels = [...nav.matchAll(/<span>([^<]+)<\/span>/g)].map(m => m[1]);
  assert.deepStrictEqual(routes, ['overview', 'records', 'mail', 'resume', 'jobPool', 'tools']);
  assert.deepStrictEqual(labels, ['总览', '投递记录', '邮件提醒', '我的简历', '岗位库', '工具']);
  // 投递记录复用既有 #i-stack sprite，不新增 symbol
  assert.ok(/data-route="records"[^>]*>[\s\S]*?#i-stack/.test(nav), 'records 导航项应复用 #i-stack 图标');
});

check('switchView 在切到 records 时触发 renderRecordsView（切回时台账/看板保持最新）', () => {
  const start = html.indexOf('function switchView(');
  assert.ok(start > -1, '未找到 switchView');
  const body = html.slice(start, html.indexOf('\n      }', start));
  assert.ok(/if \(route === 'records'\) renderRecordsView\(\);/.test(body), 'switchView 应包含 records → renderRecordsView 的调用');
});

check('⌘K 命令面板与 / 快捷键都指向 #/records（搜索框已随台账迁入记录视图）', () => {
  assert.ok(html.includes("{ label: '投递记录', hash: '#/records' }"), '⌘K 视图跳转项应含投递记录');
  // 搜索台账动作与 / 快捷键：搜索框现在在记录视图，必须切到 #/records 再 focus
  assert.ok(/location\.hash = '#\/records'; if \(els\.search\) els\.search\.focus\(\);/.test(html), '搜索台账动作应切到 #/records');
  assert.ok(/if \(parseRoute\(\) !== 'records'\) location\.hash = '#\/records';/.test(html), '/ 快捷键应切到 #/records');
  // 不应再有把搜索/台账指向 overview 的残留
  assert.ok(!/location\.hash = '#\/overview'; if \(els\.search\)/.test(html), '不应残留「切到 overview 再聚焦搜索」的旧逻辑');
});

check('台账列隐藏的中间断点从 1100px 下调到 900px（记录视图独占全宽后可用宽度更大）', () => {
  assert.ok(/@media \(max-width: 900px\) and \(min-width: 561px\)/.test(html), '应存在 900px 的中间断点');
  const block = html.slice(html.indexOf('@media (max-width: 900px) and (min-width: 561px)'));
  const rule = block.slice(0, block.indexOf('}') + 1);
  assert.ok(rule.includes('#records'), '该断点作用于台账表格 #records');
  assert.ok(!/@media \(max-width: 1100px\) and \(min-width: 561px\)/.test(html), '旧的 1100px 台账断点应已下调');
});

console.log('单 class 选择器唯一性守卫（防「querySelector 命中错误元素」）');
// $('.xxx') 只返回文档里第一个匹配元素。一旦同一个 class 被两个容器复用（如 v4.6.0 的
// Offer 对比矩阵与台账表格都用 .table-scroll），$('.table-scroll') 就会静默命中错误的那个——
// 运行时不报错，只表现为「隐藏错了元素」（台账切看板时表格不消失、Offer 矩阵反被藏起来）。
// 这类缺陷人工复核发现不了，必须用静态守卫钉死：凡是纯单 class 选择器命中的 class，
// 在 HTML 里只能出现一次，否则要求改用唯一 id。（querySelectorAll 的多元素查询不在此列。）
check('$(\'.xxx\') 纯单 class 选择器命中的 class 在 HTML 里必须唯一', () => {
  const styleStart = html.indexOf('<style>');
  const styleEnd = html.indexOf('</style>');
  // 只在标记与脚本之外的 HTML 结构里数 class，避免把 CSS 选择器（.table-scroll{}）当成元素
  const markup = html.slice(0, styleStart) + html.slice(styleEnd);
  const classCount = new Map();
  const classAttrRe = /class="([^"]*)"/g;
  let match;
  while ((match = classAttrRe.exec(markup)) !== null) {
    for (const tok of match[1].trim().split(/\s+/)) {
      if (tok) classCount.set(tok, (classCount.get(tok) || 0) + 1);
    }
  }
  const singleClassSelRe = /\$\('\.([\w-]+)'\)/g;
  const offenders = [];
  const seen = new Set();
  while ((match = singleClassSelRe.exec(html)) !== null) {
    const cls = match[1];
    if (seen.has(cls)) continue;
    seen.add(cls);
    const n = classCount.get(cls) || 0;
    if (n >= 2) offenders.push(`$('.${cls}') 命中 ${n} 个元素，querySelector 只返回第一个会选错，应改用唯一 id`);
  }
  assert.deepStrictEqual(offenders, []);
  // 自检①：守卫确实数到了 class（正则没失配）——.table-scroll 天生有两个容器（Offer 矩阵 + 台账）
  assert.ok((classCount.get('table-scroll') || 0) >= 2, '应数到两个 .table-scroll 容器，否则计数正则失配');
  // 自检②：把判定逻辑跑在合成样本上，确认它真能把 $('.table-scroll') 判为不合格（守卫不是空过）
  const sample = "$('.table-scroll').hidden = true; $('#recordsTableScroll').hidden = false; $('.some-unique-block').focus();";
  const sampleOffenders = [];
  const sampleRe = /\$\('\.([\w-]+)'\)/g;
  while ((match = sampleRe.exec(sample)) !== null) {
    if ((classCount.get(match[1]) || 0) >= 2) sampleOffenders.push(match[1]);
  }
  assert.deepStrictEqual(sampleOffenders, ['table-scroll'], '守卫必须拦下对 .table-scroll 的单 class 选择器，且不误伤 id 与唯一 class');
});

console.log('版本号一致性（发版链 6 处，防漏改导致缓存不刷新 / 文档与实现漂移）');
check('网页版本号 6 处一致：APP_VERSION / service-worker CACHE_NAME / download 页脚 / README / 使用说明 / CHANGELOG 顶部', () => {
  const root = path.resolve(__dirname, '..');
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  const appVersion = /const APP_VERSION = '([^']+)'/.exec(html)[1];
  const cacheVersion = /autumn-tracker-app-v([0-9.]+)/.exec(read('service-worker.js'))[1];
  const footerVersion = /网页 v([0-9.]+)/.exec(read('download.html'))[1];
  const readmeVersion = /网页：v([0-9.]+)/.exec(read('README.md'))[1];
  const usageVersion = /网页 v([0-9.]+)/.exec(read('使用说明.txt'))[1];
  assert.strictEqual(cacheVersion, appVersion, `service-worker CACHE_NAME (${cacheVersion}) 必须与 APP_VERSION (${appVersion}) 一致，否则旧缓存不刷新`);
  assert.strictEqual(footerVersion, appVersion, `download.html 页脚 (${footerVersion}) 必须与 APP_VERSION 一致`);
  assert.strictEqual(readmeVersion, appVersion, `README (${readmeVersion}) 必须与 APP_VERSION 一致`);
  assert.strictEqual(usageVersion, appVersion, `使用说明.txt (${usageVersion}) 必须与 APP_VERSION 一致`);
  // 不硬编码期望版本号：那样每次发版都得改测试，忘了就假红，而且它并不校验一致性
  // （上面四条已经做了）。改为盯 CHANGELOG 顶部条目——这能抓到两种真实漏改：
  // 「升了版但忘了写 CHANGELOG」与「写了 CHANGELOG 但忘了升 APP_VERSION」。
  const changelogTop = /^## v([0-9.]+)/m.exec(read('CHANGELOG.md'));
  assert.ok(changelogTop, 'CHANGELOG.md 找不到形如「## v4.9.1」的顶部条目');
  assert.strictEqual(changelogTop[1], appVersion,
    `CHANGELOG 顶部条目 (v${changelogTop[1]}) 必须与 APP_VERSION (${appVersion}) 一致`);
});

check('插件版本号 11 处一致（补的缺口：此前插件版本无任何断言，漂移到 v3.1.0 都没人发现）', () => {
  // 为什么补这条：上一条守卫只校验**网页**版本的 5 处，插件版本一处都没盯。
  // 实测后果是 README.md 的插件版本停在 v3.1.0、使用说明.txt 停在 v4.2.0（实际早已 v5.x），
  // 漂移了整整两个大版本都没人发现——用户照文档核对版本时会以为自己装错了，
  // 而「插件改了代码但浏览器没重新加载就仍跑旧版」这个坑恰恰需要靠版本号来自证。
  const root = path.resolve(__dirname, '..');
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  const manifestVersion = JSON.parse(read('extension/manifest.json')).version;
  const found = {
    'manifest.json 的 version': manifestVersion,
    'constants.js 的 AJA.VERSION': /root\.AJA\.VERSION = '([^']+)'/.exec(read('extension/common/constants.js'))[1],
    'download.html 插件卡片 meta': /插件 v([0-9.]+)/.exec(read('download.html'))[1],
    'download.html 下载文件名': /秋招求职与简历助手-v([0-9.]+)\.zip/.exec(read('download.html'))[1],
    'download.html 页脚': /插件 v([0-9.]+)<br>/.exec(read('download.html'))[1],
    'README.md 下载表格': /插件 v([0-9.]+)/.exec(read('README.md'))[1],
    'README.md 版本小节': /浏览器插件：v([0-9.]+)/.exec(read('README.md'))[1],
    '使用说明.txt': /插件 v([0-9.]+)/.exec(read('使用说明.txt'))[1],
    'extension/README.md 标题': /扩展 v([0-9.]+)/.exec(read('extension/README.md'))[1],
    'extension/README.md 版本小节': /扩展：v([0-9.]+)/.exec(read('extension/README.md'))[1],
    // docs 也要覆盖：这一处是本轮补写守卫时才发现的（当时写着上一轮的 v5.0.0），
    // 说明"只盯 README 与下载页"不够——用户看的恰恰是 docs 里的安装教程
    'docs/安装与使用教程.md': /助手」（v([0-9.]+)）/.exec(read('docs/安装与使用教程.md'))[1]
  };
  assert.strictEqual(Object.keys(found).length, 11, '应校验 11 处（新增展示位时记得同步本断言）');
  for (const [where, v] of Object.entries(found)) {
    assert.strictEqual(v, manifestVersion, `${where} = ${v}，与 manifest.json 的 ${manifestVersion} 不一致`);
  }
});

// ---- 静默故障守卫：这几个问题不报错、不崩溃，只会在事后发现数据不对 ----
console.log('\n静默故障守卫（不报错型缺陷）');

check('scheduleSyncPush 不得在 syncBusy 时直接丢弃这次推送', () => {
  const m = html.match(/function scheduleSyncPush\(\)\s*\{[\s\S]*?\n {6}\}/);
  assert.ok(m, '找不到 scheduleSyncPush 函数体');
  assert.ok(!/if\s*\([^)]*\|\|\s*syncBusy\)\s*return/.test(m[0]),
    '不得把 token 与 syncBusy 合并成一句 return——那样忙碌期间的变更**永不上推**（静默丢同步）');
  assert.ok(/syncPushPending\s*=\s*true/.test(m[0]), '忙碌期间应记下 syncPushPending，等 finally 补推');
});

check('syncNow 的 finally 必须补推 syncPushPending', () => {
  const m = html.match(/finally\s*\{\s*\n\s*syncBusy = false;[\s\S]{0,240}?\n\s*\}/);
  assert.ok(m, '找不到 syncNow 的 finally 块');
  assert.ok(/syncPushPending/.test(m[0]),
    'finally 里只把 syncBusy 置回 false 而不补推，pending 标志就永远悬着，等于没修');
});

check('persistResume 必须写快照层（createEnvelope 含 resume，漏了会恢复出旧简历）', () => {
  const m = html.match(/function persistResume\(\)\s*\{[\s\S]*?\n {6}\}/);
  assert.ok(m, '找不到 persistResume 函数体');
  assert.ok(/persistSafetyLayers/.test(m[0]),
    'saveRecords 一直通过 persistenceQueue 调 persistSafetyLayers；persistResume 漏了 → '
    + 'localStorage 损坏时从 IndexedDB 恢复出来的是旧简历（投递记录反而是新的）');
  const iSavedAt = m[0].indexOf('resumeSavedAt = Date.now()');
  const iEnvelope = m[0].indexOf('createEnvelope(');
  assert.ok(iSavedAt > -1 && iEnvelope > iSavedAt,
    'createEnvelope 必须在 resumeSavedAt 更新之后调用，否则快照里的 savedAt 是上一次的');
});

check('窄屏布局守卫：.view 的列轨道与 .mail-head-actions 的换行（两处都是不报错型缺陷）', () => {
  // 缺陷 1（窄屏实测整页横向滚动 +342px）：.view 不写 grid-template-columns 时隐式列轨道由内容
  // 决定，.panel 的 min-width:auto 解析成 min-content，台账表格与看板四列会把列撑宽，
  // 于是 .table-scroll / .board-cols 的 overflow-x:auto 永远失效。
  const viewRule = /\.view \{[^}]*\}/.exec(html);
  assert.ok(viewRule, '找不到 .view 规则');
  assert.ok(/grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(viewRule[0]),
    '.view 必须有 grid-template-columns: minmax(0, 1fr)，否则窄屏下内部滚动容器失效、整页横滚');
  // 缺陷 2（窄屏实测按钮被挤成竖排文字的 60px 高药丸）：CJK 文本允许逐字断行，
  // flex 不换行时按钮会被压到最小内容宽。wrap 与 nowrap 缺一即回归。
  const mailActions = /\.mail-head-actions \{[^}]*\}/.exec(html);
  assert.ok(mailActions && /flex-wrap:\s*wrap/.test(mailActions[0]),
    '.mail-head-actions 必须有 flex-wrap: wrap，否则窄屏下按钮被压缩');
  const mailBtn = /\.mail-head-actions \.btn \{[^}]*\}/.exec(html);
  assert.ok(mailBtn && /white-space:\s*nowrap/.test(mailBtn[0]),
    '.mail-head-actions .btn 必须有 white-space: nowrap，否则中文会逐字竖排');
});

check('示例数据标记必须持久化（刷新丢失的三个后果都不报错：引导消失 / 示例被当真实数据 / 开同步时被静默丢弃）', () => {
  // 裸赋值会绕过持久化：sampleDataMode = true/false 只允许出现在声明处 1 次，
  // 其余赋值必须走 setSampleMode（它同时写/删 localStorage flag）。
  const assigns = html.match(/sampleDataMode\s*=\s*(?:true|false)\s*;/g) || [];
  assert.strictEqual(assigns.length, 1,
    `sampleDataMode 的裸赋值应只剩声明处 1 处（实得 ${assigns.length}），其余必须走 setSampleMode`);
  assert.ok(/let sampleDataMode = false;/.test(html), '声明处应在');
  assert.ok(/const SAMPLE_FLAG_KEY = /.test(html), '应有持久化 flag 的 key');
  assert.ok(/localStorage\.removeItem\(SAMPLE_FLAG_KEY\)/.test(html),
    'setSampleMode(false) 必须删 flag，否则清空/keep/云同步丢弃后刷新又变回示例态');
  assert.ok(/localStorage\.getItem\(SAMPLE_FLAG_KEY\)/.test(html), '刷新后必须读回 flag');
});

// ---- v4.11.0 台账与简历优化的守卫 ----
// 七条守的都是「不报错型」缺陷：编号悄悄重排、某个字段类型删不掉、窄屏只能横滚、
// 分组与排序又耦回去、已删字段复活成僵尸数据、新区块又硬编码成空对象。
// 共同特征是构建全绿、语法全对、界面看着也正常，只会在事后发现数据或行为不对。
console.log('v4.11.0 守卫（编号 / 字段删除 / 看板窄屏 / 收纳解耦 / orgUnit 全链路 / 死字段零残留 / 区块类型）');

check('台账编号按 applicationDate 升序，不得用 updatedAt（编辑一条就跳到 #0001、其余全部顺移）', () => {
  const m = /const recordNo = new Map\([\s\S]*?\);/.exec(html);
  assert.ok(m, '找不到 recordNo 的构造');
  assert.ok(/applicationDate/.test(m[0]), '编号必须基于投递日期');
  // 旧实现按 updatedAt 降序，注释却写着「编辑不会重排」——两者矛盾：编辑任何一条记录都会
  // 刷新 updatedAt，用它编号会让被编辑的那条跳到最前、其余全部顺移。
  assert.ok(!/updatedAt/.test(m[0]), '不得用 updatedAt 编号：编辑任何一条都会让编号整体顺移');
  assert.ok(/padStart\(4, '0'\)/.test(m[0]), '编号仍是 4 位补零');
});

check('exp 卡片的每个字段都有删除按钮，且「经历标签」_rowName 不给（删了卡片就没标题）', () => {
  const shell = /function expFieldShell\([\s\S]*?\n      \}/.exec(html);
  assert.ok(shell, '找不到 expFieldShell');
  assert.ok(/data-action="del-exp-field"/.test(shell[0]), '字段外壳必须带删除按钮');
  assert.ok(/exp-field-wrap/.test(shell[0]), '外层要有 exp-field-wrap（删除按钮靠它绝对定位）');
  // 四个类型分支都必须走这个外壳，否则又会出现「某种字段类型删不掉」——
  // 这正是本轮修的 bug：kvRowHtml 一直有 ✕ 而 expFieldHtml 四个分支一个都没有。
  const fieldFn = /function expFieldHtml\([\s\S]*?\n      \}/.exec(html);
  assert.ok(fieldFn, '找不到 expFieldHtml');
  assert.strictEqual((fieldFn[0].match(/return expFieldShell\(/g) || []).length, 4,
    '四个类型分支（text / longtext / date / url）都应走 expFieldShell');
  // _rowName 是卡片标题与 expSummary 的来源，由 expCardHtml 单独渲染并过滤掉
  assert.ok(/filter\(\(\[k\]\) => k !== '_rowName'\)/.test(html), 'expCardHtml 必须继续过滤 _rowName');
  const handler = /action === 'del-exp-field'[\s\S]*?\} else if/.exec(html);
  assert.ok(handler, '缺少 del-exp-field 的事件处理分支');
  // 只动 DOM 不整体重渲染：简历是「DOM 为草稿、保存时才 collectResumeFromDom 收回」的模型，
  // 在这里改 resume 再重渲染会冲掉用户在同一页其他字段里尚未保存的输入。
  // 断言前先剥掉行注释 —— 这个分支的注释里就写着「不要调 renderResumeEditor()」来解释为什么，
  // 不剥的话守卫会被自己的解释性注释绊倒（与下面 batch/channel 那条收紧匹配模式是同一个道理）。
  const handlerCode = handler[0].replace(/\/\/[^\n]*/g, '');
  assert.ok(!/renderResumeEditor\(\)/.test(handlerCode),
    'del-exp-field 不得整体重渲染（会冲掉未保存的输入），应与 del-kv / del-exp 一样只动 DOM');
  assert.ok(!/updateResumeCompletion\(\)/.test(handlerCode),
    'del-exp-field 不得调 updateResumeCompletion：它统计的是内存里的 resume 而不是 DOM，此刻调只会显示过期数字');
});

check('看板有窄屏适配：≤900px 纵向堆叠（此前 apple.css 的媒体查询里 board 规则为 0 条）', () => {
  // base.css 与 apple.css 各有一个 900px 段（bundle 里 base 在前），所以必须逐个看完：
  // 只取第一个会永远匹配到 base.css 那段、然后误报"看板没有窄屏适配"。
  // 另一个 "900px) and (min-width: 561px)" 管的是表格列隐藏，形态不同不会被这个正则匹配。
  const blocks = [...html.matchAll(/@media \(max-width: 900px\) \{[\s\S]*?\n    \}/g)].map(m => m[0]);
  assert.ok(blocks.length >= 2, `900px 媒体查询应至少 2 处（base.css 与 apple.css 各一），实得 ${blocks.length}`);
  const withBoard = blocks.filter(b => /\.board-cols \{/.test(b));
  assert.strictEqual(withBoard.length, 1,
    `board 的窄屏规则应恰好写在一处（两处都写就看不出哪条生效），实得 ${withBoard.length}`);
  assert.ok(/grid-auto-flow: row/.test(withBoard[0]),
    '看板列在窄屏必须改为纵向堆叠——四列最小 928px，横滚时列头一出视口就看不出当前是哪个阶段');
  assert.ok(/\.board-col-body \{ min-height: 0; \}/.test(withBoard[0]),
    '堆叠模式下要取消 62px 的最小高度，否则空列下方留大片空白');
});

check('同企业收纳是独立开关、与排序解耦（排序下拉不得再有 company-group 选项）', () => {
  assert.ok(!/value="company-group"/.test(html),
    '排序下拉里的「按公司聚合」应已删除——留着就有两种分组语义并存，同时作用时的行为没有定义');
  assert.ok(/id="groupToggle"/.test(html), '应有独立的收纳开关');
  assert.ok(/const grouped = !!uiPrefs\.groupByCompany;/.test(html), 'renderTable 必须读开关而不是排序值');
  assert.ok(/function clusterByCompanyGroup\(/.test(html),
    '开关 ON 时要先把同企业记录聚拢：非公司类排序下它们本来就不相邻，逐行遍历会插出重复组头');
  assert.ok(/function toggleCompanyUnit\(/.test(html), '机构层要能独立折叠');
  assert.ok(/collapsedUnits/.test(html), '机构折叠态要持久化');
  assert.ok(/\$\{key\}::\$\{unit\}/.test(html),
    '机构折叠键必须是 企业::机构 的复合键（两家银行都能有「杭州分行」，只用机构名会串台）');
  assert.ok(/unitsByGroup\.get\(key\)\?\.size \|\| 0\) >= 2/.test(html),
    '机构层只在同一企业内有 2 个以上不同机构时渲染，否则只是多一层没信息量的缩进');
});

check('orgUnit 全链路：normalizeRecord 携带、表单可填、编辑能回填、查重纳入判定', () => {
  assert.ok(/orgUnit: String\(item\.orgUnit \|\| ''\)\.trim\(\)\.slice\(0, 60\)/.test(html),
    'normalizeRecord 必须显式携带 orgUnit——它是白名单式重建，漏写就会在每次 load/sync 静默丢失');
  assert.ok(/name="orgUnit"/.test(html), '记录表单要有机构输入框');
  const refill = /for \(const field of \[[^\]]*\]\) \{/.exec(html);
  assert.ok(refill, '找不到 openDialog 的回填清单');
  assert.ok(refill[0].includes("'orgUnit'"), '回填清单里必须有 orgUnit，否则点「编辑」时机构被静默清空');
  assert.ok(/reason: 'company\+unit\+position'/.test(html), '查重的三要素应是 公司+机构+岗位');
  assert.ok(!/reason: 'company\+position\+batch'/.test(html), '旧的 batch 判定应已移除');
  // 云同步：envelope 整条打包 record（{ ...record }），所以新字段自动跟随；
  // 但推送判定 sameRecordSet 只比 updatedAt/stage/company/position —— 靠「保存时刷新 updatedAt」
  // 间接察觉。这条断言钉住那个前提：一旦有人把 updatedAt 的刷新去掉，orgUnit 就会静默单向不同步。
  assert.ok(/updatedAt: Date\.now\(\)/.test(html), '保存记录时必须刷新 updatedAt（云同步的推送判定依赖它）');
});

check('已删除的字段零残留：batch / channel 不得复活（僵尸数据比删掉更容易出问题）', () => {
  // 只匹配**代码形态**，不匹配注释里的历史说明：00-bootstrap.js 顶部那段注释刻意写着
  // 「批次（BATCH_PRESETS）与渠道（CHANNEL_PRESETS）两个字段整体删除」来解释为什么没有这两个字段，
  // 无差别扫词会让这条守卫永远不干净。（icons/app-icon.svg 那条纪律选择的是改注释，
  // 这里选择收紧匹配模式 —— 字段名出现在解释性注释里是有价值的，色值不是。）
  const PATTERNS = [
    [/const BATCH_PRESETS\s*=/, 'BATCH_PRESETS 常量'],
    [/const CHANNEL_PRESETS\s*=/, 'CHANNEL_PRESETS 常量'],
    [/\brecord\.batch\b/, 'record.batch'],
    [/\brecord\.channel\b/, 'record.channel'],
    [/\bitem\.batch\b/, 'item.batch'],
    [/\bitem\.channel\b/, 'item.channel'],
    [/name="batch"|id="batch"/, '表单里的 batch 输入'],
    [/name="channel"|id="channel"/, '表单里的 channel 输入'],
    [/label: '批次'|label: '渠道'/, '抽屉字段表的批次 / 渠道行']
  ];
  for (const [re, name] of PATTERNS) {
    assert.ok(!re.test(html), `${name} 又出现了——字段已在 v4.11.0 删除，留半截引用就变成僵尸数据`);
  }
  // referral 刻意保留：它承载的是具体的人与联系方式，与「渠道=内推」这种分类标签不是一回事
  assert.ok(/referral: String\(item\.referral/.test(html), 'referral 应保留（删掉会真的丢信息）');
});

check('新增简历区块走应用内弹窗选类型，不得回到 prompt + 硬编码空对象', () => {
  assert.ok(/id="sectionDialog"/.test(html), '应有新增区块的弹窗');
  assert.ok(/name="sectionType"/.test(html), '弹窗里要能选类型（列表型 / 键值型）');
  assert.ok(!/prompt\('新区块名称/.test(html),
    '不得用原生 prompt：拿不到第二个输入维度，且与全站 confirmInApp 的风格不一致');
  // 硬编码 {} 正是「自定义区块加不了子项目」的根因：渲染靠 Array.isArray(val) 分叉，
  // 对象永远拿不到「＋ 添加」按钮，用户在结构上就没有入口。
  assert.ok(/resume\[name\] = isKv \? \{\} : \[\];/.test(html), '类型必须由用户选，不得硬编码');
  // collectResumeFromDom 靠 data-type 属性判类型（不是靠"有没有子元素"猜），
  // 否则空的列表型区块保存一次就退化成键值型
  assert.ok(/block\.getAttribute\('data-type'\) === 'exp'/.test(html),
    'collectResumeFromDom 必须按 data-type 判类型，空的列表型区块才不会退化成键值型');
});

console.log(`\n${failed ? `存在 ${failed} 个失败` : '网页端校验全部通过'}`);
if (failed) process.exitCode = 1;
