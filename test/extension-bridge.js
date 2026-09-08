'use strict';
// ============================================================================
// test/extension-bridge.js — 插件桥接在「扩展上下文失效」时不得抛未捕获错误
//
// 复现的真实报错（用户报告）：
//   Uncaught Error: Extension context invalidated.
//   extensions://…/content/06-bridge.js:117
// 成因：扩展被重新加载后，页面上旧的内容脚本还活着，但它的 chrome.runtime 已成失效句柄，
//       任何直接调用都会**同步抛出**。06-bridge.js 里三处调用中有一处（SAVE_RESUME）是裸调、
//       毫无防护，于是错误冒到网页控制台。
//
// 本测试把 chrome.runtime.id 置空（这正是上下文失效后的可观测状态）来复现该条件，
// 断言：不抛异常、失败被收敛成一次性 BRIDGE_BROKEN 上报、多次触发不刷屏。
// 真实的 safeSendMessage 从 05-capture.js 原文抽取（不打桩），保证测的是实际防护逻辑。
// 运行：node test/extension-bridge.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const EXT = path.resolve(__dirname, '../extension');
const bridgeSrc = fs.readFileSync(path.join(EXT, 'content/06-bridge.js'), 'utf8');
// v5.0.0：safeSendMessage 仍在 content 侧（05-capture.js）；收录表单的 HTML、下拉选项生成、
// 保存 payload 与暂存箱回填则收敛到 common/capture-form.js——迷你卡片与 Side Panel 共用一份，
// 下面那几条跨仓库契约断言因此有了唯一落点，不会出现「一端改了另一端漏改」。
const captureSrc = fs.readFileSync(path.join(EXT, 'content/05-capture.js'), 'utf8');
const formSrc = fs.readFileSync(path.join(EXT, 'common/capture-form.js'), 'utf8');

let failed = 0;
const cases = [];
function check(name, fn) { cases.push({ kind: 'case', name, fn }); }
function section(title) { cases.push({ kind: 'section', title }); }

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

const safeSendMessageSrc = extractFunction(captureSrc, 'safeSendMessage');
assert.ok(safeSendMessageSrc.length > 100, '未能从 05-capture.js 抽取真实的 safeSendMessage');

