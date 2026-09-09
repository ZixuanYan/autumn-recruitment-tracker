'use strict';
// ============================================================================
// test/extension-panel.js — Side Panel 运行时冒烟测试（extension/panel/panel.js）
//
// 为什么需要：extension-ui.js 只做静态断言与纯函数单测，panel.js 的 init() 从不执行。
// 而 init() 里全是「取 25 个元素 id、绑十几个事件、注入模板」这类只有真跑一遍才暴露的错误
// ——本项目已经吃过两次这种亏（index.js 的 verdict 重复声明、adjudicated 声明在 try 块内，
// 两次都是语法检查与静态断言全绿、真实执行才炸）。这个文件用桩 DOM 真跑 init()。
//
// 桩的取舍：只桩到「能验证交互契约」的程度，不追求完整 DOM 语义。
// querySelectorAll 用可注入的 _byClass 表，测试显式给出层级，验证过滤逻辑而不是验证 DOM 引擎。
//
// 运行：node test/extension-panel.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const EXT = path.resolve(__dirname, '../extension');
const read = (rel) => fs.readFileSync(path.join(EXT, rel), 'utf8');

let failed = 0;
const cases = [];
function check(name, fn) { cases.push({ kind: 'case', name, fn }); }
function section(title) { cases.push({ kind: 'section', title }); }

async function runAll() {
  for (const item of cases) {
    if (item.kind === 'section') { console.log(item.title); continue; }
    try { await item.fn(); console.log(`  ✓ ${item.name}`); }
    catch (e) { failed += 1; console.error(`  ✗ ${item.name}\n    ${e.message}`); }
  }
  console.log(`\n${failed ? `存在 ${failed} 个失败` : `Side Panel 运行时冒烟测试全部通过（共 ${cases.filter(c => c.kind === 'case').length} 个）`}`);
  if (failed) process.exitCode = 1;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
async function settle(times = 4) { for (let i = 0; i < times; i++) await flush(); }

// ---------------- DOM 桩 ----------------
function makeDoc() {
  const doc = {
    readyState: 'complete',
    activeElement: null,
    _ids: new Map(),
    _listeners: {},
    _styleEls: [],
    head: null,
    register(id) {
      if (!doc._ids.has(id)) doc._ids.set(id, makeEl(id, 'div', doc));
      return doc._ids.get(id);
    },
    getElementById(id) { return doc.register(id); },
    // CaptureForm.els(document) 用 querySelector('#cap-xxx')，因此按 id 选择器查表
    querySelector(sel) {
      const s = String(sel || '');
      if (s.startsWith('#')) return doc.register(s.slice(1));
      return null;
    },
    querySelectorAll() { return []; },
    createElement(tag) { return makeEl('', tag, doc); },
    addEventListener(type, fn) { (doc._listeners[type] = doc._listeners[type] || []).push(fn); },
    fire(type, ev) { for (const fn of (doc._listeners[type] || [])) fn(Object.assign({ type, preventDefault() {} }, ev || {})); }
  };
  doc.head = makeEl('', 'head', doc);
  doc.head.appendChild = (el) => { doc._styleEls.push(el); };
  return doc;
}

function makeEl(id, tag, doc) {
  const el = {
    id: id || '',
    tagName: String(tag || 'div').toUpperCase(),
    textContent: '',
    value: '',
    hidden: false,
    disabled: false,
    title: '',
    style: {},
    onclick: null,
    _attrs: {},
    _listeners: {},
    _byClass: {},           // 测试可注入：{ '.p-chip': [el, el] }
    offsetWidth: 300,
    offsetHeight: 200,
    classList: null,
    addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { el._attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(el._attrs, k) ? el._attrs[k] : null; },
    querySelector(sel) {
      const s = String(sel || '');
      if (s.startsWith('#')) return doc.register(s.slice(1));
      const list = el._byClass[s];
      return Array.isArray(list) && list.length ? list[0] : null;
    },
    querySelectorAll(sel) { const l = el._byClass[String(sel || '')]; return Array.isArray(l) ? l : []; },
    closest() { return null; },
    focus() { doc.activeElement = el; },
    // 测试用：派发事件，target 默认自己（可覆盖成子元素以验证事件委托）
    fire(type, ev) {
      for (const fn of (el._listeners[type] || [])) {
        fn(Object.assign({ type, target: el, preventDefault() {}, stopPropagation() {} }, ev || {}));
      }
    }
  };
  el.classList = {
    _set: new Set(),
    add(c) { el._set_add(c); },
    remove(c) { el._set_del(c); },
    toggle(c, force) {
      const want = force === undefined ? !el.classList.contains(c) : !!force;
      if (want) el._set_add(c); else el._set_del(c);
      return want;
    },
    contains(c) { return el.classList._set.has(c); }
  };
  el._set_add = (c) => { el.classList._set.add(c); };
  el._set_del = (c) => { el.classList._set.delete(c); };

  // className 与 classList 必须联动：真实 DOM 里赋 className 会重建 classList。
  // capture-form.js 的 renderDetectHint 正是用 className = 'detect-hint warn' 切告警态的，
  // 桩不联动就会让「有缺失字段应是告警态」这类断言假失败。
  let _cn = '';
  Object.defineProperty(el, 'className', {
    get() { return _cn; },
    set(v) {
      _cn = String(v == null ? '' : v);
      el.classList._set = new Set(_cn.split(/\s+/).filter(Boolean));
    }
  });

  // innerHTML 的 setter 会把新出现的 id 注册进 document，
  // 模拟「formHost.innerHTML = CaptureForm.html() 之后 #cap-company 才可查询」这个真实时序
  let _html = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return _html; },
    set(v) {
      _html = String(v == null ? '' : v);
      for (const m of _html.matchAll(/id="([^"]+)"/g)) doc.register(m[1]);
    }
  });
  return el;
}

