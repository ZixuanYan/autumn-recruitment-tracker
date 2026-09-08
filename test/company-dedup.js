'use strict';
// ============================================================================
// test/company-dedup.js — 同公司多岗位：判重语义 + 三端归一化一致性
//
// 覆盖三件事：
//   1) 网页端 index.html 的判重四态（duplicate / variant / same-company / null）
//   2) 插件 background.js 的暂存箱去重与网页端**同源**（此前是字符串精确匹配，
//      「腾讯」与「腾讯 」（尾空格）都会堆成两条）
//   3) extension/common/company-key.js 是 index.html 归一化函数的**镜像副本**，
//      两边对同一批样例必须逐值相同 —— 漂移即失败（同 crypto.js 的跨端测试做法）
//
// 全部从真实源文件抽取执行，不在测试里复制实现。
// 运行：node test/company-dedup.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const TRACKER = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(TRACKER, 'index.html'), 'utf8');
const backgroundSrc = fs.readFileSync(path.join(TRACKER, 'extension/background.js'), 'utf8');
// v4.9.0：跨端常量与归一化只剩一份，在仓库根 shared/（插件加载 extension/shared/ 的生成拷贝，
// 由 extension-ui.js 的同源守卫断言逐字节相同）。原 extension/common/company-key.js 已删除。
// 四件都要加载：别名守卫要验 STAGE_PRESETS / COMPANY_TYPES / DEFAULT_RESUME 的**引用相等**，
// 只加载 company-key 会让另外三个是 undefined（本轮就踩了一次：报 "not iterable"）。
const SHARED_SRCS = ['stages.js', 'company-types.js', 'company-key.js', 'default-resume.js']
  .map(f => fs.readFileSync(path.join(TRACKER, 'shared', f), 'utf8'));

let failed = 0;
const cases = [];
function check(name, fn) { cases.push({ kind: 'case', name, fn }); }
function section(title) { cases.push({ kind: 'section', title }); }

