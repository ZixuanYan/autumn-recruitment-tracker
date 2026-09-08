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
const companyKeySrc = fs.readFileSync(path.join(TRACKER, 'extension/common/company-key.js'), 'utf8');

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

// ---------- 网页端：真实实现 ----------
const legalLine = html.split('\n').find(line => line.includes('const LEGAL_SUFFIX_RE'));
assert.ok(legalLine, '未找到 LEGAL_SUFFIX_RE');
const WEB_FNS = ['companyGroupKey', 'sameCompanyGroup', 'groupRecordsByCompany', 'companyGroupIndex',
  'normalizePositionSlug', 'loosePositionSlug', 'findDuplicateRecord', 'resolveDuplicate'];
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
  `${legalLine}\n${webSrc.join('\n')}\nreturn { ${WEB_FNS.join(', ')} };`
)(
  async (message, options) => { confirmCalls.push({ message: String(message || ''), title: (options && options.title) || '' }); return confirmAnswer; },
  () => confirmOutcome
);

// ---------- 插件端：真实的 common/company-key.js + background.js 的去重函数 ----------
const ajaBox = { AJA: null, self: null, globalThis: null };
ajaBox.self = ajaBox;
ajaBox.globalThis = ajaBox;
vm.createContext(ajaBox);
vm.runInContext(`${companyKeySrc}\n;__grab(AJA);`, Object.assign(ajaBox, { __grab: a => { ajaBox.AJA = a; } }), { filename: 'company-key.js' });
const AJA = ajaBox.AJA;
assert.ok(AJA && typeof AJA.companyKey === 'function', 'common/company-key.js 未能挂载 AJA');

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
section('一、三端归一化必须逐值一致（common/company-key.js 是 index.html 的镜像）');

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

check('companyKey：插件镜像与网页端 companyGroupKey 对全部样例输出相同', () => {
  for (const s of COMPANY_SAMPLES) {
    assert.strictEqual(AJA.companyKey(s), web.companyGroupKey({ company: s }), `公司「${s}」两端不一致`);
  }
});

check('positionKey：插件镜像与网页端 normalizePositionSlug 对全部样例输出相同', () => {
  for (const s of POSITION_SAMPLES) {
    assert.strictEqual(AJA.positionKey(s), web.normalizePositionSlug(s), `岗位「${s}」两端不一致`);
  }
});

check('loosePositionKey：插件镜像与网页端 loosePositionSlug 对全部样例输出相同', () => {
  for (const s of POSITION_SAMPLES) {
    assert.strictEqual(AJA.loosePositionKey(s), web.loosePositionSlug(s), `宽松岗位键「${s}」两端不一致`);
  }
});

check('sameCompany：插件镜像与网页端 sameCompanyGroup 对全部公司两两组合判定相同', () => {
  for (const a of COMPANY_SAMPLES) {
    for (const b of COMPANY_SAMPLES) {
      const webSays = web.sameCompanyGroup(web.companyGroupKey({ company: a }), web.companyGroupKey({ company: b }));
      const extSays = AJA.sameCompany(a, b);
      assert.strictEqual(extSays, webSays, `「${a}」vs「${b}」两端判定不一致（网页=${webSays} 插件=${extSays}）`);
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