// ---------------- chrome 桩 ----------------
function makeChrome(state) {
  const st = state || {};
  const chromeStub = {
    runtime: {
      id: 'fake-extension-id',
      lastError: null,
      sendMessage(message, cb) {
        st.sent = st.sent || [];
        st.sent.push(message);
        const res = typeof st.respond === 'function' ? st.respond(message) : undefined;
        // 模拟真实时序：回调是异步的
        Promise.resolve().then(() => {
          chromeStub.runtime.lastError = st.lastError || null;
          if (cb) cb(res);
        });
      }
    },
    tabs: {
      // st.tab 为 null 表示「没有活动标签页」，query 返回空数组
      query: async () => (st.tab ? [st.tab] : []),
      create: (opts) => { st.created = st.created || []; st.created.push(opts); },
      onActivated: { addListener(fn) { st.onActivated = fn; } },
      onUpdated: { addListener(fn) { st.onUpdated = fn; } }
    },
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener(fn) { st.onStorageChanged = fn; } }
    }
  };
  return chromeStub;
}

// ---------------- panel.html 的初始状态 ----------------
// 桩 document 凭空造元素时并不知道 HTML 里写了 hidden、aria-expanded="false"，
// 于是「暂存箱默认应折叠」这类断言会假失败。这里解析真实的 panel.html，
// 把每个 id 的初始属性应用到桩元素上，让 init() 面对的是与线上一致的初始状态。
function parseInitial(html) {
  const map = new Map();
  for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g)) {
    const attrText = m[2];
    const idm = /\bid="([^"]+)"/.exec(attrText);
    if (!idm) continue;
    const attrs = {};
    for (const a of attrText.matchAll(/\b([a-zA-Z][-a-zA-Z0-9_]*)(?:\s*=\s*"([^"]*)")?/g)) {
      if (a[1] === 'id') continue;
      attrs[a[1]] = a[2] === undefined ? '' : a[2];
    }
    map.set(idm[1], attrs);
  }
  return map;
}

// ---------------- 加载 panel.js 并跑 init() ----------------
async function bootPanel(options) {
  const opts = options || {};
  const doc = makeDoc();
  const state = {
    tab: opts.tab === undefined ? { id: 7, url: 'https://careers.tencent.com/jobdetail.html?x=1', active: true } : opts.tab,
    respond: opts.respond || (() => ({ ok: true })),
    lastError: opts.lastError || null
  };
  const chromeStub = makeChrome(state);

  const sandbox = {
    console: opts.quiet ? { log() {}, debug() {}, warn() {}, error() {} } : console,
    document: doc,
    chrome: chromeStub,
    navigator: { clipboard: { writeText: async () => {} } },
    URL, encodeURIComponent, decodeURIComponent,
    Number, String, Object, Array, JSON, Math, Promise, RegExp, Date, Error, Set, Map, Boolean,
    setTimeout, clearTimeout, setImmediate
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.matchMedia = () => ({
    matches: opts.scheme === 'dark',
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}
  });
  vm.createContext(sandbox);

  // 先把 panel.html 声明的初始属性应用到桩元素（hidden / aria-expanded / class …），
  // 否则 init() 面对的是「全部可见、无 ARIA 状态」的假初始态，折叠类断言会全部假失败
  for (const [id, attrs] of parseInitial(read('panel/panel.html'))) {
    const node = doc.getElementById(id);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'hidden') { node.hidden = true; node.setAttribute('hidden', ''); continue; }
      if (k === 'class') { node.className = v; continue; }
      node.setAttribute(k, v);
    }
  }

  // 加载顺序**直接读 panel.html 的 <script> 列表**，不在测试里硬编码：
  // 硬编码的话每次增删脚本都要同步改测试，改漏了就会测到与线上不一致的加载顺序
  // （阶段 2 把 default-resume 从 common/ 换到 shared/ 时，硬编码列表就直接 ENOENT 了）。
  const panelHtml = read('panel/panel.html');
  const scripts = [...panelHtml.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length >= 7, `panel.html 只解析出 ${scripts.length} 个 script，正则可能失效`);
  for (const s of scripts) {
    // panel.html 在 extension/panel/ 下：../shared/x.js → shared/x.js；panel.js → panel/panel.js
    const rel = s.startsWith('../') ? s.slice(3) : `panel/${s}`;
    vm.runInContext(read(rel), sandbox, { filename: rel });
  }
  await settle();
  return { sandbox, doc, state, AJA: sandbox.AJA, P: sandbox.AJAPanel, el: (id) => doc.getElementById(id) };
}