// ---------------- 沙箱：可中途「失效」的插件桥接环境 ----------------
// 真实时序是：页面正常加载（上下文有效）→ 用户去 edge://extensions 重载了插件 →
// 页面上旧的内容脚本还活着但 chrome.runtime 已成失效句柄 → 网页版下一次下发简历时同步抛错。
// 因此这里默认以「有效」状态加载，再由测试调用 invalidate() 模拟重载那一刻。
// options.invalidatedAtLoad = true 则模拟更极端的情况：加载时上下文就已失效。
function makeBridgeEnv(options = {}) {
  const state = { invalidated: options.invalidatedAtLoad === true };
  const posted = [];          // 插件 → 网页 的 postMessage
  const warnings = [];        // console.warn 收集
  const listeners = {};       // window.addEventListener 收集
  const runtimeListeners = []; // chrome.runtime.onMessage 的监听器
  let sendMessageCalls = 0;

  const chromeStub = {
    runtime: {
      // 上下文失效时 chrome.runtime.id 变为 undefined —— safeSendMessage 正是靠这个提前探测
      get id() { return state.invalidated ? undefined : 'ext-id-123'; },
      lastError: null,
      onMessage: { addListener(fn) { runtimeListeners.push(fn); } },
      sendMessage(message, callback) {
        if (state.invalidated) throw new Error('Extension context invalidated.');
        sendMessageCalls += 1;
        if (callback) callback({ ok: true, records: [] });
      }
    },
    storage: { local: { get: async () => ({}), set: async () => {} } }
  };

  const timers = [];
  const sandbox = {
    console: { warn: (...args) => warnings.push(args.map(String).join(' ')), log: () => {}, error: (...a) => warnings.push(a.map(String).join(' ')) },
    chrome: chromeStub,
    IS_TRACKER_PAGE: true,
    MSG: { RELAY_TO_TRACKER: 'RELAY_TO_TRACKER', REMOVE_PENDING_RECORD: 'REMOVE_PENDING_RECORD', GET_PENDING_RECORDS: 'GET_PENDING_RECORDS', SAVE_RESUME: 'SAVE_RESUME' },
    AJA: { BRIDGE_SOURCE: 'AUTUMN_JOB_ASSISTANT' },
    document: { querySelector: () => null },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    MutationObserver: class { observe() {} },
    window: null,
    __posted: posted,
    __warnings: warnings,
    __listeners: listeners,
    __runtimeListeners: runtimeListeners,
    __sendMessageCalls: () => sendMessageCalls,
    __timers: timers,
    // 模拟「用户去扩展管理页重载了插件」这一刻
    __invalidate: () => { state.invalidated = true; }
  };
  sandbox.window = {
    postMessage: (data) => { posted.push(data); },
    addEventListener: (type, handler) => { (listeners[type] = listeners[type] || []).push(handler); }
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  // 真实的 safeSendMessage 与真实的 06-bridge.js 一起注入（同一 isolated world 的顶层可见性）
  vm.runInContext(`${safeSendMessageSrc}\n${bridgeSrc}`, sandbox, { filename: 'bridge-env.js' });
  return sandbox;
}

// 派发网页 → 插件的 RESUME_PUSH（等价于网页版保存简历时的下发）
function pushResume(sandbox, resume) {
  const handlers = sandbox.__listeners.message || [];
  const event = { source: sandbox.window, data: { source: 'AUTUMN_TRACKER', type: 'RESUME_PUSH', resume: resume || { name: '张三' } } };
  for (const h of handlers) h(event);
  return handlers.length;
}

// 等微任务队列排空（sendRuntimeMessage 的 reject 与 catch 都是 promise 链）
const flush = () => new Promise(resolve => setImmediate(resolve));

async function runAll() {
  for (const item of cases) {
    if (item.kind === 'section') { console.log(item.title); continue; }
    try { await item.fn(); console.log(`  ✓ ${item.name}`); }
    catch (e) { failed += 1; console.error(`  ✗ ${item.name}\n    ${e.message}`); }
  }
  console.log(`\n${failed ? `存在 ${failed} 个失败` : '插件桥接失效处理测试全部通过'}`);
  if (failed) process.exitCode = 1;
}

// ============================================================================
section('静态守卫');

check('06-bridge.js 里没有任何裸调 chrome.runtime.sendMessage（只能走 safeSendMessage）', () => {
  const noComments = bridgeSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/chrome\.runtime\.sendMessage/.test(noComments),
    '仍存在裸调用；扩展重载后它会同步抛 "Extension context invalidated." 冒到网页控制台');
  assert.ok(/safeSendMessage\(/.test(noComments), '应通过 safeSendMessage 封装通信');
});

check('三处通信全部走 sendRuntimeMessage（出队 / 读暂存箱 / 简历下发）', () => {
  const count = (bridgeSrc.match(/sendRuntimeMessage\(/g) || []).length;
  assert.ok(count >= 4, `期望至少 4 处（1 处定义 + 3 处调用），实际 ${count}`);
});

check('跨仓库契约：BRIDGE_BROKEN 的消息源必须能通过网页端的 BRIDGE_SOURCES 过滤', () => {
  // 网页端 handleCaptureMessage 第一行就按 BRIDGE_SOURCES 过滤来源；若插件的 AJA.BRIDGE_SOURCE
  // 与网页端的清单漂移，这条提示会**静默失效**（插件以为报了，网页端直接 return），很难发现。
  const htmlSrc = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  const constantsSrc = fs.readFileSync(path.join(EXT, 'common/constants.js'), 'utf8');

  const extSource = /AJA\.BRIDGE_SOURCE\s*=\s*'([^']+)'/.exec(constantsSrc);
  assert.ok(extSource, '插件侧未定义 AJA.BRIDGE_SOURCE');
  const webList = /const BRIDGE_SOURCES\s*=\s*\[([^\]]+)\]/.exec(htmlSrc);
  assert.ok(webList, '网页端未定义 BRIDGE_SOURCES');
  const allowed = webList[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  assert.ok(allowed.includes(extSource[1]),
    `插件的 BRIDGE_SOURCE「${extSource[1]}」不在网页端白名单 [${allowed.join(', ')}] 里 → 提示会被静默丢弃`);

  assert.ok(/event\.data\.type === 'BRIDGE_BROKEN'/.test(htmlSrc), '网页端未处理 BRIDGE_BROKEN');
  // 提示必须给出可执行的出路，而不只是报错
  const branch = htmlSrc.slice(htmlSrc.indexOf("event.data.type === 'BRIDGE_BROKEN'"));
  const body = branch.slice(0, branch.indexOf('if (event.data.type ===') > 0 ? branch.indexOf('if (event.data.type ===', 10) : 900);
  assert.ok(/showToast\(/.test(body), '应上屏提示');
  assert.ok(/reload\(\)/.test(body), '应提供「刷新页面」这个可执行动作（插件不会自愈）');
});

section('两端枚举契约与收录链路（v4.2.0 企业性质）');

// 注：这里原来有个 liveArray(src, pattern, name)——从源码里找到定义行、抠出数组字面量、
// 用 new Function 求值，以此比对「两端字面量是否逐值相同」。v4.9.0 把常量合并进仓库根 shared/
// 之后，两端都不再有字面量（都写成 `= AJA.X` 转发），该函数已无用武之地，删除。
// 断言语义换成「别名唯一性 + 源头值契约」，见下面两条——防护强度是**上升**的：
// 旧断言只保证两端相同（两端可以一起错），新断言保证只有一份、且那一份的值正确。
const constantsSrc2 = fs.readFileSync(path.join(EXT, 'common/constants.js'), 'utf8');
const htmlSrc2 = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const requireShared = (f) => require(path.resolve(__dirname, '../shared', f));

check('契约：阶段枚举只有一份（在 shared/stages.js），两端都是转发别名', () => {
  // ① 别名唯一性：两端那行必须是 `= AJA.X`，且不得再出现数组字面量
  assert.ok(/const STAGE_PRESETS = AJA\.STAGE_PRESETS;/.test(htmlSrc2),
    'index.html 的阶段预设不是 shared 的转发别名（可能又出现了第二份字面量）');
  assert.ok(/root\.AJA\.STAGES = root\.AJA\.STAGE_PRESETS;/.test(constantsSrc2),
    'constants.js 缺少 AJA.STAGES → AJA.STAGE_PRESETS 的别名转发（插件全代码用的是 AJA.STAGES）');
  assert.ok(!/const STAGE_PRESETS = \[/.test(htmlSrc2), 'index.html 又出现了阶段字面量数组');
  assert.ok(!/AJA\.STAGES = \[/.test(constantsSrc2),
    'constants.js 又出现了阶段字面量数组：它在 shared 之后加载，会把单一事实源覆盖回去');
  // ② 源头值契约：AI 只能从这 14 个里选 stage，少一个就会让该类邮件的阶段静默置空
  assert.deepStrictEqual([...requireShared('stages.js').STAGE_PRESETS],
    ['待投递', '已投递', '测评', '笔试', '机试', '一面', '二面', '三面', '四面', '五面', '交叉面', 'HR面', 'Offer', '已结束'],
    '源头值被改动：Action 的 stage 严格校验会把它判为非法并置空，网页端则当自定义阶段处理（stageOrder 返回 9000，排序与漏斗分组都会错）');
});

check('契约：企业性质只有一份（在 shared/company-types.js），两端都是转发别名', () => {
  assert.ok(/const COMPANY_TYPES = AJA\.COMPANY_TYPES;/.test(htmlSrc2),
    'index.html 的企业性质不是 shared 的转发别名');
  assert.ok(/const COMPANY_TYPE_UNSET = AJA\.COMPANY_TYPE_UNSET;/.test(htmlSrc2), '同上（「未设置」文案）');
  assert.ok(!/AJA\.COMPANY_TYPES = \[/.test(constantsSrc2),
    'constants.js 又出现了企业性质字面量：它在 shared 之后加载，会覆盖单一事实源');
  assert.ok(!/央国企|民企|外企/.test(constantsSrc2), 'constants.js 里不该再有企业性质的中文字面量');
  const shared = requireShared('company-types.js');
  // 网页端 normalizeRecord 做白名单校验：多写或写错一个字，用户选了也等于没选（静默落回未设置），
  // 且洞察的企业性质统计永远缺这一档
  assert.deepStrictEqual([...shared.COMPANY_TYPES], ['央国企', '民企', '外企'], '档位应为约定的 3 档');
  assert.strictEqual(shared.COMPANY_TYPE_UNSET, '未设置');
  // 插件的收录表单必须真的用这份值生成下拉（而不是自己硬编码三个 option）
  assert.ok(/AJA\.COMPANY_TYPES\s*\|\|\s*\[\]\)\.map/.test(formSrc), '收录表单的下拉选项应由 AJA.COMPANY_TYPES 动态生成');
});

check('收录链路：企业性质从插件表单一路透传到网页端 seed（任一环断了都等于功能没做）', () => {
  // ① 表单里有下拉，且选项由 AJA.COMPANY_TYPES 生成（不是硬编码）
  assert.ok(/<select id="cap-company-type"><\/select>/.test(formSrc), '收录表单缺企业性质下拉');
  assert.ok(/AJA\.COMPANY_TYPES\s*\|\|\s*\[\]\)\.map/.test(formSrc), '下拉选项应由 AJA.COMPANY_TYPES 动态生成');
  // v5.0.0 起模板在 common/capture-form.js，首项文案多包了一层 escapeHtml(root.AJA.…)，
  // 因此这里按意图匹配（value="" 且文案取自常量）而不是死盯具体写法
  assert.ok(/<option value="">[^\n]*COMPANY_TYPE_UNSET/.test(formSrc), '首项必须是 value="" 的「未设置」');
  // ② 保存 payload 带上（否则选了也传不出去）
  assert.ok(/companyType:\s*[^\n,]*e\.companyType/.test(formSrc), '保存 payload 未带 companyType');
  // ③ 暂存箱回填也带上（否则「回填收录表单」会丢掉已选的性质）
  assert.ok(/e\.companyType\.value\s*=\s*it\.companyType/.test(formSrc), '暂存箱回填未带 companyType');
  // ④ background 暂存与「重复收录合并」两处都要带（合并漏了会把已选值冲掉）
  const bgSrc = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
  assert.ok(/companyType:\s*String\(request\.record\.companyType\s*\|\|\s*''\)/.test(bgSrc), 'staged 未带 companyType');
  assert.ok(/companyType:\s*staged\.companyType\s*\|\|\s*existing\.companyType/.test(bgSrc),
    '重复收录的合并分支未带 companyType：这次没选会把上次选好的冲掉');
  // ⑤ 网页端 CAPTURE_SUBMIT 的 seed 必须接住（最容易漏的一环：前面全对，这里没接就全白费）
  assert.ok(/companyType:\s*submitted\.companyType/.test(htmlSrc2), '网页端 handleCaptureMessage 的 seed 未接 companyType');
  // ⑥ 表单回填清单也要有，否则「编辑」既有记录时该字段被静默清空
  const refill = /for \(const field of \[([^\]]+)\]\) \{\s*\n\s*const input = document\.getElementById\(field\)/.exec(htmlSrc2);
  assert.ok(refill, '未定位到 openDialog 的回填字段清单');
  assert.ok(refill[1].includes("'companyType'"), 'openDialog 回填清单缺 companyType → 编辑时会静默清空');
});

section('扩展被重载后（用户报告的真实时序）');

check('加载桥接脚本本身不抛异常，并完成暂存箱握手', async () => {
  let threw = null;
  let sb = null;
  try { sb = makeBridgeEnv(); await flush(); } catch (e) { threw = e; }
  assert.strictEqual(threw, null, threw ? `加载即抛错：${threw.message}` : '');
  assert.ok(sb.__sendMessageCalls() >= 1, '应实际发出 GET_PENDING_RECORDS');
  assert.ok(sb.__runtimeListeners.length >= 1, '应注册 runtime.onMessage 中继监听');
  assert.strictEqual(sb.__posted.filter(m => m && m.type === 'BRIDGE_BROKEN').length, 0, '正常时不该报失效');
});

check('重载后简历下发不抛未捕获错误（修复前这里就是那条红色报错）', async () => {
  const sb = makeBridgeEnv();
  await flush();
  sb.__invalidate();                       // ← 用户此刻去 edge://extensions 重载了插件
  const callsBefore = sb.__sendMessageCalls();
  let threw = null;
  try { pushResume(sb, { name: '张三' }); await flush(); } catch (e) { threw = e; }
  assert.strictEqual(threw, null, threw ? `仍会抛错：${threw.message}` : '');
  assert.strictEqual(sb.__sendMessageCalls(), callsBefore, 'safeSendMessage 应在探测 runtime.id 阶段就拦住，不触碰失效句柄');
  assert.ok(!sb.__warnings.some(w => /Uncaught/.test(w)), '不得出现未捕获错误');
});

check('失败被收敛成一次 BRIDGE_BROKEN 上报，带可操作的刷新提示', async () => {
  const sb = makeBridgeEnv();
  await flush();
  sb.__invalidate();
  pushResume(sb, { name: '张三' });
  await flush();
  const broken = sb.__posted.filter(m => m && m.type === 'BRIDGE_BROKEN');
  assert.strictEqual(broken.length, 1, `应上报一次，实际 ${broken.length}`);
  assert.strictEqual(broken[0].source, 'AUTUMN_JOB_ASSISTANT', '网页端按 BRIDGE_SOURCES 过滤，源必须对得上');
  assert.ok(/刷新本页面即可恢复/.test(broken[0].detail), broken[0].detail);
  assert.ok(/简历下发到插件/.test(broken[0].detail), `应说明是哪一步失败：${broken[0].detail}`);
  assert.ok(sb.__warnings.some(w => /简历下发到插件/.test(w)), '控制台应留一条 warn 便于排查');
});

check('网页版 1s/3s 定时推送连续失败也只上报一次（不刷屏）', async () => {
  const sb = makeBridgeEnv();
  await flush();
  sb.__invalidate();
  const handlerCount = pushResume(sb, { name: '张三' });
  assert.ok(handlerCount >= 1, '应已注册 message 监听');
  pushResume(sb, { name: '李四' });
  pushResume(sb, { name: '王五' });
  await flush();
  const broken = sb.__posted.filter(m => m && m.type === 'BRIDGE_BROKEN');
  assert.strictEqual(broken.length, 1, `连续三次失败仍只上报一次，实际 ${broken.length}`);
  const resumeWarns = sb.__warnings.filter(w => /简历下发到插件/.test(w));
  assert.strictEqual(resumeWarns.length, 3, '每次失败仍各留一条 warn 供排查，但不打扰用户');
});

check('下发失败不影响后续消息处理，非目标消息被安全忽略', async () => {
  const sb = makeBridgeEnv();
  await flush();
  sb.__invalidate();
  pushResume(sb, { name: '张三' });
  await flush();
  let threw = null;
  try {
    const handlers = sb.__listeners.message || [];
    for (const h of handlers) h({ source: sb.window, data: { source: 'AUTUMN_TRACKER', type: 'OTHER' } });
    for (const h of handlers) h({ source: {}, data: null });
    for (const h of handlers) h({ source: sb.window, data: { source: '别的插件', type: 'RESUME_PUSH', resume: {} } });
    await flush();
  } catch (e) { threw = e; }
  assert.strictEqual(threw, null, threw ? `处理后续消息时抛错：${threw.message}` : '');
});

check('极端情况：加载时上下文就已失效，也不得抛错（页面在插件被停用后打开）', async () => {
  let threw = null;
  let sb = null;
  try { sb = makeBridgeEnv({ invalidatedAtLoad: true }); await flush(); } catch (e) { threw = e; }
  assert.strictEqual(threw, null, threw ? `加载即抛错：${threw.message}` : '');
  assert.strictEqual(sb.__sendMessageCalls(), 0, '不该触碰失效句柄');
  const broken = sb.__posted.filter(m => m && m.type === 'BRIDGE_BROKEN');
  assert.strictEqual(broken.length, 1, '读暂存箱失败应上报一次');
  assert.ok(/读取暂存箱/.test(broken[0].detail), broken[0].detail);
});

section('扩展上下文正常时（回归：不能把正常链路弄坏）');

check('正常状态下简历下发成功、不产生任何提示', async () => {
  const sb = makeBridgeEnv();
  await flush();
  const before = sb.__sendMessageCalls();
  pushResume(sb, { name: '张三' });
  await flush();
  assert.strictEqual(sb.__sendMessageCalls(), before + 1, '应发出 SAVE_RESUME');
  assert.strictEqual(sb.__posted.filter(m => m && m.type === 'BRIDGE_BROKEN').length, 0);
  assert.strictEqual(sb.__warnings.length, 0, `正常时不该有 warn：${sb.__warnings.join(' | ')}`);
});

check('safeSendMessage 会消费 runtime.lastError，不产生 "Unchecked runtime.lastError" 刷屏', async () => {
  // 上下文仍在、但 background 未响应（典型：service worker 已休眠）→ lastError 有值
  const warnings = [];
  const box = {
    console: { warn: (...a) => warnings.push(a.join(' ')) },
    chrome: { runtime: { id: 'ext', lastError: { message: 'Could not establish connection.' }, sendMessage(m, cb) { cb(undefined); } } }
  };
  vm.createContext(box);
  vm.runInContext(`${safeSendMessageSrc}\n;__run = safeSendMessage;`, Object.assign(box, { __run: null }), { filename: 'safe-send.js' });
  let errorSeen = null;
  box.__run({ type: 'X' }, () => {}, reason => { errorSeen = reason; });
  assert.strictEqual(errorSeen, 'Could not establish connection.', '应把 lastError 交给 onError 回调');
  assert.strictEqual(warnings.length, 0, '不该往控制台刷 warn');
});

runAll();