// 抽函数：先配平参数列表的圆括号再找函数体（默认参数 `options = {}` 会骗过朴素的花括号配平）
function extractFunction(src, name) {
  const marker = `function ${name}(`;
  let start = src.indexOf(marker);
  if (start === -1) return '';
  if (src.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
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
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}

// ---------- 单一事实源：shared/company-key.js ----------
// v4.9.0 起归一化只有一份实现。本文件原本用 vm 同时跑「从 index.html 抽的网页版实现」与
// 「插件的 common/company-key.js」做两两比对；合并后失去对照物，因此按方案 2.3 把断言语义改为：
//   ① 单一实现对黄金样例的**行为契约**（期望值实测钉死，任何归一化规则改动都会红）
//   ② **别名守卫**：index.html 里那几行 const 必须真的是转发（运行时比函数引用，不只是正则匹配文本）
// 黄金样例一条不减——它们才是这套断言真正的价值所在，「两份实现」只是当时的形式。
const ajaBox = { AJA: null, self: null, globalThis: null };
ajaBox.self = ajaBox;
ajaBox.globalThis = ajaBox;
vm.createContext(ajaBox);
vm.runInContext(`${SHARED_SRCS.join('\n')}\n;__grab(AJA);`, Object.assign(ajaBox, { __grab: a => { ajaBox.AJA = a; } }), { filename: 'shared/all.js' });
const AJA = ajaBox.AJA;
assert.ok(AJA && typeof AJA.companyKey === 'function', 'shared/company-key.js 未能挂载 AJA');
assert.ok(AJA && Array.isArray(AJA.STAGE_PRESETS), 'shared/stages.js 未能挂载 AJA.STAGE_PRESETS');
assert.ok(AJA && Array.isArray(AJA.COMPANY_TYPES), 'shared/company-types.js 未能挂载 AJA.COMPANY_TYPES');
assert.ok(AJA && AJA.DEFAULT_RESUME && typeof AJA.DEFAULT_RESUME === 'object', 'shared/default-resume.js 未能挂载 AJA.DEFAULT_RESUME');

// ---------- 网页端：转发别名（运行时验证）+ 网页版专有实现 ----------
// 四个归一化符号在 index.html 里已是 `const X = AJA.X;`。把这几行原文抽出来、在注入了 AJA 的
// 沙箱里执行，就能在运行时验证它们确实指向 shared 的同一份——比正则强：正则只看文本，
// 这里比的是**函数引用**，谁抄一份实现出来立刻红。
const ALIAS_NAMES = ['STAGE_PRESETS', 'COMPANY_TYPES', 'COMPANY_TYPE_UNSET', 'DEFAULT_RESUME',
  'companyGroupKey', 'sameCompanyGroup', 'normalizePositionSlug', 'loosePositionSlug'];
const aliasLines = ALIAS_NAMES.map(name => {
  const line = html.split('\n').find(l => l.includes(`const ${name} = AJA.`));
  assert.ok(line, `index.html 里找不到 ${name} 的转发别名行（可能又写回了字面量或实现体）`);
  return line.trim();
});
const aliasBox = { AJA, __out: null };
vm.createContext(aliasBox);
vm.runInContext(`${aliasLines.join('\n')}\n;__out = { ${ALIAS_NAMES.join(', ')} };`, aliasBox, { filename: 'web-aliases.js' });
const webAlias = aliasBox.__out;

// 网页版**专有**的实现仍在 index.html 里（聚类、判重四态、确认弹窗）。它们内部调用的四个归一化
// 符号通过参数注入 AJA 提供——这顺带验证了「转发别名在真实调用链里能用」，不只是声明存在。
const WEB_FNS = ['groupRecordsByCompany', 'companyGroupIndex', 'findDuplicateRecord', 'resolveDuplicate'];
const webSrc = WEB_FNS.map(name => extractFunction(html, name));
for (const [idx, src] of webSrc.entries()) {
  assert.ok(src && src.length > 40, `未能从 index.html 抽取 ${WEB_FNS[idx]}`);
}

// resolveDuplicate 的外部依赖用桩，并记录调用以便断言分支
const confirmCalls = [];
let confirmAnswer = true;
let confirmOutcome = 'ok';
const web = new Function(
  'confirmInApp', 'lastConfirmOutcome',
  'companyGroupKey', 'sameCompanyGroup', 'normalizePositionSlug', 'loosePositionSlug',
  `${webSrc.join('\n')}\nreturn { ${WEB_FNS.join(', ')} };`
)(
  async (message, options) => { confirmCalls.push({ message: String(message || ''), title: (options && options.title) || '' }); return confirmAnswer; },
  () => confirmOutcome,
  AJA.companyGroupKey, AJA.sameCompanyGroup, AJA.normalizePositionSlug, AJA.loosePositionSlug
);

const bgBox = { AJA, __bg: null };
vm.createContext(bgBox);
const bgDupSrc = extractFunction(backgroundSrc, 'findDuplicateRecord');
assert.ok(bgDupSrc && bgDupSrc.length > 80, '未能从 background.js 抽取 findDuplicateRecord');
vm.runInContext(`${bgDupSrc}\n;__bg = findDuplicateRecord;`, bgBox, { filename: 'background-dedup.js' });
const bgFindDuplicate = bgBox.__bg;

const rec = (id, company, position, batch) => ({ id, company, position, batch: batch || '', stage: '已投递', applicationUrl: '', updatedAt: 1 });

async function runAll() {
  for (const item of cases) {
    if (item.kind === 'section') { console.log(item.title); continue; }
    try { await item.fn(); console.log(`  ✓ ${item.name}`); }
    catch (e) { failed += 1; console.error(`  ✗ ${item.name}\n    ${e.message}`); }
  }
  console.log(`\n${failed ? `存在 ${failed} 个失败` : '同公司多岗位判重测试全部通过'}`);
  if (failed) process.exitCode = 1;
}

// ============================================================================
section('一、归一化行为契约（单一事实源 shared/company-key.js）+ 别名守卫');

const COMPANY_SAMPLES = [
  '腾讯', '腾讯科技（深圳）有限公司', '腾讯科技(深圳)有限公司', '  腾讯  ', '腾讯 ',
  'Ｔｅｎｃｅｎｔ　Ｌｔｄ', '星海科技', '星海互娱', '小米科技', '小米智能',
  '字节', '字节跳动', '商汤集团', '商汤科技', '某集团股份有限公司', '阿里巴巴（中国）网络技术有限公司',
  'CVTE', '大疆创新', '', '   ', '华为'
];
const POSITION_SAMPLES = [
  '后端开发工程师（深圳）', '后端开发工程师（北京）', '后端开发工程师(深圳)',
  'Java 开发工程师', 'Java开发工程师', 'Android开发', 'android开发',
  '产品经理（2026届校招）', '产品经理（社招）', '算法工程师-推荐', '算法工程师-广告',
  '客户端开发（iOS）', '  前端开发  ', '', '管培生'
];

check('别名守卫：index.html 的八个转发别名在运行时确实指向 shared 的同一份', () => {
  // 比正则强：这里比的是**引用相等**。谁在 index.html 里抄一份实现出来，立刻红。
  // 合并前这条断言的形式是「两份实现逐值等价」，合并后对照物消失，改为验证"只有一份"本身。
  for (const n of ['companyGroupKey', 'sameCompanyGroup', 'normalizePositionSlug', 'loosePositionSlug']) {
    assert.strictEqual(webAlias[n], AJA[n],
      `${n} 不是 shared 的同一函数引用（index.html 里可能又出现了第二份实现）`);
  }
  assert.strictEqual(webAlias.STAGE_PRESETS, AJA.STAGE_PRESETS, 'STAGE_PRESETS 应是同一数组引用');
  assert.strictEqual(webAlias.DEFAULT_RESUME, AJA.DEFAULT_RESUME, 'DEFAULT_RESUME 应是同一对象引用');
  assert.strictEqual(webAlias.COMPANY_TYPE_UNSET, AJA.COMPANY_TYPE_UNSET);
  assert.deepStrictEqual([...webAlias.COMPANY_TYPES], [...AJA.COMPANY_TYPES]);
  // 插件侧的 AJA.STAGES 也必须是同一个数组（constants.js 的别名转发）
  const constSrc = fs.readFileSync(path.join(TRACKER, 'extension/common/constants.js'), 'utf8');
  assert.ok(/root\.AJA\.STAGES = root\.AJA\.STAGE_PRESETS;/.test(constSrc), 'constants.js 缺少 STAGES 别名转发');
});

check('两套 API 等价：companyGroupKey(record) === companyKey(record.company)（全部黄金样例）', () => {
  // 合并后仍保留这条：companyGroupKey 收 record、companyKey 收字符串，是两个不同的函数，
  // 网页版 31 处调用点用前者、插件 background 用后者，等价性不能靠"看起来一样"
  for (const s of COMPANY_SAMPLES) {
    assert.strictEqual(AJA.companyGroupKey({ company: s }), AJA.companyKey(s), `公司「${s}」两套 API 不一致`);
  }
  assert.strictEqual(AJA.companyGroupKey(null), '', 'record 为 null 不该抛错');
  assert.strictEqual(AJA.companyGroupKey({}), '', 'record 缺 company 字段不该抛错');
  // 另三个是同引用别名（签名相同，直接转发）
  assert.strictEqual(AJA.normalizePositionSlug, AJA.positionKey);
  assert.strictEqual(AJA.loosePositionSlug, AJA.loosePositionKey);
  assert.strictEqual(AJA.sameCompanyGroup, AJA.sameCompanyKey);
});

check('companyKey 行为契约：期望值实测钉死（改归一化规则必红）', () => {
  // 这些期望值是 2026-09-08 实测输出，不是推导值。任何一条变了都意味着归一化规则被改动，
  // 而那会直接影响判重与聚类（旧版就是因为规则改动导致「第二个岗位录不进去」）。
  const EXPECT = {
    '腾讯': '腾讯',
    '腾讯科技（深圳）有限公司': '腾讯科技深圳',      // 全角括号去掉 + 循环剥「有限公司」
    '腾讯科技(深圳)有限公司': '腾讯科技深圳',        // 半角括号同键（全半角统一）
    '  腾讯  ': '腾讯',                             // trim
    '腾讯 ': '腾讯',
    'Ｔｅｎｃｅｎｔ　Ｌｔｄ': 'tencent',             // 全角转半角 + 小写 + 剥 Ltd
    '星海科技': '星海科技',                          // 行业词**保留**
    '星海互娱': '星海互娱',                          // 与上不同键，否则两家公司被并成一家
    '小米科技': '小米科技',
    '小米智能': '小米智能',
    '字节': '字节',
    '字节跳动': '字节跳动',
    '商汤集团': '商汤',                             // 「集团」是法人后缀，剥掉
    '商汤科技': '商汤科技',                          // 「科技」是行业词，保留
    '某集团股份有限公司': '某',                       // 循环剥离：股份有限公司 → 集团
    '阿里巴巴（中国）网络技术有限公司': '阿里巴巴中国网络技术',
    'CVTE': 'cvte',
    '大疆创新': '大疆创新',
    '': '',
    '   ': '',
    '华为': '华为'
  };
  assert.strictEqual(Object.keys(EXPECT).length, COMPANY_SAMPLES.length,
    '期望值表应覆盖全部 COMPANY_SAMPLES（新增样例时两处一起加）');
  for (const s of COMPANY_SAMPLES) {
    assert.ok(Object.prototype.hasOwnProperty.call(EXPECT, s), `COMPANY_SAMPLES 里的「${s}」缺期望值`);
    assert.strictEqual(AJA.companyKey(s), EXPECT[s], `companyKey(${JSON.stringify(s)}) 应为 ${JSON.stringify(EXPECT[s])}`);
  }
});

check('positionKey 保留括号、loosePositionKey 才去括号（同公司多岗位的关键区分）', () => {
  const EXPECT_POS = {
    '后端开发工程师（深圳）': '后端开发工程师(深圳)',  // 括号保留，但全角转半角
    '后端开发工程师（北京）': '后端开发工程师(北京)',
    '后端开发工程师(深圳)': '后端开发工程师(深圳)',    // 与全角版同键
    'Java 开发工程师': 'java开发工程师',              // 去空白 + 小写
    'Java开发工程师': 'java开发工程师',
    'Android开发': 'android开发',
    'android开发': 'android开发',
    '产品经理（2026届校招）': '产品经理(2026届校招)',
    '产品经理（社招）': '产品经理(社招)',
    '算法工程师-推荐': '算法工程师-推荐',              // 连字符后缀在严格键里保留
    '算法工程师-广告': '算法工程师-广告',
    '客户端开发（iOS）': '客户端开发(ios)',
    '  前端开发  ': '前端开发',
    '': '',
    '管培生': '管培生'
  };
  assert.strictEqual(Object.keys(EXPECT_POS).length, POSITION_SAMPLES.length, '期望值表应覆盖全部 POSITION_SAMPLES');
  for (const s of POSITION_SAMPLES) {
    assert.strictEqual(AJA.positionKey(s), EXPECT_POS[s], `positionKey(${JSON.stringify(s)}) 应为 ${JSON.stringify(EXPECT_POS[s])}`);
  }
  // 严格键必须区分城市，宽松键必须不区分——这两条一起构成「第二个岗位能录进去、但会提示疑似同岗位」
  assert.notStrictEqual(AJA.positionKey('后端开发工程师（深圳）'), AJA.positionKey('后端开发工程师（北京）'),
    '严格键必须区分括号里的城市，否则两条独立投递撞成同名、第二个岗位录不进去');
  assert.strictEqual(AJA.loosePositionKey('后端开发工程师（深圳）'), AJA.loosePositionKey('后端开发工程师（北京）'),
    '宽松键应抹掉括号，用于「疑似同岗位不同方向」提示');
  assert.strictEqual(AJA.loosePositionKey('算法工程师-推荐'), AJA.loosePositionKey('算法工程师-广告'), '宽松键应抹掉连字符后缀');
  assert.strictEqual(AJA.loosePositionKey('客户端开发（iOS）'), '客户端开发');
});

check('sameCompany 分组语义：相等或互相包含（钉死"该合并"与"不该合并"两侧）', () => {
  // 该判为同一家（键互相包含）
  const SAME = [['腾讯', '腾讯科技（深圳）有限公司'], ['腾讯', '腾讯科技(深圳)有限公司'],
    ['字节', '字节跳动'], ['商汤集团', '商汤科技']];
  for (const [a, b] of SAME) {
    assert.strictEqual(AJA.sameCompany(a, b), true, `「${a}」与「${b}」应判为同一家`);
    assert.strictEqual(AJA.sameCompany(b, a), true, `判定必须对称：「${b}」与「${a}」`);
  }
  // 不该判为同一家（行业词不同 → 键互不包含）
  const DIFF = [['星海科技', '星海互娱'], ['小米科技', '小米智能'], ['腾讯', '华为'], ['腾讯', ''], ['', '']];
  for (const [a, b] of DIFF) {
    assert.strictEqual(AJA.sameCompany(a, b), false, `「${a}」与「${b}」不该判为同一家`);
  }
  // 空键一律 false，否则所有缺公司名的记录会被并成一家
  assert.strictEqual(AJA.sameCompanyKey('', ''), false);
  assert.strictEqual(AJA.sameCompanyKey('腾讯', ''), false);
  // 长度 < 2 的键不参与包含判定，否则「腾」会匹配一切含"腾"的公司
  assert.strictEqual(AJA.sameCompanyKey('腾', '腾讯'), false, '短键不该参与包含判定');
  // 全样例两两组合仍要跑一遍：确保没有异常输入让判定抛错或返回非布尔
  for (const a of COMPANY_SAMPLES) {
    for (const b of COMPANY_SAMPLES) {
      const r = AJA.sameCompany(a, b);
      assert.strictEqual(typeof r, 'boolean', `「${a}」vs「${b}」应返回布尔值`);
      assert.strictEqual(r, AJA.sameCompany(b, a), `「${a}」vs「${b}」判定必须对称`);
    }
  }
});

section('二、网页端判重四态');

check('括号里的城市/端/方向不同 → variant（不再判 duplicate，第二个岗位能录进去）', () => {
  const pairs = [
    ['后端开发工程师（深圳）', '后端开发工程师（北京）'],
    ['客户端开发（iOS）', '客户端开发（Android）'],
    ['产品经理（2026届校招）', '产品经理（社招）'],
    ['算法工程师-推荐', '算法工程师-广告']
  ];
  for (const [a, b] of pairs) {
    const res = web.findDuplicateRecord([rec('1', '腾讯', a)], { company: '腾讯', position: b });
    assert.ok(res, `「${a}」vs「${b}」应有判定`);
    assert.strictEqual(res.mode, 'variant', `「${a}」vs「${b}」应为 variant`);
    assert.strictEqual(res.reason, 'company+position-loose');
  }
});

check('仅空格/大小写/全半角差异 → 仍是 duplicate（真重复不能漏）', () => {
  assert.strictEqual(web.findDuplicateRecord([rec('1', '字节跳动', 'Java 开发工程师')], { company: '字节', position: 'Java开发工程师' }).mode, 'duplicate');
  assert.strictEqual(web.findDuplicateRecord([rec('1', '小米', 'Android开发')], { company: '小米', position: 'android开发' }).mode, 'duplicate');
  assert.strictEqual(web.findDuplicateRecord([rec('1', '腾讯', '后端开发（深圳）')], { company: '腾讯', position: '后端开发(深圳)' }).mode, 'duplicate');
});

check('批次不同 → variant（提前批/正式批既不合并也不无声放行）', () => {
  const res = web.findDuplicateRecord([rec('1', '腾讯', '后端开发', '提前批')], { company: '腾讯', position: '后端开发', batch: '正式批' });
  assert.strictEqual(res.mode, 'variant');
});

check('插件不传批次时不会误判 duplicate（旧版 ignoreBatch:true 的后果）', () => {
  const res = web.findDuplicateRecord([rec('1', '腾讯', '后端开发', '提前批')], { company: '腾讯', position: '后端开发' });
  assert.strictEqual(res.mode, 'variant');
});

check('同公司不同岗位 → same-company；不同公司/空公司 → null', () => {
  assert.strictEqual(web.findDuplicateRecord([rec('1', '腾讯', '后端')], { company: '腾讯', position: '前端' }).mode, 'same-company');
  assert.strictEqual(web.findDuplicateRecord([rec('1', '腾讯', '后端')], { company: '星海互娱', position: '前端' }), null);
  assert.strictEqual(web.findDuplicateRecord([rec('1', '腾讯', '后端')], { company: '', position: '前端' }), null);
});

check('同链接优先判 duplicate（不看公司岗位）', () => {
  const res = web.findDuplicateRecord(
    [{ id: '1', company: '别家', position: '别的', applicationUrl: 'https://x/a', batch: '' }],
    { company: '腾讯', position: '后端', applicationUrl: 'https://x/a' }
  );
  assert.strictEqual(res.mode, 'duplicate');
  assert.strictEqual(res.reason, 'url');
});

check('展示分组与查重判定同源（修复前 5 个案例里 3 个自相矛盾）', () => {
  const pairs = [
    ['星海科技', '星海互娱', false],
    ['字节', '字节跳动', true],
    ['腾讯', '腾讯科技（深圳）有限公司', true],
    ['商汤科技', '商汤集团', true],
    ['小米科技', '小米智能', false]
  ];
  for (const [a, b, expectSame] of pairs) {
    const groups = web.groupRecordsByCompany([rec('1', a, '后端'), rec('2', b, '前端')]);
    const dup = web.findDuplicateRecord([rec('1', a, '后端')], { company: b, position: '前端' });
    assert.strictEqual(groups.length === 1, expectSame, `${a} / ${b} 展示分组`);
    assert.strictEqual(!!dup, expectSame, `${a} / ${b} 查重必须与展示一致`);
  }
});

section('三、resolveDuplicate：三条入口的统一处置');

check('same-company → 直接放行新增，并给出岗位数提示', async () => {
  const res = await web.resolveDuplicate({ mode: 'same-company', matches: [{ id: '1' }] }, { company: '腾讯' });
  assert.strictEqual(res.action, 'add');
  assert.ok(res.hint.includes('共 2 个岗位'), res.hint);
  assert.strictEqual(confirmCalls.length, 0, '不该弹确认框打断录入');
});

check('variant → 弹「疑似同岗位不同方向」，主按钮是新增', async () => {
  confirmCalls.length = 0; confirmAnswer = true; confirmOutcome = 'ok';
  const target = rec('1', '腾讯', '后端开发工程师（深圳）');
  const res = await web.resolveDuplicate({ mode: 'variant', matches: [target] }, { company: '腾讯', position: '后端开发工程师（北京）' });
  assert.strictEqual(confirmCalls.length, 1);
  assert.strictEqual(confirmCalls[0].title, '疑似同岗位不同方向');
  assert.strictEqual(res.action, 'add', '选「是独立投递」应放行新增');
});

check('variant → 选「其实是同一条」则转为编辑既有记录', async () => {
  confirmCalls.length = 0; confirmAnswer = false; confirmOutcome = 'cancel';
  const target = rec('1', '腾讯', '后端开发工程师（深圳）');
  const res = await web.resolveDuplicate({ mode: 'variant', matches: [target] }, { company: '腾讯', position: '后端开发工程师（北京）' });
  assert.strictEqual(res.action, 'edit');
  assert.strictEqual(res.target.id, '1');
  confirmAnswer = true;
});

check('duplicate → 弹「疑似重复投递」，默认倾向编辑已有但保留「仍然新增」', async () => {
  confirmCalls.length = 0; confirmAnswer = true; confirmOutcome = 'ok';
  const target = rec('1', '腾讯', '后端');
  assert.strictEqual((await web.resolveDuplicate({ mode: 'duplicate', matches: [target] }, { company: '腾讯', position: '后端' })).action, 'edit');
  assert.strictEqual(confirmCalls[0].title, '疑似重复投递');
  confirmAnswer = false; confirmOutcome = 'cancel';
  assert.strictEqual((await web.resolveDuplicate({ mode: 'duplicate', matches: [target] }, { company: '腾讯', position: '后端' })).action, 'add');
  confirmAnswer = true;
});

check('Esc / 点遮罩关掉确认框 → cancel，三条入口都不得静默写入', async () => {
  confirmAnswer = false; confirmOutcome = 'dismiss';
  const target = rec('1', '腾讯', '后端');
  assert.strictEqual((await web.resolveDuplicate({ mode: 'duplicate', matches: [target] }, { company: '腾讯', position: '后端' })).action, 'cancel');
  assert.strictEqual((await web.resolveDuplicate({ mode: 'variant', matches: [target] }, { company: '腾讯', position: '后端（北京）' })).action, 'cancel');
  confirmAnswer = true; confirmOutcome = 'ok';
});

check('无命中 → 直接放行，不弹框', async () => {
  confirmCalls.length = 0;
  const res = await web.resolveDuplicate(null, { company: '星海互娱', position: '后端' });
  assert.strictEqual(res.action, 'add');
  assert.strictEqual(res.hint, '');
  assert.strictEqual(confirmCalls.length, 0);
});

section('四、插件暂存箱去重（修复前是字符串精确匹配）');

check('公司名尾空格 / 简称与全称 → 合并为一条（修复前会堆成两条）', () => {
  const queue = [{ company: '腾讯', position: '后端开发', applicationUrl: '' }];
  let hit = bgFindDuplicate(queue, { company: '腾讯 ', position: '后端开发', applicationUrl: '' });
  assert.ok(hit && hit.mode === 'duplicate', '尾空格应判为同一条');
  hit = bgFindDuplicate(queue, { company: '腾讯科技（深圳）有限公司', position: '后端开发', applicationUrl: '' });
  assert.ok(hit && hit.mode === 'duplicate', '简称与法人全称应判为同一条');
  hit = bgFindDuplicate(queue, { company: '字节', position: '后端开发', applicationUrl: '' });
  assert.strictEqual(hit, null, '字节 与 腾讯 不是同一家');
});

check('同公司的另一个岗位 → variant，不合并（第二个岗位必须能进暂存箱）', () => {
  const queue = [{ company: '腾讯', position: '后端开发工程师（深圳）', applicationUrl: '' }];
  const hit = bgFindDuplicate(queue, { company: '腾讯', position: '后端开发工程师（北京）', applicationUrl: '' });
  assert.ok(hit, '应识别出同公司相近岗位');
  assert.strictEqual(hit.mode, 'variant');
  assert.strictEqual(hit.record.position, '后端开发工程师（深圳）');
});

check('同公司完全不相关的岗位 → null（正常入队，不打扰用户）', () => {
  const queue = [{ company: '腾讯', position: '后端开发', applicationUrl: '' }];
  assert.strictEqual(bgFindDuplicate(queue, { company: '腾讯', position: '产品经理', applicationUrl: '' }), null);
});

check('同链接优先判 duplicate；公司或岗位为空时不猜', () => {
  const queue = [{ company: 'A', position: 'B', applicationUrl: 'https://x/1' }];
  const hit = bgFindDuplicate(queue, { company: 'C', position: 'D', applicationUrl: 'https://x/1' });
  assert.ok(hit && hit.mode === 'duplicate');
  assert.strictEqual(bgFindDuplicate(queue, { company: '', position: 'B', applicationUrl: '' }), null);
  assert.strictEqual(bgFindDuplicate(queue, { company: 'A', position: '', applicationUrl: '' }), null);
  assert.strictEqual(bgFindDuplicate([], { company: 'A', position: 'B', applicationUrl: '' }), null);
});

check('暂存箱与网页端对同一批样例给出一致的「是否同一家公司」结论', () => {
  // 暂存箱判 duplicate 的前提之一是同公司；网页端判非 null 的前提也是同公司。两者必须一致。
  for (const a of COMPANY_SAMPLES.filter(Boolean)) {
    for (const b of COMPANY_SAMPLES.filter(Boolean)) {
      const bgHit = bgFindDuplicate([{ company: a, position: '后端开发', applicationUrl: '' }], { company: b, position: '后端开发', applicationUrl: '' });
      const webHit = web.findDuplicateRecord([rec('1', a, '后端开发')], { company: b, position: '后端开发' });
      assert.strictEqual(!!bgHit, !!webHit, `「${a}」vs「${b}」：暂存箱=${!!bgHit} 网页端=${!!webHit}`);
    }
  }
});

runAll();