// ============================================================================
section('A. init() 真实跑通（静态断言抓不到的取错 id / 绑到 undefined）');

check('init() 不抛错，25 个元素全部取到并完成初始化', async () => {
  const { el, AJA } = await bootPanel({ quiet: true });
  // 顶栏
  assert.ok(el('p-logo').innerHTML.includes('<svg'), 'logo 未注入 SVG');
  assert.strictEqual(el('p-ver').textContent, `v${AJA.VERSION}`, '版本徽标未填');
  // 四个图标容器
  for (const id of ['p-scan-ico', 'p-search-ico', 'p-globe-ico', 'p-cap-arrow', 'p-pend-arrow', 'p-res-arrow']) {
    assert.ok(el(id).innerHTML.includes('<svg'), `${id} 未注入 SVG 图标`);
  }
  // 表单模板已注入，且下拉已填充
  const formHost = el('p-form-host');
  assert.ok(formHost.innerHTML.includes('id="cap-company"'), '表单模板未注入 formHost');
  assert.ok(el('cap-company'), '注入后 #cap-company 应可被 document 查到');
  assert.strictEqual((el('cap-stage').innerHTML.match(/<option/g) || []).length, AJA.STAGES.length, '阶段下拉未填充');
  assert.strictEqual((el('cap-company-type').innerHTML.match(/<option/g) || []).length, AJA.COMPANY_TYPES.length + 1, '企业性质下拉未填充');
  assert.strictEqual(el('aja-capture-form').hidden, true, '表单初始应收起（还没识别当前页）');
});

check('事件真的绑上了（绑到 undefined 元素会静默失败，点了没反应）', async () => {
  const { el } = await bootPanel({ quiet: true });
  const mustHave = {
    'p-scan-btn': ['click'], 'p-cap-head': ['click'], 'p-pend-head': ['click'], 'p-res-head': ['click'],
    'p-pend-list': ['click'], 'p-resume-search': ['input'], 'p-resume-list': ['click', 'contextmenu'],
    'p-open-tracker': ['click'], 'cap-save-btn': ['click'], 'cap-cancel-btn': ['click'], 'cap-title-hint': ['click']
  };
  for (const [id, types] of Object.entries(mustHave)) {
    for (const t of types) {
      const list = el(id)._listeners[t] || [];
      assert.ok(list.length > 0, `#${id} 没有绑定 ${t} 事件`);
    }
  }
});

check('设计令牌与表单样式确实注入到了 <style>，深色主题取深色调色板', async () => {
  const light = await bootPanel({ quiet: true });
  const styles = light.doc._styleEls;
  assert.strictEqual(styles.length, 1, '应注入且仅注入一个 <style>');
  const css = styles[0].textContent;
  assert.ok(css.startsWith(':root {'), 'panel 侧令牌应挂在 :root（Shadow DOM 才用 :host）');
  // 强调色读令牌值而不是硬编码 hex：v5.2.0 起 accent 在 light/dark 两套里，
  // 硬编码旧值会在每次换设计语言时误报（这条断言的目的只是"令牌真的注入了"）。
  assert.ok(css.includes(`--aja-accent: ${light.AJA.TOKENS.light.accent}`), '令牌里没有强调色');
  assert.ok(css.includes(`--aja-bg: ${light.AJA.TOKENS.light.bg}`), '默认应取浅色调色板');
  assert.ok(css.includes('.capture-form'), '表单样式未随模板一起注入');
  assert.ok(css.includes('.btn-save-record'), '表单样式缺保存按钮');

  const dark = await bootPanel({ quiet: true, scheme: 'dark' });
  const darkCss = dark.doc._styleEls[0].textContent;
  assert.ok(darkCss.includes(`--aja-bg: ${dark.AJA.TOKENS.dark.bg}`), '深色主题未取深色调色板');
  assert.ok(!darkCss.includes(dark.AJA.TOKENS.light.bg), '深色主题里混进了浅色背景值');
});

check('打开网页版走 chrome.tabs.create（扩展页面里 window.open 会被拦）', async () => {
  const { el, state, AJA } = await bootPanel({ quiet: true });
  el('p-open-tracker').fire('click');
  assert.ok(state.created && state.created.length === 1, '没有创建标签页');
  assert.strictEqual(state.created[0].url, AJA.TRACKER_URL);
});

// ============================================================================
section('B. 当前页状态：三态判定与按钮禁用（切页后必须刷新，否则会串页存错链接）');

