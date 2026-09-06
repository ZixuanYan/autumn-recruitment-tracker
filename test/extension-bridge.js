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
// 真实的 safeSendMessage 从 05-sidebar.js 原文抽取（不打桩），保证测的是实际防护逻辑。
// 运行：node test/extension-bridge.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const EXT = path.resolve(__dirname, '../../autumn-recruitment-tracker/extension');
const bridgeSrc = fs.readFileSync(path.join(EXT, 'content/06-bridge.js'), 'utf8');
const sidebarSrc = fs.readFileSync(path.join(EXT, 'content/05-sidebar.js'), 'utf8');

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

const safeSendMessageSrc = extractFunction(sidebarSrc, 'safeSendMessage');
assert.ok(safeSendMessageSrc.length > 100, '未能从 05-sidebar.js 抽取真实的 safeSendMessage');

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
  const htmlSrc = fs.readFileSync(path.resolve(__dirname, '../../autumn-recruitment-tracker/index.html'), 'utf8');
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