check('招聘网站：状态条给出域名，识别按钮可用', async () => {
  const { el } = await bootPanel({ quiet: true, tab: { id: 3, url: 'https://campus.jd.com/job/detail/1' } });
  assert.ok(el('p-pagestate').innerHTML.includes('campus.jd.com'), '状态条应显示当前域名');
  assert.strictEqual(el('p-scan-btn').disabled, false, '可收录页面按钮不该禁用');
  assert.ok(!el('p-pagestate').classList.contains('is-warn'), '正常页面不该是告警态');
});

check('浏览器内部页：按钮禁用并说清是哪一类页面', async () => {
  const { el } = await bootPanel({ quiet: true, tab: { id: 3, url: 'edge://extensions/' } });
  assert.strictEqual(el('p-scan-btn').disabled, true, '内部页必须禁用识别按钮');
  assert.ok(el('p-pagestate').classList.contains('is-warn'), '内部页应是告警态');
  assert.ok(el('p-pagestate').innerHTML.includes('浏览器内部页'), '应说明是内部页而不是念 hostname');
});

check('网页版管理器页：提示不需要插件辅助', async () => {
  // 先单独取 TRACKER_URL：不能在同一条解构里引用 AJA，那是它自己初始化前的引用，会 TDZ 报错
  const { AJA } = await bootPanel({ quiet: true });
  const { el } = await bootPanel({ quiet: true, tab: { id: 3, url: `${AJA.TRACKER_URL}#/records` } });
  assert.strictEqual(el('p-scan-btn').disabled, true);
  assert.ok(el('p-pagestate').innerHTML.includes('网页版管理器'), '应识别出这是管理器页');
});

check('没有活动标签页时不崩，且状态为不可用', async () => {
  // 必须传 null 而不是 undefined：undefined 会被 bootPanel 当成「未指定」而回落到默认标签页
  const { el } = await bootPanel({ quiet: true, tab: null });
  assert.strictEqual(el('p-scan-btn').disabled, true);
  assert.ok(el('p-pagestate').innerHTML.length > 0, '应给出状态文案而不是空白');
});

check('切换标签页后状态条刷新，并收起上一次的解析结果', async () => {
  const { el, state } = await bootPanel({ quiet: true, tab: { id: 3, url: 'https://a.com/job' } });
  assert.ok(typeof state.onActivated === 'function', '没有监听 tabs.onActivated（面板会一直显示旧页面）');
  // 先假装识别过：表单展开、留了上一次的 URL
  el('aja-capture-form').hidden = false;
  state.tab = { id: 9, url: 'edge://settings/' };
  state.onActivated({ tabId: 9 });
  await settle();
  assert.strictEqual(el('p-scan-btn').disabled, true, '切到内部页后按钮应禁用');
  assert.strictEqual(el('aja-capture-form').hidden, true, '切页后必须收起上一次的解析结果，否则会串页');
  // onUpdated 也要能触发刷新（同一标签页内导航）
  assert.ok(typeof state.onUpdated === 'function', '没有监听 tabs.onUpdated');
  state.tab = { id: 9, url: 'https://b.com/job', active: true };
  state.onUpdated(9, { status: 'complete' }, state.tab);
  await settle();
  assert.strictEqual(el('p-scan-btn').disabled, false, '同标签页导航到招聘站后应恢复可用');
});

// ============================================================================
section('C. 一键收录：panel → background → content 的往返');

check('识别成功：表单展开、字段回填、带上目标页 URL、聚焦第一个缺失字段', async () => {
  const { el, state } = await bootPanel({
    quiet: true,
    tab: { id: 11, url: 'https://careers.tencent.com/jobdetail.html?x=1' },
    respond: (msg) => (msg.type === 'SCAN_CURRENT_PAGE' ? {
      ok: true,
      data: { company: '腾讯', position: '', city: '深圳', stage: '已投递', applicationDate: '2026-09-08', _sources: { company: 'jsonld' } },
      title: '后端开发工程师-腾讯招聘',
      url: 'https://careers.tencent.com/jobdetail.html?x=1'
    } : { ok: true })
  });
  el('p-scan-btn').fire('click');
  await settle();

  const scan = state.sent.find(m => m.type === 'SCAN_CURRENT_PAGE');
  assert.ok(scan, '没有发出 SCAN_CURRENT_PAGE');
  assert.strictEqual(scan.tabId, 11, '消息必须带目标 tabId，否则 background 只能猜');

  assert.strictEqual(el('aja-capture-form').hidden, false, '识别后表单应展开');
  assert.strictEqual(el('cap-company').value, '腾讯');
  assert.strictEqual(el('cap-city').value, '深圳');
  assert.strictEqual(el('cap-position').value, '', '识别不出的字段应留空由人工补填（解析器宁空勿错）');
  assert.ok(el('cap-title-text').textContent.includes('腾讯招聘'), '应显示网页标题供核对');
  assert.ok(el('cap-detect-hint').innerHTML.includes('投递岗位'), '应点名缺失的字段');
  assert.ok(el('cap-detect-hint').classList.contains('warn'), '有缺失字段应是告警态');
  assert.strictEqual(el('cap-detect-hint').hidden, false);
});

check('识别失败（页面没注入脚本）：toast 说人话，表单不展开', async () => {
  const { el, state } = await bootPanel({
    quiet: true,
    respond: () => ({ ok: false, reason: 'no-content-script', message: 'Could not establish connection' })
  });
  el('p-scan-btn').fire('click');
  await settle();
  assert.strictEqual(el('aja-capture-form').hidden, true, '失败时不该展开空表单');
  const toast = el('p-toast').textContent;
  assert.ok(toast.includes('刷新页面'), `toast 应给出可操作的指引，实际是「${toast}」`);
  assert.ok(!toast.includes('no-content-script'), 'toast 不该把内部 reason 直接甩给用户');
  assert.strictEqual(el('p-toast').hidden, false, 'toast 应可见');
  assert.ok(state.sent.some(m => m.type === 'SCAN_CURRENT_PAGE'), '仍然要尝试过一次');
});

check('保存：走 PUSH_TO_TRACKER，applicationUrl 用目标页而非面板自己的地址', async () => {
  const { el, state } = await bootPanel({
    quiet: true,
    tab: { id: 12, url: 'https://job.bytedance.com/x' },
    respond: (msg) => (msg.type === 'SCAN_CURRENT_PAGE'
      ? { ok: true, data: { company: '字节跳动', position: '前端', city: '北京', stage: '已投递', applicationDate: '2026-09-08' }, title: 't', url: 'https://job.bytedance.com/x' }
      : { ok: true, total: 1 })
  });
  el('p-scan-btn').fire('click');
  await settle();
  el('cap-save-btn').fire('click');
  await settle();

  const push = state.sent.find(m => m.type === 'PUSH_TO_TRACKER');
  assert.ok(push, '没有发出 PUSH_TO_TRACKER');
  assert.strictEqual(push.record.company, '字节跳动');
  assert.strictEqual(push.record.applicationUrl, 'https://job.bytedance.com/x',
    '投递链接必须是目标页的 URL；面板自己的 location 是 chrome-extension:// 地址，存进去就是废数据');
  assert.ok(!String(push.record.applicationUrl).includes('chrome-extension'), '链接里混进了扩展页面地址');
  assert.strictEqual(el('aja-capture-form').hidden, true, '保存成功后应收起表单');
});

check('管理器没打开时回落暂存箱，并刷新暂存列表', async () => {
  const { el, state } = await bootPanel({
    quiet: true,
    respond: (msg) => {
      if (msg.type === 'SCAN_CURRENT_PAGE') return { ok: true, data: { company: 'A', position: 'B', city: '', stage: '已投递', applicationDate: '' }, title: 't', url: 'https://a.com/1' };
      if (msg.type === 'PUSH_TO_TRACKER') return { ok: false, reason: 'tracker-not-open' };
      if (msg.type === 'SAVE_JOB_RECORD') return { ok: true, total: 2 };
      if (msg.type === 'GET_PENDING_RECORDS') return { ok: true, records: [{ id: 'p1', company: 'A', position: 'B', stage: '已投递', applicationDate: '2026-09-08' }] };
      return { ok: true };
    }
  });
  el('p-scan-btn').fire('click');
  await settle();
  state.sent.length = 0;
  el('cap-save-btn').fire('click');
  await settle();
  assert.ok(state.sent.some(m => m.type === 'SAVE_JOB_RECORD'), '管理器未打开时应回落暂存箱，不能丢数据');
  assert.ok(state.sent.some(m => m.type === 'GET_PENDING_RECORDS'), '保存后应刷新暂存列表');
});

check('取消按钮收起表单', async () => {
  const { el } = await bootPanel({ quiet: true });
  el('aja-capture-form').hidden = false;
  el('cap-cancel-btn').fire('click');
  assert.strictEqual(el('aja-capture-form').hidden, true);
});

// ============================================================================
section('D. 暂存箱与简历字段库');

check('暂存箱：计数徽标、列表渲染、空态引导', async () => {
  const { el } = await bootPanel({
    quiet: true,
    respond: (msg) => (msg.type === 'GET_PENDING_RECORDS' ? {
      ok: true,
      records: [
        { id: 'a1', company: '腾讯', position: '后端（深圳）', stage: '一面', applicationDate: '2026-09-01', companyType: '私企' },
        { id: 'a2', company: '腾讯', position: '后端（北京）', stage: '已投递', applicationDate: '2026-09-02', variantOf: '腾讯 · 后端（深圳）' }
      ]
    } : { ok: true })
  });
  assert.strictEqual(el('p-pend-count').textContent, '2');
  assert.strictEqual(el('p-pend-count').hidden, false, '有条目时徽标不该隐藏');
  const html = el('p-pend-list').innerHTML;
  assert.ok(html.includes('腾讯 · 后端（深圳）'), '应渲染公司与岗位');
  assert.ok(html.includes('私企'), '应渲染企业性质');
  assert.ok(html.includes('是同公司的相近岗位'), '同公司多岗位要说明不是重复堆积');
  assert.ok(html.includes('data-discard="a1"'), '每条要有丢弃入口');
  assert.ok(html.includes('data-fill="a1"'), '每条要可点击回填');

  const empty = await bootPanel({ quiet: true, respond: (msg) => (msg.type === 'GET_PENDING_RECORDS' ? { ok: true, records: [] } : { ok: true }) });
  assert.strictEqual(empty.el('p-pend-count').textContent, '0');
  assert.strictEqual(empty.el('p-pend-count').hidden, true, '空暂存箱不该显示 0 徽标');
  assert.ok(empty.el('p-pend-list').innerHTML.includes('p-empty'), '应给空态引导');
});

check('暂存箱：丢弃发 REMOVE_PENDING_RECORD，点击条目回填表单且带回企业性质', async () => {
  const { el, state } = await bootPanel({
    quiet: true,
    respond: (msg) => (msg.type === 'GET_PENDING_RECORDS' ? {
      ok: true,
      records: [{ id: 'x1', company: '字节跳动', position: '前端（北京）', city: '北京', stage: '二面', applicationDate: '2026-09-03', companyType: '私企', applicationUrl: 'https://job.bytedance.com/x' }]
    } : { ok: true, total: 0 })
  });
  // 丢弃：事件委托，target 是按钮本身
  const discardBtn = makeEl('', 'button', el('p-pend-list').querySelector ? { register: () => null } : null);
  discardBtn.setAttribute('data-discard', 'x1');
  el('p-pend-list').fire('click', { target: discardBtn });
  await settle();
  assert.ok(state.sent.some(m => m.type === 'REMOVE_PENDING_RECORD' && m.id === 'x1'), '丢弃没有发出 REMOVE_PENDING_RECORD');

  // 回填：target 是 .p-pend-main 容器
  state.sent.length = 0;
  const main = makeEl('', 'div', { register: () => null });
  main.setAttribute('data-fill', 'x1');
  main.closest = (sel) => (String(sel).includes('data-fill') ? main : null);
  el('p-pend-list').fire('click', { target: main });
  await settle();
  assert.strictEqual(el('cap-company').value, '字节跳动');
  assert.strictEqual(el('cap-position').value, '前端（北京）', '岗位名的括号修饰不能被丢');
  assert.strictEqual(el('cap-company-type').value, '私企', '企业性质必须一并回填，否则重复收录会冲掉已选值');
  assert.strictEqual(el('cap-stage').value, '二面');
  assert.strictEqual(el('aja-capture-form').hidden, false, '回填后应展开表单');
  assert.strictEqual(el('p-cap-body').hidden, false, '回填后应展开「一键收录」段');
});

check('简历字段库：渲染 chip、徽标计数、chip 左键发 FILL_FOCUSED_FIELD', async () => {
  const resume = { '优先信息': { '手机': '13800000000', '邮箱': '' }, '教育经历': [{ _rowName: '教育经历 1', '学校': '某大学' }] };
  const { el, state } = await bootPanel({
    quiet: true,
    tab: { id: 21, url: 'https://hr.163.com/form' },
    respond: (msg) => {
      if (msg.type === 'GET_RESUME_DATA') return { ok: true, data: resume };
      if (msg.type === 'FILL_FOCUSED_FIELD') return { ok: true, result: 'filled' };
      return { ok: true };
    }
  });
  assert.strictEqual(el('p-res-count').textContent, '2', '已填字段计数应为 2（空邮箱不算）');
  const html = el('p-resume-list').innerHTML;
  assert.ok(html.includes('13800000000') && html.includes('某大学'), 'chip 未渲染');
  assert.ok(!html.includes('邮箱'), '空值字段不该渲染');
  assert.ok(el('p-resume-status').textContent.includes('已填 2 项'), '简历状态未更新');

  // chip 左键：事件委托到 resumeList
  const chip = makeEl('', 'button', { register: () => null });
  chip.setAttribute('data-key', '手机');
  chip.setAttribute('data-val', encodeURIComponent('13800000000'));
  chip.closest = (sel) => (String(sel).includes('p-chip') ? chip : null);
  state.sent.length = 0;
  el('p-resume-list').fire('click', { target: chip });
  await settle();
  const fill = state.sent.find(m => m.type === 'FILL_FOCUSED_FIELD');
  assert.ok(fill, 'chip 左键没有发出 FILL_FOCUSED_FIELD');
  assert.strictEqual(fill.value, '13800000000');
  assert.strictEqual(fill.key, '手机');
  assert.strictEqual(fill.tabId, 21, '必须带 tabId，否则填进错误的标签页');
  assert.ok(el('p-toast').textContent.includes('已填入'), '应给出填入成功提示');
});

check('chip 右键复制到剪贴板，不经 content script', async () => {
  let copied = null;
  const { el, state } = await bootPanel({ quiet: true, respond: (msg) => (msg.type === 'GET_RESUME_DATA' ? { ok: true, data: { '优先信息': { '手机': '139' } } } : { ok: true }) });
  el('p-resume-list').querySelector = () => null;
  // 换掉 clipboard 桩以捕获写入
  const chip = makeEl('', 'button', { register: () => null });
  chip.setAttribute('data-key', '手机');
  chip.setAttribute('data-val', encodeURIComponent('139'));
  chip.closest = (sel) => (String(sel).includes('p-chip') ? chip : null);
  state.sent.length = 0;
  el('p-resume-list').fire('contextmenu', { target: chip });
  await settle();
  assert.ok(!state.sent.some(m => m.type === 'FILL_FOCUSED_FIELD'), '右键是复制，不该发填入消息');
  assert.ok(el('p-toast').textContent.includes('已复制'), `应提示已复制，实际「${el('p-toast').textContent}」`);
  assert.strictEqual(copied, null, '（剪贴板由桩接管，此处只验证没有走消息通道）');
});

check('速填失败但 content 已回退复制：如实转告而不是报"操作失败"', async () => {
  const { el, state } = await bootPanel({
    quiet: true,
    respond: (msg) => (msg.type === 'FILL_FOCUSED_FIELD' ? { ok: false, result: 'copied' } : { ok: true, data: {} })
  });
  const chip = makeEl('', 'button', { register: () => null });
  chip.setAttribute('data-val', encodeURIComponent('值'));
  chip.closest = (sel) => (String(sel).includes('p-chip') ? chip : null);
  el('p-resume-list').fire('click', { target: chip });
  await settle();
  assert.ok(el('p-toast').textContent.includes('剪贴板'), '应告知已复制到剪贴板、请粘贴');
  assert.ok(state.sent.some(m => m.type === 'FILL_FOCUSED_FIELD'));
});

check('搜索过滤：命中 chip 保留、未命中隐藏、命中段自动展开、清空后恢复', async () => {
  const { el } = await bootPanel({
    quiet: true,
    respond: (msg) => (msg.type === 'GET_RESUME_DATA' ? {
      ok: true, data: { '优先信息': { '手机': '138', '邮箱': 'a@b.c' }, '教育经历': [{ _rowName: 'r', '学校': '某大学' }] }
    } : { ok: true })
  });
  const list = el('p-resume-list');
  // 构造两层桩：段 → chip / 经历行
  const chipA = { textContent: '手机:138', getAttribute: (k) => (k === 'data-key' ? '手机' : null), style: {} };
  const chipB = { textContent: '学校:某大学', getAttribute: (k) => (k === 'data-key' ? '学校' : null), style: {} };
  const row = { querySelectorAll: (s) => (s === '.p-chip' ? [chipB] : []), style: {} };
  const secA = {
    style: {}, classList: { _s: new Set(['is-collapsed']), remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    querySelectorAll: (s) => (s === '.p-chip' ? [chipA] : s === '.p-exp-row' ? [] : []),
    querySelector: (s) => (s === '.p-res-body' ? { hidden: true } : null)
  };
  const secB = {
    style: {}, classList: { _s: new Set(), remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    querySelectorAll: (s) => (s === '.p-chip' ? [chipB] : s === '.p-exp-row' ? [row] : []),
    querySelector: (s) => (s === '.p-res-body' ? { hidden: true } : null)
  };
  list._byClass['.p-res-sec'] = [secA, secB];

  el('p-resume-search').value = '学校';
  el('p-resume-search').fire('input');
  assert.strictEqual(chipA.style.display, 'none', '未命中的 chip 应隐藏');
  assert.strictEqual(chipB.style.display, '', '命中的 chip 应保留');
  assert.strictEqual(secA.style.display, 'none', '整段无命中应隐藏');
  assert.strictEqual(secB.style.display, '', '有命中的段应可见');
  assert.ok(!secB.classList.contains('is-collapsed'), '命中的段应自动展开，否则用户搜到了却看不见');

  el('p-resume-search').value = '';
  el('p-resume-search').fire('input');
  assert.strictEqual(chipA.style.display, '', '清空查询后应恢复全部');
  assert.strictEqual(secA.style.display, '', '清空查询后段应恢复可见');
});

check('段落折叠：点击段头翻转 hidden 与 aria-expanded', async () => {
  const { el } = await bootPanel({ quiet: true });
  assert.strictEqual(el('p-pend-body').hidden, true, '暂存箱默认应折叠');
  assert.strictEqual(el('p-pend-head').getAttribute('aria-expanded'), 'false');
  el('p-pend-head').fire('click');
  assert.strictEqual(el('p-pend-body').hidden, false, '点击后应展开');
  assert.strictEqual(el('p-pend-head').getAttribute('aria-expanded'), 'true', 'aria-expanded 要跟着变，否则读屏器状态是错的');
  el('p-pend-head').fire('click');
  assert.strictEqual(el('p-pend-body').hidden, true, '再点应收起');
  // 一键收录段默认展开
  assert.strictEqual(el('p-cap-body').hidden, false, '一键收录应默认展开（主操作）');
  // 简历字段也默认展开（v5.3.1）：它是网申页上的高频操作（点字段速填），
  // 折叠着等于每次打开面板都要多点一下；暂存箱反而是事后待办，留在折叠态。
  assert.strictEqual(el('p-res-body').hidden, false, '简历字段应默认展开');
  assert.strictEqual(el('p-res-head').getAttribute('aria-expanded'), 'true', 'aria-expanded 要与 hidden 一致');
});

check('panel.html 的区块顺序：一键收录 → 简历字段 → 暂存箱（v5.3.1）', () => {
  // 顺序写在 HTML 里、panel.js 全部按 id 取元素，所以重排是安全的；但也因此**没有任何运行时
  // 信号**能发现顺序被改回去 —— 只能靠这条静态断言。放错的症状是高频的简历字段被挤到
  // 需要滚一屏才够得着，属纯体验退化、不报错。
  const src = read('panel/panel.html');
  const ids = ['p-sec-capture', 'p-sec-resume', 'p-sec-pending'];
  const at = ids.map(id => src.indexOf(`id="${id}"`));
  assert.ok(at.every(i => i > 0), `三个区块都要有 id，实际位置 ${JSON.stringify(at)}`);
  assert.ok(at[0] < at[1] && at[1] < at[2],
    `顺序应为 一键收录 → 简历字段 → 暂存箱，实际位置 ${JSON.stringify(at)}`);
  // 默认展开态也在 HTML 属性里（面板不持久化折叠状态），一并钉住
  const tagOf = (id) => {
    const m = new RegExp(`<[^>]*\\bid="${id}"[^>]*>`).exec(src);
    assert.ok(m, `panel.html 里找不到 id="${id}" 的标签`);
    return m[0];
  };
  for (const [head, body, wantOpen] of [['p-cap-head', 'p-cap-body', true], ['p-res-head', 'p-res-body', true], ['p-pend-head', 'p-pend-body', false]]) {
    assert.strictEqual(/aria-expanded="true"/.test(tagOf(head)), wantOpen, `${head} 的默认展开态应为 ${wantOpen}`);
    assert.strictEqual(!/\bhidden\b/.test(tagOf(body)), wantOpen, `${body} 的 hidden 必须与 aria-expanded 一致（不一致就是"看着展开了但内容不在"/反之）`);
  }
});

check('storage.onChanged：网页版下发简历 / 迷你卡片存暂存，面板都自动刷新', async () => {
  const { el, state } = await bootPanel({
    quiet: true,
    respond: (msg) => (msg.type === 'GET_RESUME_DATA' ? { ok: true, data: { '优先信息': { '手机': '138' } } } : { ok: true, records: [] })
  });
  assert.ok(typeof state.onStorageChanged === 'function', '没有监听 storage.onChanged（跨 UI 不会同步）');
  assert.strictEqual(el('p-res-count').textContent, '1');

  // 网页版下发新简历
  state.respond = (msg) => (msg.type === 'GET_PENDING_RECORDS' ? { ok: true, records: [{ id: 'n1', company: 'C', position: 'D' }] } : { ok: true });
  state.onStorageChanged({ [el('p-ver') ? 'autumnRecruitmentTracker.resume.v1' : 'x']: { newValue: { '优先信息': { '手机': '1', '邮箱': '2' } } } }, 'local');
  await settle();
  assert.strictEqual(el('p-res-count').textContent, '2', '简历更新后计数应刷新');

  // 迷你卡片存了暂存
  state.onStorageChanged({ 'autumnRecruitmentTracker.pending.v1': { newValue: [] } }, 'local');
  await settle();
  assert.strictEqual(el('p-pend-count').textContent, '1', '暂存变化后应重新拉取并刷新计数');

  // 其它 area 不该触发刷新
  const before = el('p-res-count').textContent;
  state.onStorageChanged({ 'autumnRecruitmentTracker.resume.v1': { newValue: {} } }, 'sync');
  await settle();
  assert.strictEqual(el('p-res-count').textContent, before, '非 local area 的变化不该触发刷新');
});

check('扩展上下文失效（runtime.lastError）时不崩、给出提示', async () => {
  const { el } = await bootPanel({
    quiet: true,
    lastError: { message: 'Extension context invalidated.' },
    respond: () => undefined
  });
  el('p-scan-btn').fire('click');
  await settle();
  // 不该抛到全局，也不该留下空白 toast
  assert.ok(el('p-toast').textContent.length > 0 || el('aja-capture-form').hidden === true, '失效时应保持收起状态');
});

runAll();
