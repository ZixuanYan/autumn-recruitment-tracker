'use strict';
// ============================================================================
// test/extension-ui.js — 插件 UI 契约与「反 AI 感」静态守卫（v5.0.0）
//
// 为什么需要这个文件：v4.2.0 的插件样式是典型的 AI 生成风——4 处蓝紫渐变、1 处毛玻璃、
// 6 处阴影（含带品牌色的彩色阴影）、27 处不成体系的圆角（20/16/15/12/10/8/6/4px）、
// 18 处 emoji 当图标、hover 时改 padding 导致按钮"跳"。这些都不是 bug，运行时一切正常，
// 人工复核也看不出来（要眼睛盯着看才知道丑），所以只能靠静态守卫钉住。
//
// 本文件同时覆盖 v5.0.0 新增的跨端契约：manifest 加载顺序、消息协议三端一致、
// 收录表单模板与两端取用的 id 一致、拖拽定位的纯数学。
//
// 做法与 extension-parsers.js 一致：读真实源码原文做断言，不在测试里复制实现。
// 运行：node test/extension-ui.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const EXT = path.resolve(__dirname, '../extension');
const ROOT = path.resolve(__dirname, '..');
const WEB = path.resolve(__dirname, '../index.html');

const read = (rel) => fs.readFileSync(path.join(EXT, rel), 'utf8');
const readRoot = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// 跨端单一事实源在仓库根 shared/；插件加载的是 extension/shared/ 的**生成拷贝**
// （Chrome 扩展只能加载扩展目录内的文件，且插件要独立打 zip 分发）。
// 两份都要测：源测内容正确，拷贝测与源逐字节相同（同源守卫，见 I 节）。
const SHARED_FILES = ['stages.js', 'company-types.js', 'company-key.js', 'default-resume.js'];

const SRC = {
  core: read('content/01-core.js'),
  capture: read('content/05-capture.js'),
  parsers: read('content/03-parsers.js'),
  bridge: read('content/06-bridge.js'),
  tokens: read('common/tokens.js'),
  icons: read('common/icons.js'),
  form: read('common/capture-form.js'),
  constants: read('common/constants.js'),
  background: read('background.js'),
  panelJs: read('panel/panel.js'),
  panelCss: read('panel/panel.css'),
  panelHtml: read('panel/panel.html'),
  manifest: JSON.parse(read('manifest.json'))
};

// 反 AI 感守卫与旧配色黑名单的扫描范围（相对仓库根，用 readRoot 读）。
// 刻意把 shared/ 与其生成拷贝 extension/shared/ 都纳入：生成拷贝若不扫就成了守卫盲区，
// 有人往跨端共享源里塞蓝紫渐变或 emoji 也发现不了（方案 D13 提到的正是这个）。
const SCAN_FILES = [
  'extension/content/01-core.js', 'extension/content/05-capture.js', 'extension/content/06-bridge.js',
  'extension/content/03-parsers.js', 'extension/common/tokens.js', 'extension/common/icons.js',
  'extension/common/capture-form.js', 'extension/common/constants.js',
  'extension/panel/panel.css', 'extension/panel/panel.js', 'extension/panel/panel.html',
  'extension/background.js',
  ...SHARED_FILES.map(f => `shared/${f}`),
  ...SHARED_FILES.map(f => `extension/shared/${f}`)
];

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
  console.log(`\n${failed ? `存在 ${failed} 个失败` : `插件 UI 契约与反 AI 感守卫全部通过（共 ${cases.filter(c => c.kind === 'case').length} 个）`}`);
  if (failed) process.exitCode = 1;
}

// ---------------- 源码加载沙箱（拿真实的 AJA 对象，不复制实现）----------------
function loadAjA() {
  const sandbox = {
    console, URL, encodeURIComponent, decodeURIComponent,
    Number, String, Object, Array, JSON, Math, Promise, RegExp, Date, Error, Set, Map,
    navigator: {},
    document: { readyState: 'loading', addEventListener() {}, getElementById: () => null, createElement: () => ({ style: {} }) }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  vm.createContext(sandbox);
  // 加载插件的**完整公共层**：extension/shared/ 四件（跨端单一事实源的生成拷贝）+ common 四件。
  // 这是 background.js 的 importScripts 与 panel.html 的 script 的**并集**——只跟 panel.html 会缺
  // company-key（面板确实用不到它），而本节要验证的是 shared 四件的完整契约。
  // 顺序仍然满足依赖：shared 必须在 constants 之前（constants 的 AJA.STAGES 是别名转发）。
  const commonLayer = [...SHARED_FILES.map(f => `shared/${f}`),
    'common/constants.js', 'common/tokens.js', 'common/icons.js', 'common/capture-form.js'];
  for (const f of commonLayer) {
    assert.ok(fs.existsSync(path.join(EXT, f)), `公共层文件不存在：extension/${f}`);
    vm.runInContext(read(f), sandbox, { filename: f });
  }
  // panel.html 的 script 必须是这个公共层的子集（多引一个不存在的就是 404）
  for (const m of SRC.panelHtml.matchAll(/<script src="([^"]+)"><\/script>/g)) {
    const rel = m[1].startsWith('../') ? m[1].slice(3) : null;
    if (rel) assert.ok(commonLayer.includes(rel), `panel.html 引了公共层之外的 ${rel}`);
  }
  return sandbox;
}
const sandbox = loadAjA();
const AJA = sandbox.AJA;

// ---------------- CSS 文本提取 ----------------
// 组件 CSS 藏在 JS 的模板字符串里（Shadow DOM 用 style.textContent 注入），
// 守卫必须扫到它，否则"JS 里写死颜色"就成了盲区。
function extractTemplate(src, marker) {
  const i = src.indexOf(marker);
  assert.ok(i > -1, `找不到模板起点标记：${marker}`);
  const start = src.indexOf('`', i);
  assert.ok(start > -1, `${marker} 之后没有反引号`);
  const end = src.indexOf('`', start + 1);
  assert.ok(end > start, `${marker} 的模板字符串未闭合`);
  return src.slice(start + 1, end);
}
const CORE_CSS = extractTemplate(SRC.core, 'const COMPONENT_CSS =');
const FORM_CSS = SRC.form.slice(SRC.form.indexOf('function css()'));
const ALL_CSS = [
  { name: 'content/01-core.js 的 COMPONENT_CSS', css: CORE_CSS },
  { name: 'common/capture-form.js 的 css()', css: FORM_CSS },
  { name: 'panel/panel.css', css: SRC.panelCss }
];

// ============================================================================
section('A. 反 AI 感静态守卫（这些缺陷运行时不报错、人工复核也看不出，只能靠断言钉住）');

// v4.2.0 用过的蓝紫 / 绿 / 浅蓝配色。任何一处回归都意味着"AI 感"又回来了。
const LEGACY_COLORS = [
  '#5367e9', '#4053cb', '#6275f0', '#4c5fd6', '#4f64ee', '#3d51cc', '#5b6cfa', '#4338ca',
  '#24a475', '#1e8b63', '#eff6ff', '#93c5fd', '#1d4ed8', '#dbeafe', '#eef2ff', '#a5b4fc',
  '#c7d2fe', '#e0e7ff', '#f0f4ff', '#e6edff', '#c7d7fe', '#bfdbfe', '#eef2f7', '#dc2626',
  '#fee2e2', '#fecaca', '#fffbeb', '#fcd34d', '#92400e',
  // v5.0.0-v5.1.0 的橙色系（v5.2.0 已统一为 Apple 蓝）。退场的配色必须进黑名单，
  // 否则将来有人"怀念旧橙"改回去不会被拦。rgba 用前缀匹配即可覆盖 soft 档。
  '#e8552d', '#cf4a26', 'rgba(232,85,45', '#c0392b', 'rgba(192,57,43', '#8a6118', 'rgba(178,140,20'
];

check('旧版蓝紫/绿/琥珀/橙配色零残留（36 个历史色值黑名单）', () => {
  // 刻意不区分注释与代码：先解析并排除注释会引入误删风险（字符串里的 // 、模板里的 /* 等），
  // 而「整个文件不许出现这些色值」这条规则简单可靠。代价是注释里提到旧配色时只能写「蓝紫色」
  // 这类文字描述、不能写出 hex——tokens.js 的 accent 注释就是这么写的。
  // 扫描范围见 SCAN_FILES（含 shared/ 与其生成拷贝，不留盲区）。
  for (const f of SCAN_FILES) {
    const lower = readRoot(f).toLowerCase();
    for (const c of LEGACY_COLORS) {
      assert.ok(!lower.includes(c), `${f} 里出现了旧配色 ${c}（注释里也不要写，见本断言上方说明）`);
    }
  }
});

check('零渐变：linear/radial/conic-gradient 一处都不许有', () => {
  for (const { name, css } of ALL_CSS) {
    for (const g of ['linear-gradient', 'radial-gradient', 'conic-gradient']) {
      assert.ok(!css.includes(g), `${name} 里出现了 ${g}`);
    }
  }
  // JS 里也不许把渐变写进内联 style
  assert.ok(!SRC.panelJs.includes('gradient'), 'panel.js 里出现了 gradient');
});

check('毛玻璃只允许 4 个浮层选择器，且必须有 @supports 降级（v5.2.0 从全面禁令改为白名单）', () => {
  // 为什么放宽：胶囊浮在别人的招聘页面上、Side Panel 是浏览器 UI 的一部分，
  // 玻璃是这两处最合适的分离手段，也最符合 Apple 语言（glass-nav 配方 .72 + saturate(180%) blur(20px)）。
  // 为什么不全放开：blur 用在密集小元素上会糊且掉帧（低端机），v5.0.0 的全面禁令正是为此。
  // 白名单是**四个具体选择器名**而不是"允许 backdrop-filter"，所以放宽面是可控的。
  const GLASS_OK = ['#aja-toggle', '#aja-capture-pop', '.p-header', '.aja-toast'];
  for (const { name, css } of ALL_CSS) {
    const rules = css.match(/[^{}]*\{[^}]*backdrop-filter[^}]*\}/g) || [];
    for (const rule of rules) {
      // 两个提取陷阱：① 注释文本会被 [^{}]* 粘进"选择器"，先剥掉；
      // ② @supports 的条件文本里本身就含 backdrop-filter，正则会把 @supports 的外层括号
      //    当成规则块——此时真正的选择器在块内部第一个 { 之前。
      const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').trim();
      let sel = strip(rule.slice(0, rule.indexOf('{')));
      if (/@supports/.test(sel)) {
        const inner = rule.slice(rule.indexOf('{') + 1);
        sel = strip(inner.slice(0, inner.indexOf('{')));
      }
      assert.ok(GLASS_OK.some(g => sel.includes(g)),
        `${name} 的 backdrop-filter 用在了非白名单选择器「${sel}」上——玻璃只允许浮层容器`);
    }
    if (/backdrop-filter/.test(css)) {
      assert.ok(/@supports[^{]*backdrop-filter/.test(css),
        `${name} 用了 backdrop-filter 但没有 @supports 包裹：不支持的浏览器必须退回不透明降级值，`
        + '否则浮层变半透明与宿主内容糊在一起不可读');
    }
    // filter: blur 是給元素**本身**加模糊（会把文字也糊掉），与玻璃无关，仍然全禁。
    // 检查前先剥掉 @supports 条件与 backdrop-filter 声明——它们的文本里天然含
    // "filter: blur"（如 @supports (backdrop-filter: blur(20px))），不剥会误报。
    const noGlassText = css
      .replace(/@supports[^{]*\{/g, '')
      .replace(/(?:-webkit-)?backdrop-filter\s*:[^;}]+/g, '');
    assert.ok(!/filter\s*:\s*blur/.test(noGlassText), `${name} 里出现了元素级 filter: blur`);
  }
});

check('零 emoji：18 处 emoji 图标已全部换成内联 SVG', () => {
  // 范围刻意不含 \u2190-\u21FF（箭头 →），注释里大量用它做流程示意，那不是图标。
  // 但含 \u2600-\u26FF（⚠ 落在这一段）：**注释里的 ⚠️ 同样会被拦**——这与旧配色黑名单是同一个取舍，
  // 守卫不区分注释与代码，换来简单可靠；写注释时用「注意：」代替即可（本轮就自己踩了一次）。
  const RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F0FF}]/u;
  for (const f of SCAN_FILES) {
    const hit = RE.exec(readRoot(f));
    assert.ok(!hit, `${f} 里出现了 emoji/装饰符号 ${hit ? JSON.stringify(hit[0]) : ''}（注释里也不要写）`);
  }
});

check('圆角只允许令牌档位（v5.2.0 起五档：4/6/10/14/999px）与 0，旧版混用值不许回来', () => {
  // 白名单直接读 RADIUS_WHITELIST（= Object.values(TOKENS.radius)），加档后自动跟随，
  // 不用改守卫逻辑——v5.0.0 硬编码四档值，加 pill 时就会漏改这里。
  const allowed = new Set(['0', ...AJA.RADIUS_WHITELIST]);
  for (const { name, css } of ALL_CSS) {
    const rules = css.match(/border-radius\s*:\s*([^;}]+)/g) || [];
    assert.ok(rules.length > 0, `${name} 里一条 border-radius 都没有（提取失败？）`);
    for (const rule of rules) {
      const value = rule.slice(rule.indexOf(':') + 1).trim();
      for (const part of value.split(/\s+/)) {
        const varKey = /^var\(--aja-radius-([a-z]+)\)$/.exec(part);
        const ok = allowed.has(part) || (varKey && Object.prototype.hasOwnProperty.call(AJA.TOKENS.radius, varKey[1]));
        assert.ok(ok, `${name} 的 border-radius 分量「${part}」不在白名单（原值：${value}）`);
      }
    }
  }
});

check('动效不超过 320ms（抽屉/toast/卡片展开档），且时长只能取令牌变量', () => {
  // 从 TOKENS.motion 的键生成，加 slow 档后自动跟随。上限读 AJA.MOTION_MAX_MS（=320）。
  // hover 类仍应走 base 180ms——320ms 用在 hover 上会显得迟钝，但那是评审问题不是守卫问题。
  const allowedVars = new Set(Object.keys(AJA.TOKENS.motion).map(k => `--aja-motion-${k}`));
  for (const { name, css } of ALL_CSS) {
    const rules = css.match(/(?:transition|animation)\s*:[^;}]+/g) || [];
    for (const rule of rules) {
      for (const m of rule.matchAll(/(\d*\.?\d+)(ms|s)\b/g)) {
        const ms = m[2] === 's' ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
        assert.ok(ms <= AJA.MOTION_MAX_MS, `${name} 的动效 ${m[0]} 超过上限 ${AJA.MOTION_MAX_MS}ms`);
      }
      for (const m of rule.matchAll(/var\((--[a-z-]+)\)/g)) {
        assert.ok(allowedVars.has(m[1]), `${name} 的动效引用了非令牌变量 ${m[1]}`);
      }
      // cubic-bezier 只能用令牌里那一档，不许再写 easeOutExpo 之类的"弹"曲线
      assert.ok(!/cubic-bezier\(/.test(rule), `${name} 的动效硬写了 cubic-bezier，应引用 --aja-motion-ease`);
    }
  }
});

check('hover/active 不得改变盒模型（旧版 hover 时 padding-left 从 10 变 14，按钮会"跳"）', () => {
  const banned = ['padding', 'margin', 'transform', 'width', 'height', 'top', 'left', 'right', 'bottom', 'font-size', 'gap', 'scale'];
  for (const { name, css } of ALL_CSS) {
    const rules = css.match(/[^{}]*(?::hover|:active)[^{}]*\{[^}]*\}/g) || [];
    for (const rule of rules) {
      const body = rule.slice(rule.indexOf('{') + 1, rule.lastIndexOf('}'));
      for (const prop of banned) {
        const re = new RegExp(`(^|[;\\s{])${prop}(-[a-z]+)?\\s*:`, 'i');
        assert.ok(!re.test(body), `${name} 的 :hover/:active 规则改变了 ${prop}：\n      ${rule.trim().slice(0, 120)}`);
      }
    }
  }
});

check('box-shadow 不得硬编码颜色（旧版有带品牌色的彩色阴影 rgba(64,83,203,.35)）', () => {
  for (const { name, css } of ALL_CSS) {
    const rules = css.match(/box-shadow\s*:\s*([^;}]+)/g) || [];
    for (const rule of rules) {
      const value = rule.slice(rule.indexOf(':') + 1);
      assert.ok(!/#[0-9a-fA-F]{3,8}/.test(value), `${name} 的 box-shadow 硬写了 hex 颜色：${value.trim()}`);
      assert.ok(!/rgba?\(/.test(value), `${name} 的 box-shadow 硬写了 rgb/rgba：${value.trim()}`);
    }
  }
  // Side Panel 是浏览器 UI 的一部分，靠 1px 边框分层就够，阴影只会让它像"贴上去的第三方浮层"
  assert.ok(!/box-shadow/.test(SRC.panelCss), 'panel.css 不该有 box-shadow');
});

check('CSS 里的硬编码色值只允许 #fff（强调色按钮上的白字）', () => {
  for (const { name, css } of ALL_CSS) {
    for (const h of (css.match(/#[0-9a-fA-F]{3,8}\b/g) || [])) {
      assert.ok(['#fff', '#ffffff'].includes(h.toLowerCase()), `${name} 里硬写了颜色 ${h}，应改为 var(--aja-*)`);
    }
    for (const m of (css.match(/rgba?\([^)]*\)/g) || [])) {
      assert.ok(false, `${name} 里硬写了 ${m}，应改为 var(--aja-*)`);
    }
  }
});

check('所有颜色/圆角/间距/字号都走 var(--aja-*)，令牌确实在被使用', () => {
  for (const { name, css } of ALL_CSS) {
    const used = (css.match(/var\(--aja-[a-z0-9-]+\)/g) || []);
    assert.ok(used.length > 10, `${name} 只用了 ${used.length} 处令牌，怀疑有写死的样式`);
    for (const u of used) {
      const varName = u.slice(4, -1);
      const declared = AJA.tokensToCssVars('light', ':root');
      assert.ok(declared.includes(`${varName}:`), `${name} 引用了未声明的令牌 ${varName}`);
    }
  }
});

check('被 hidden 切换且自身设了 display 的容器，必须有 [hidden]{display:none} 守卫', () => {
  // 作者层的 display 会覆盖 UA 的 [hidden]{display:none}，导致"收起了但仍占位并吞掉点击"。
  // 网页版踩过四次同类缺陷（见 test/web-check.js 的同款守卫），插件侧同样要钉住。
  const targets = [
    { name: 'panel.css 的 .p-sec-body', css: SRC.panelCss, cls: '.p-sec-body' },
    { name: 'panel.css 的 .p-toast', css: SRC.panelCss, cls: '.p-toast' },
    { name: 'panel.css 的 .p-pagestate', css: SRC.panelCss, cls: '.p-pagestate' },
    { name: 'panel.css 的 .p-badge', css: SRC.panelCss, cls: '.p-badge' },
    { name: 'panel.css 的 .p-res-body', css: SRC.panelCss, cls: '.p-res-body' },
    { name: 'capture-form css() 的 .capture-form', css: FORM_CSS, cls: '.capture-form' },
    { name: 'capture-form css() 的 .detect-hint', css: FORM_CSS, cls: '.detect-hint' },
    { name: '01-core 的 #aja-capture-pop', css: CORE_CSS, cls: '#aja-capture-pop' }
    // 注：胶囊 #aja-toggle 不在列表里——它常驻显示，从不用 hidden 切换。
    // 旧版展开全高抽屉时会隐藏胶囊，抽屉退役后那条 .hidden 规则已作为死代码删除。
  ];
  for (const t of targets) {
    const escaped = t.cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const setsDisplay = new RegExp(`${escaped}\\s*\\{[^}]*display\\s*:`, 'm').test(t.css)
      || new RegExp(`${escaped}\\s*,`).test(t.css);
    if (!setsDisplay) continue;
    const guard = new RegExp(`${escaped}\\[hidden\\]\\s*\\{\\s*display\\s*:\\s*none`);
    assert.ok(guard.test(t.css), `${t.name} 设了 display 却没有 [hidden]{display:none} 守卫`);
  }
});

// ============================================================================
section('B. 设计令牌（common/tokens.js）');

check('light 与 dark 的键集合完全一致（少一个键就会在某个主题下变透明）', () => {
  const l = Object.keys(AJA.TOKENS.light).sort();
  const d = Object.keys(AJA.TOKENS.dark).sort();
  assert.deepStrictEqual(l, d, `light/dark 键不一致：${l.join(',')} vs ${d.join(',')}`);
  // v5.2.0 起 accent/danger/warn/glass 移入两套主题，键数 9→17
  assert.ok(l.length >= 17, `调色板只有 ${l.length} 个键（v5.2.0 起应 17），可能漏了层次`);
});

check('每个色值都是合法 hex 或 rgba（写错一个字符整块 UI 就变透明）', () => {
  const hexOrRgba = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))$/;
  for (const scheme of ['light', 'dark']) {
    for (const [k, v] of Object.entries(AJA.TOKENS[scheme])) {
      if (k === 'shadow') { assert.ok(hexOrRgba.test(v), `${scheme}.${k} = ${v} 不是合法颜色`); continue; }
      assert.ok(hexOrRgba.test(v), `${scheme}.${k} = ${v} 不是合法颜色`);
    }
  }
  // v5.2.0 起 accent/danger/warn 已移入 light/dark 两套，上面的循环已覆盖全部色值，
  // 外层不再有这些键（旧版这里单独遍历 7 个单值，结构改动后会拿到 undefined 而误报）。
});

check('tokensToCssVars 两套主题都生成完整变量，且选择器可指定', () => {
  for (const scheme of ['light', 'dark']) {
    for (const sel of [':root', ':host']) {
      const out = AJA.tokensToCssVars(scheme, sel);
      assert.ok(out.startsWith(`${sel} {`), `${scheme}/${sel} 的开头不是 ${sel} {`);
      assert.ok(out.trim().endsWith('}'), `${scheme}/${sel} 未闭合`);
      for (const v of ['--aja-bg:', '--aja-text:', '--aja-border:', '--aja-accent:', '--aja-radius-md:',
        '--aja-space-3:', '--aja-font-sm:', '--aja-motion-fast:', '--aja-shadow:']) {
        assert.ok(out.includes(v), `${scheme}/${sel} 缺少 ${v}`);
      }
    }
  }
  // 深浅两套的实际色值必须不同，否则"跟随主题"是假的
  assert.ok(AJA.tokensToCssVars('light').includes(AJA.TOKENS.light.bg), 'light 未取到 light 调色板');
  assert.ok(AJA.tokensToCssVars('dark').includes(AJA.TOKENS.dark.bg), 'dark 未取到 dark 调色板');
});

check('插件 light accent 必须与网页版 --accent 一致，dark 必须用暗背景强调色（v5.2.0 两端已统一）', () => {
  // 这条守卫的目的从「防止统一」反转为「防止只改一端」：v5.2.0 之前两端品牌色分叉
  // （网页蓝紫 / 插件橙），统一之后若有人只改一端，分叉会悄悄回来。
  const webCss = fs.readFileSync(WEB, 'utf8');
  const m = /--accent:\s*(#[0-9a-fA-F]{3,8})/.exec(webCss);
  assert.ok(m, '网页版 index.html 里找不到 --accent');
  assert.strictEqual(AJA.TOKENS.light.accent.toLowerCase(), m[1].toLowerCase(),
    `插件 light accent(${AJA.TOKENS.light.accent}) 与网页版 --accent(${m[1]}) 不一致：`
    + '两端已统一 Apple 设计语言，改一端必须改另一端');
  // 暗背景强调色必须是 #2997ff：#0071e3 在 #1c1c1e 上对比度约 3.4:1，不达标。
  // 设计资源写得很明确：「Accent #2997ff，暗背景上的链接与高亮」。
  assert.strictEqual(AJA.TOKENS.dark.accent, '#2997ff',
    'dark accent 必须是 #2997ff；#0071e3 在暗底对比不足，不能直接复用 light 的值');
});

check('currentScheme 与 onSchemeChange 在无 matchMedia 环境下不抛错', () => {
  const bare = vm.createContext({ console });
  vm.runInContext(read('common/tokens.js'), bare, { filename: 'tokens-bare.js' });
  assert.strictEqual(bare.AJA.currentScheme(), 'light', '无 matchMedia 时应回落 light');
  const off = bare.AJA.onSchemeChange(() => { throw new Error('不该被调用'); });
  assert.strictEqual(typeof off, 'function', 'onSchemeChange 应返回取消订阅函数');
  off();
});

// ============================================================================
section('C. 图标（common/icons.js）');

check('13 个图标齐备，覆盖旧版 18 处 emoji 的全部语义', () => {
  const required = ['logo', 'file', 'plus', 'type', 'inbox', 'search', 'globe', 'check', 'close', 'warn', 'chevron', 'copy', 'refresh'];
  for (const k of required) {
    assert.ok(typeof AJA.ICON[k] === 'string' && AJA.ICON[k].length > 5, `缺少图标 ${k}`);
  }
  assert.strictEqual(Object.keys(AJA.ICON).length, required.length,
    `图标数量 ${Object.keys(AJA.ICON).length} 与约定 ${required.length} 不符（新增图标请同步本断言）`);
});

check('图标一律 currentColor，不许硬编码 fill/stroke 颜色（否则深色主题下看不见）', () => {
  for (const [name, body] of Object.entries(AJA.ICON)) {
    assert.ok(!/fill\s*=\s*"#/i.test(body), `${name} 硬编码了 fill 颜色`);
    assert.ok(!/stroke\s*=\s*"#/i.test(body), `${name} 硬编码了 stroke 颜色`);
    assert.ok(/^<(path|circle|rect|line|polyline|polygon|ellipse)\b/.test(body.trim()),
      `${name} 的内容不是 SVG 图元：${body.slice(0, 40)}`);
  }
  const out = AJA.svg('logo', 16);
  assert.ok(out.includes('stroke="currentColor"'), 'svg() 输出未使用 currentColor');
  assert.ok(out.includes('fill="none"'), 'svg() 输出未设 fill=none（会出现色块）');
  assert.ok(out.includes('viewBox="0 0 24 24"'), 'svg() 的 viewBox 不是 24x24');
  assert.ok(out.includes('aria-hidden="true"'), '装饰性图标应 aria-hidden，否则读屏器会念出来');
});

check('svg() 尺寸参数生效，未知图标名返回空串而不是抛错', () => {
  assert.ok(AJA.svg('check', 14).includes('width="14"'), '尺寸参数未生效');
  assert.ok(AJA.svg('check').includes('width="16"'), '默认尺寸应为 16');
  assert.strictEqual(AJA.svg('不存在的图标'), '', '未知图标名应返回空串');
  assert.strictEqual(AJA.svg(''), '', '空图标名应返回空串');
  assert.ok(AJA.svg('plus', 16, 'extra').includes('class="aja-ico extra"'), '附加 class 未生效');
});

check('源码里不再有任何 emoji 字面量当图标用（含 toast 文案）', () => {
  // 旧版连 toast 文案都带 emoji（"🎉 已推送…"、"♻️ 已更新…"、"📋 已复制…"），一并清除
  const all = [SRC.core, SRC.capture, SRC.panelJs, SRC.form, SRC.background].join('\n');
  assert.ok(!/showToast\([^)]*[\u{1F300}-\u{1FAFF}]/u.test(all), 'toast 文案里还有 emoji');
  assert.ok(!/toast\([^)]*[\u{1F300}-\u{1FAFF}]/u.test(all), 'toast 文案里还有 emoji');
});

// ============================================================================
section('D. manifest 契约');

check('manifest 版本与 AJA.VERSION 一致（两处不同步会让人以为没加载新代码）', () => {
  assert.strictEqual(SRC.manifest.version, AJA.VERSION,
    `manifest.version=${SRC.manifest.version} 与 constants.js 的 AJA.VERSION=${AJA.VERSION} 不一致`);
  // 这里刻意**不**硬编码期望版本号：具体版本由 web-check.js 的「插件版本号 10 处一致」守卫负责
  // （那条覆盖 manifest / AJA.VERSION / download.html 三处 / README 两处 / 使用说明 / extension README 两处）。
  // 在本文件再写死一次只会让每次升版多改一处、且两处容易不同步——本轮就自己踩了一次。
  assert.ok(/^\d+\.\d+\.\d+$/.test(SRC.manifest.version), `版本号格式异常：${SRC.manifest.version}`);
});

check('content_scripts 列出的文件全部存在，且旧文件已彻底移除', () => {
  const files = SRC.manifest.content_scripts[0].js;
  for (const f of files) {
    assert.ok(fs.existsSync(path.join(EXT, f)), `manifest 引用了不存在的文件 ${f}`);
  }
  for (const gone of ['content/02-resume.js', 'content/05-sidebar.js']) {
    assert.ok(!files.includes(gone), `${gone} 已删除却仍在 content_scripts 里，扩展会加载失败`);
    assert.ok(!fs.existsSync(path.join(EXT, gone)), `${gone} 应当已被删除`);
  }
});

check('注入顺序满足依赖（shared→constants→tokens→icons→capture-form→01-core→03-parsers→05-capture→06-bridge）', () => {
  const files = SRC.manifest.content_scripts[0].js;
  const idx = (f) => files.indexOf(f);
  const required = ['shared/stages.js', 'shared/company-types.js', 'common/constants.js', 'common/tokens.js',
    'common/icons.js', 'common/capture-form.js',
    'content/01-core.js', 'content/03-parsers.js', 'content/05-capture.js', 'content/06-bridge.js'];
  for (const f of required) assert.ok(idx(f) > -1, `content_scripts 缺少 ${f}`);
  // 🔴 shared 必须在 constants 之前：constants 里 AJA.STAGES = AJA.STAGE_PRESETS 是别名转发，
  // 顺序反了会转发到 undefined 且**不报错**，只表现为收录表单的阶段下拉空空如也。
  // 这条依赖是阶段 2 新增的，原来的断言只覆盖 constants 之后的相对顺序、守不住它。
  assert.ok(idx('shared/stages.js') < idx('common/constants.js'), 'shared/stages.js 必须在 constants.js 之前（别名转发依赖）');
  assert.ok(idx('shared/company-types.js') < idx('common/constants.js'), 'shared/company-types.js 必须在 constants.js 之前');
  // 01-core 顶层就调用 AJA.tokensToCssVars / AJA.svg / AJA.onSchemeChange，三者必须在它之前
  assert.ok(idx('common/constants.js') < idx('common/tokens.js'), 'constants 必须在 tokens 之前（AJA 命名空间）');
  assert.ok(idx('common/tokens.js') < idx('content/01-core.js'), 'tokens 必须在 01-core 之前');
  assert.ok(idx('common/icons.js') < idx('content/01-core.js'), 'icons 必须在 01-core 之前（胶囊 innerHTML 用 AJA.svg）');
  assert.ok(idx('common/icons.js') < idx('common/capture-form.js'), 'icons 必须在 capture-form 之前（表单模板用 AJA.svg）');
  assert.ok(idx('common/capture-form.js') < idx('content/01-core.js'), 'capture-form 必须在 01-core 之前（escapeHtml / css()）');
  assert.ok(idx('content/01-core.js') < idx('content/03-parsers.js'), '01-core 必须先建 Shadow Root');
  assert.ok(idx('content/03-parsers.js') < idx('content/05-capture.js'), '05-capture 调用 extractPageJobData');
  assert.ok(idx('content/05-capture.js') < idx('content/06-bridge.js'), '06-bridge 依赖 05-capture 的 safeSendMessage');
});

check('panel.html 的 script 顺序同样满足依赖，且引用的文件都存在', () => {
  const srcs = [...SRC.panelHtml.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  assert.ok(srcs.length >= 8, `panel.html 只引了 ${srcs.length} 个脚本（应为 shared 三件 + common 四件 + panel.js）`);
  for (const s of srcs) {
    const abs = path.join(EXT, 'panel', s);
    assert.ok(fs.existsSync(abs), `panel.html 引用了不存在的文件 ${s}`);
  }
  const idx = (n) => srcs.findIndex(s => s.includes(n));
  // 🔴 shared 必须在 constants 之前：constants 里 AJA.STAGES = AJA.STAGE_PRESETS 是别名转发
  assert.ok(idx('shared/stages.js') > -1, 'panel.html 缺少 shared/stages.js');
  assert.ok(idx('shared/company-types.js') > -1, 'panel.html 缺少 shared/company-types.js');
  assert.ok(idx('shared/stages.js') < idx('constants.js'), 'shared/stages.js 必须在 constants.js 之前');
  assert.ok(idx('shared/company-types.js') < idx('constants.js'), 'shared/company-types.js 必须在 constants.js 之前');
  assert.ok(idx('constants.js') < idx('tokens.js'), 'constants 必须在 tokens 之前');
  assert.ok(idx('tokens.js') < idx('panel.js'), 'tokens 必须在 panel.js 之前');
  assert.ok(idx('icons.js') < idx('capture-form.js'), 'icons 必须在 capture-form 之前');
  assert.ok(idx('capture-form.js') < idx('panel.js'), 'capture-form 必须在 panel.js 之前');
  assert.strictEqual(srcs[srcs.length - 1], 'panel.js', 'panel.js 必须最后加载');
  // panel 用 AJA.DEFAULT_RESUME 兜底，阶段 2 起它在 shared/ 下
  assert.ok(idx('shared/default-resume.js') > -1, 'panel.html 缺少 shared/default-resume.js（简历兜底会 undefined）');
  // 被 shared 取代的两个 common 文件已删除，不该再被引用（引了就是 404 → CSP 报错）
  for (const gone of ['common/default-resume', 'common/company-key']) {
    assert.ok(!srcs.some(s => s.includes(gone)), `${gone}.js 已删除，panel.html 不该再引用`);
  }
  // 面板不需要 company-key（公司归一化只在 background 的暂存箱去重里用）
  assert.ok(!srcs.some(s => s.includes('company-key')), 'panel.html 不该加载 company-key.js（面板用不到，白增体积）');
  // CSP 是 script-src 'self'，内联脚本会被拦
  assert.ok(!/<script>(?!<\/script>)/.test(SRC.panelHtml), 'panel.html 里有内联脚本，会被 extension_pages 的 CSP 拦掉');
});

check('Side Panel 已声明，且 openPanelOnActionClick 与 action.onClicked 没有并存', () => {
  assert.ok(SRC.manifest.permissions.includes('sidePanel'), 'permissions 缺少 sidePanel');
  assert.ok(SRC.manifest.side_panel && SRC.manifest.side_panel.default_path, 'manifest 缺少 side_panel 配置');
  assert.ok(fs.existsSync(path.join(EXT, SRC.manifest.side_panel.default_path)), 'side_panel.default_path 指向的文件不存在');
  assert.strictEqual(SRC.manifest.side_panel.default_path, 'panel/panel.html');
  // 两者互斥：设了 openPanelOnActionClick 后 onClicked 永不触发，留着就是死代码
  assert.ok(/setPanelBehavior\(\s*\{\s*openPanelOnActionClick:\s*true\s*\}\s*\)/.test(SRC.background),
    'background.js 未设置 openPanelOnActionClick，点工具栏图标不会打开面板');
  assert.ok(!/chrome\.action\.onClicked\.addListener/.test(SRC.background),
    'background.js 仍有 chrome.action.onClicked 监听：与 openPanelOnActionClick 互斥，那是永不执行的死代码');
});

check('sidePanel 调用点都有特性检测（Chrome/Edge 114 以下没有该 API）', () => {
  assert.ok(/if\s*\(chrome\.sidePanel\s*&&\s*chrome\.sidePanel\.setPanelBehavior\)/.test(SRC.background),
    'setPanelBehavior 缺少特性检测');
  assert.ok(/if\s*\(!chrome\.sidePanel\s*\|\|\s*!chrome\.sidePanel\.open\)\s*return/.test(SRC.background),
    'sidePanel.open 缺少特性检测');
  // 不支持 Side Panel 时胶囊仍要能用：迷你卡片不得依赖 sidePanel
  assert.ok(!/sidePanel/.test(SRC.core), '01-core.js 不该依赖 sidePanel（低版本浏览器上胶囊会失效）');
  assert.ok(!/sidePanel/.test(SRC.capture), '05-capture.js 不该依赖 sidePanel');
});

// ============================================================================
section('E. 消息协议契约（三端字面量必须能对上，拼错就是静默失败）');

check('各端使用的 MSG.XXX 都在 constants.js 里定义过', () => {
  const defined = new Set(Object.keys(AJA.MSG));
  const users = {
    'content/01-core.js': SRC.core,
    'content/05-capture.js': SRC.capture,
    'content/06-bridge.js': SRC.bridge,
    'background.js': SRC.background,
    'panel/panel.js': SRC.panelJs
  };
  for (const [name, src] of Object.entries(users)) {
    for (const m of src.matchAll(/\bMSG\.([A-Z_][A-Z0-9_]*)/g)) {
      assert.ok(defined.has(m[1]), `${name} 使用了未定义的 MSG.${m[1]}`);
    }
  }
  // MSG 的值必须与键同名，否则跨端字面量对不上
  for (const [k, v] of Object.entries(AJA.MSG)) {
    assert.strictEqual(k, v, `MSG.${k} 的值是 "${v}"，与键名不一致`);
  }
});

check('TOGGLE_SIDEBAR 已彻底退役（图标走 openPanelOnActionClick，快捷键走 sidePanel.open）', () => {
  assert.ok(!('TOGGLE_SIDEBAR' in AJA.MSG), 'MSG.TOGGLE_SIDEBAR 仍在 constants.js 里');
  for (const [name, src] of Object.entries({ '01-core.js': SRC.core, 'background.js': SRC.background, 'panel.js': SRC.panelJs })) {
    // 注释里提一句历史是可以的，代码里引用就会静默失败
    const codeLines = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l));
    assert.ok(!codeLines.some(l => l.includes('TOGGLE_SIDEBAR')), `${name} 的代码里仍引用 TOGGLE_SIDEBAR`);
  }
});

check('SCAN_CURRENT_PAGE / FILL_FOCUSED_FIELD 三端齐全（panel 发起、background 中转、content 处理）', () => {
  for (const type of ['SCAN_CURRENT_PAGE', 'FILL_FOCUSED_FIELD']) {
    assert.ok(SRC.panelJs.includes(`MSG.${type}`), `panel.js 没有发起 ${type}`);
    assert.ok(SRC.background.includes(`MSG.${type}`), `background.js 没有中转 ${type}`);
    assert.ok(SRC.core.includes(`MSG.${type}`), `01-core.js 没有处理 ${type}`);
  }
  // background 必须走 tabs.sendMessage 才能到 content script（runtime.sendMessage 到不了页面）
  assert.ok(/chrome\.tabs\.sendMessage\(tabId,\s*request\)/.test(SRC.background),
    'background 的中转没有用 chrome.tabs.sendMessage');
  // 失败必须收敛成 reason，否则面板只能显示"操作失败"
  for (const reason of ['no-tab', 'no-content-script']) {
    assert.ok(SRC.background.includes(`'${reason}'`), `background 缺少 ${reason} 的收敛`);
    assert.ok(SRC.panelJs.includes(`'${reason}'`), `panel.js 的 reasonText 没有翻译 ${reason}`);
  }
});

check('面板保存记录用的是目标页 URL，不是面板自己的 location', () => {
  // chrome-extension:// 的地址存进记录就是废数据，这是 Side Panel 形态最容易踩的坑
  assert.ok(/capturedPageUrl/.test(SRC.panelJs), 'panel.js 缺少 capturedPageUrl');
  assert.ok(/res\.url\s*\|\|\s*currentTabUrl/.test(SRC.panelJs), 'panel.js 未从 SCAN_CURRENT_PAGE 的返回取 url');
  assert.ok(/collect\(formEls,\s*capturedPageUrl\s*\|\|\s*currentTabUrl\)/.test(SRC.panelJs),
    '保存时没有把目标页 URL 传给 collect()');
  assert.ok(/location\.href/.test(SRC.core) && /res\.url|location\.href/.test(SRC.core),
    'content 侧应在 SCAN_CURRENT_PAGE 的返回里带上 location.href');
  // 面板里绝不能用 location.href 当投递链接
  const panelSave = SRC.panelJs.slice(SRC.panelJs.indexOf('function saveCapture'));
  assert.ok(!/collect\([^)]*location\.href/.test(panelSave), 'panel.js 用了 location.href 当投递链接');
});

// ============================================================================
section('F. 收录表单模板契约（迷你卡片与 Side Panel 共用一份）');

check('html() 输出的 id 与 els() 取用的 id 完全一致', () => {
  const html = AJA.CaptureForm.html();
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const scope = { querySelector: (sel) => (ids.has(sel.slice(1)) ? { id: sel.slice(1) } : null) };
  const got = AJA.CaptureForm.els(scope);
  for (const [key, el] of Object.entries(got)) {
    assert.ok(el, `els() 取的 ${key} 在 html() 里不存在`);
  }
  // 反向：html() 里的每个 id 都应被 els() 取到（多出来的说明模板与取值脱节）
  const taken = new Set(Object.values(got).map(e => e.id));
  for (const id of ids) {
    assert.ok(taken.has(id), `html() 里的 #${id} 没有被 els() 取用`);
  }
});

check('下拉选项由常量生成：阶段 14 档、企业性质 3 档 + 未设置', () => {
  const stageSel = { innerHTML: '' };
  const typeSel = { innerHTML: '' };
  AJA.CaptureForm.fillOptions(stageSel, typeSel);
  assert.strictEqual((stageSel.innerHTML.match(/<option/g) || []).length, AJA.STAGES.length, '阶段选项数与 AJA.STAGES 不符');
  assert.strictEqual((typeSel.innerHTML.match(/<option/g) || []).length, AJA.COMPANY_TYPES.length + 1, '企业性质应为 3 档 + 未设置');
  assert.ok(typeSel.innerHTML.startsWith('<option value="">'), '企业性质首项必须是 value="" 的未设置');
  for (const s of AJA.STAGES) assert.ok(stageSel.innerHTML.includes(`value="${s}"`), `阶段下拉缺少 ${s}`);
  // 传 null 不该抛错（两端初始化时序不同）
  AJA.CaptureForm.fillOptions(null, null);
});

check('collect() 的字段与 background 暂存的字段对得上（少一个就静默丢数据）', () => {
  const e = {
    company: { value: ' 腾讯 ' }, position: { value: '后端' }, city: { value: '深圳' },
    stage: { value: '已投递' }, date: { value: '2026-09-08' }, companyType: { value: '私企' }
  };
  const rec = AJA.CaptureForm.collect(e, 'https://careers.tencent.com/job/1');
  assert.strictEqual(rec.company, '腾讯', '公司名应 trim');
  assert.strictEqual(rec.applicationUrl, 'https://careers.tencent.com/job/1');
  for (const k of ['company', 'position', 'city', 'stage', 'companyType', 'applicationDate',
    'applicationUrl', 'recentSchedule', 'nextAction']) {
    assert.ok(Object.prototype.hasOwnProperty.call(rec, k), `collect() 缺少字段 ${k}`);
    assert.ok(SRC.background.includes(k), `background.js 的 staged 没有接住 ${k}`);
  }
  // 空表单要有兜底，否则会存进空公司名
  const empty = AJA.CaptureForm.collect({}, '');
  assert.strictEqual(empty.company, '待确认公司');
  assert.strictEqual(empty.position, '待确认岗位');
  assert.strictEqual(empty.stage, '已投递');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(empty.applicationDate), '日期兜底应为今天');
});

check('fillFromPending() 必须带回 companyType（漏了会把已选的企业性质冲成未设置）', () => {
  const e = { company: { value: '' }, position: { value: '' }, city: { value: '' }, stage: { value: '' }, date: { value: '' }, companyType: { value: '' } };
  AJA.CaptureForm.fillFromPending(e, {
    company: '字节跳动', position: '前端（北京）', city: '北京', stage: '一面',
    applicationDate: '2026-09-01', companyType: '私企'
  });
  assert.strictEqual(e.companyType.value, '私企');
  assert.strictEqual(e.stage.value, '一面');
  assert.strictEqual(e.position.value, '前端（北京）', '岗位名的括号修饰不能被丢（同公司多岗位靠它区分）');
  // 缺字段时不抛错，stage 回落已投递
  const e2 = { company: { value: '' }, position: { value: '' }, city: { value: '' }, stage: { value: '' }, date: { value: '' }, companyType: { value: '' } };
  AJA.CaptureForm.fillFromPending(e2, { company: 'X' });
  assert.strictEqual(e2.stage.value, '已投递');
  assert.strictEqual(e2.companyType.value, '');
  AJA.CaptureForm.fillFromPending(e2, null);
});

check('两端渲染用的 class 都在各自的 CSS 里有定义（防「渲染出来了但没样式」）', () => {
  // 这类漂移刚在 capture-form 上出现过一次（模板用了 .aja-ico，css() 里却没有），
  // 表现是元素渲染出来但完全没有样式，人工复核时容易以为是"设计就这样"
  const fromJs = (src, prefix) => {
    const set = new Set();
    for (const m of src.matchAll(/class="([a-zA-Z0-9\- ]+)"/g)) {
      for (const c of m[1].split(/\s+/)) if (c.startsWith(prefix)) set.add(c);
    }
    // classList.toggle/add 里的状态类同样是渲染契约
    for (const m of src.matchAll(/classList\.(?:toggle|add|remove)\('([a-zA-Z0-9\-]+)'/g)) {
      if (m[1].startsWith(prefix)) set.add(m[1]);
    }
    return [...set];
  };
  const panelClasses = fromJs(SRC.panelJs, 'p-');
  assert.ok(panelClasses.length >= 10, `只从 panel.js 提取到 ${panelClasses.length} 个 p- 类，正则可能失效`);
  for (const c of panelClasses) {
    assert.ok(SRC.panelCss.includes(`.${c}`), `panel.js 渲染用了 .${c}，但 panel.css 里没有定义`);
  }
  const popClasses = fromJs(SRC.capture, 'pop-');
  assert.ok(popClasses.length >= 3, `只从 05-capture.js 提取到 ${popClasses.length} 个 pop- 类`);
  for (const c of popClasses) {
    assert.ok(CORE_CSS.includes(`.${c}`), `05-capture.js 渲染用了 .${c}，但 01-core.js 的 COMPONENT_CSS 里没有定义`);
  }
  // 状态类同样要有样式，否则"告警态""折叠态"只是改了个看不见的 class
  for (const c of ['is-warn', 'is-empty', 'is-collapsed']) {
    assert.ok(SRC.panelCss.includes(`.${c}`), `panel.css 缺少状态类 .${c} 的样式`);
  }
  for (const c of ['is-left', 'is-right', 'is-dragging']) {
    assert.ok(CORE_CSS.includes(`.${c}`), `COMPONENT_CSS 缺少胶囊状态类 .${c} 的样式`);
  }
});

check('css() 与 html() 同源：模板里用到的 class 在 css() 里都有定义', () => {
  const html = AJA.CaptureForm.html();
  const classes = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)));
  const css = AJA.CaptureForm.css();
  for (const c of classes) {
    assert.ok(css.includes(`.${c}`), `模板用了 .${c} 但 css() 里没有定义，样式会漏`);
  }
  // 反向抽查关键组件，避免 css() 被清空后上一条断言因为 classes 为空而空过
  for (const c of ['capture-form', 'title-hint', 'detect-hint', 'form-group', 'form-row', 'form-actions',
    'btn-save-record', 'btn-cancel-capture']) {
    assert.ok(classes.has(c), `模板缺少 .${c}`);
    assert.ok(css.includes(`.${c}`), `css() 缺少 .${c}`);
  }
  assert.ok(css.includes('user-select: text'), 'css() 丢了输入框可选中修复（会重现"配置存了就改不了"）');
});

check('renderDetectHint 的两种文案都渲染，且缺失字段被点名', () => {
  const el = { className: '', innerHTML: '', hidden: true };
  AJA.CaptureForm.renderDetectHint(el, { company: '腾讯', position: '', city: '', _sources: { company: 'jsonld' } });
  assert.strictEqual(el.className, 'detect-hint warn', '有字段缺失时应是 warn 态');
  assert.ok(el.innerHTML.includes('投递岗位') && el.innerHTML.includes('目标城市'), '未点名缺失的字段');
  assert.ok(el.innerHTML.includes('结构化数据'), '_sources 应翻成中文来源标签');
  assert.strictEqual(el.hidden, false);
  AJA.CaptureForm.renderDetectHint(el, { company: '腾讯', position: '后端', city: '深圳' });
  assert.strictEqual(el.className, 'detect-hint');
  assert.ok(el.innerHTML.includes('企业性质'), '识别全中时也要提醒手动选企业性质');
  // detectSourceLabel 的 ATS 前缀
  assert.strictEqual(AJA.CaptureForm.detectSourceLabel('ats:moka'), 'moka 解析器');
  assert.strictEqual(AJA.CaptureForm.detectSourceLabel(''), '');
});

check('save() 的三条分支：推送成功 / 管理器未打开回落暂存箱 / 通信异常回落暂存箱', async () => {
  const calls = [];
  const run = (responder) => new Promise((resolve) => {
    const toasts = [];
    AJA.CaptureForm.save({ company: 'A', position: 'B' }, {
      send: (msg, onResult, onError) => { calls.push(msg.type); responder(msg, onResult, onError); },
      toast: (t) => toasts.push(t),
      onDone: (saved, where) => resolve({ saved, where, toasts })
    });
  });
  calls.length = 0;
  let r = await run((msg, onResult) => onResult(msg.type === 'PUSH_TO_TRACKER' ? { ok: true } : { ok: true, total: 1 }));
  assert.strictEqual(r.where, 'tracker', '推送成功应走 tracker');
  assert.deepStrictEqual(calls, ['PUSH_TO_TRACKER'], '推送成功就不该再写暂存箱');

  calls.length = 0;
  r = await run((msg, onResult) => onResult(msg.type === 'PUSH_TO_TRACKER' ? { ok: false, reason: 'tracker-not-open' } : { ok: true, total: 2 }));
  assert.strictEqual(r.where, 'pending');
  assert.deepStrictEqual(calls, ['PUSH_TO_TRACKER', 'SAVE_JOB_RECORD'], '管理器未打开应回落暂存箱');

  calls.length = 0;
  r = await run((msg, onResult, onError) => {
    if (msg.type === 'PUSH_TO_TRACKER') onError('Extension context invalidated');
    else onResult({ ok: true, total: 3 });
  });
  assert.strictEqual(r.where, 'pending');
  assert.deepStrictEqual(calls, ['PUSH_TO_TRACKER', 'SAVE_JOB_RECORD'], '通信异常也应回落暂存箱，不能丢数据');
});

// ============================================================================
section('G. 胶囊拖拽与迷你卡片定位的纯数学（从 01-core.js 原文提取，不复制实现）');

function extractDragMath(src) {
  const marker = 'AJA.dragMath = {';
  const start = src.indexOf(marker);
  assert.ok(start > -1, '01-core.js 里找不到 AJA.dragMath');
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) break; }
  }
  assert.ok(depth === 0, 'AJA.dragMath 的对象字面量没有配平');
  const objText = src.slice(src.indexOf('{', start), i + 1);
  // 只提取对象字面量求值，不执行整个 01-core.js（它顶层就要建 Shadow Root）
  return vm.runInNewContext(`(${objText})`, {}, { filename: 'drag-math.js' });
}
const drag = extractDragMath(SRC.core);

check('pickSide：按中心点吸到更近的一侧', () => {
  assert.strictEqual(drag.pickSide(100, 1200), 'left');
  assert.strictEqual(drag.pickSide(1100, 1200), 'right');
  assert.strictEqual(drag.pickSide(600, 1200), 'left', '正好居中时吸左，避免抖动');
  assert.strictEqual(drag.pickSide(0, 1200), 'left');
  assert.strictEqual(drag.pickSide(1200, 1200), 'right');
  assert.strictEqual(drag.pickSide(NaN, 1200), 'left', '非法输入不该抛错');
  assert.strictEqual(drag.pickSide(100, 0), 'right', '视口宽度为 0 时回落 right（默认方位）');
});

check('clampTop：上下留边距，视口比按钮还矮时不给负区间', () => {
  assert.strictEqual(drag.clampTop(300, 800, 32, 8), 300, '区间内应原样返回');
  assert.strictEqual(drag.clampTop(-50, 800, 32, 8), 8, '低于上边界应贴到 8');
  assert.strictEqual(drag.clampTop(900, 800, 32, 8), 760, '超出下边界应贴到 视口-按钮-边距');
  assert.strictEqual(drag.clampTop(100, 20, 32, 8), 8, '视口比按钮矮时不产生负区间');
  assert.strictEqual(drag.clampTop(NaN, 800, 32, 8), 8, '非法 top 回落到边距');
  assert.strictEqual(drag.clampTop(100, 800, 0, 8), 100, '按钮高度为 0 时用默认高度兜底');
});

check('placePop：卡片放在胶囊内侧，溢出视口时贴边而不是跑到屏幕外', () => {
  const opts = { viewportW: 1200, viewportH: 800, gap: 8, margin: 8 };
  // 胶囊吸右：卡片应在胶囊左侧
  let p = drag.placePop({ left: 1100, right: 1200, top: 200, width: 100, height: 32 }, 300, 400, Object.assign({ side: 'right' }, opts));
  assert.strictEqual(p.left, 1100 - 8 - 300, '胶囊在右时卡片应放其左侧');
  assert.strictEqual(p.top, 200);
  // 胶囊吸左：卡片应在胶囊右侧
  p = drag.placePop({ left: 0, right: 100, top: 200, width: 100, height: 32 }, 300, 400, Object.assign({ side: 'left' }, opts));
  assert.strictEqual(p.left, 108, '胶囊在左时卡片应放其右侧');
  // 垂直溢出：卡片高于剩余空间时应上移贴底
  p = drag.placePop({ left: 0, right: 100, top: 700, width: 100, height: 32 }, 300, 400, Object.assign({ side: 'left' }, opts));
  assert.strictEqual(p.top, 800 - 400 - 8, '底部放不下时应上移贴底');
  // 窄窗口：卡片宽于视口时贴左边距，绝不允许负值（负值意味着卡片跑到屏幕外找不回来）
  p = drag.placePop({ left: 0, right: 60, top: 10, width: 60, height: 32 }, 300, 200, Object.assign({ side: 'left' }, { viewportW: 280, viewportH: 400, gap: 8, margin: 8 }));
  assert.ok(p.left >= 8, `窄窗口下 left=${p.left} 小于边距，卡片会被挤出视口`);
  // 胶囊贴右且窗口窄：不允许算出负 left
  p = drag.placePop({ left: 250, right: 280, top: 10, width: 30, height: 32 }, 300, 200, Object.assign({ side: 'right' }, { viewportW: 280, viewportH: 400, gap: 8, margin: 8 }));
  assert.ok(p.left >= 8, `胶囊贴右的窄窗口下 left=${p.left} 越界`);
  // 缺参数不抛错
  p = drag.placePop(null, 0, 0, {});
  assert.ok(Number.isFinite(p.left) && Number.isFinite(p.top), '缺参数时应给出有限数值');
});

check('胶囊位置持久化：读写的 storage key 与字段与 constants 一致', () => {
  assert.strictEqual(AJA.UI_STORAGE_KEY, 'autumnRecruitmentTracker.ui.v1');
  assert.ok(SRC.core.includes('AJA.UI_STORAGE_KEY'), '01-core.js 没有用 UI_STORAGE_KEY（位置不会持久化）');
  assert.ok(/chrome\.storage\.local\.set\(\{\s*\[UI_KEY\]:\s*\{\s*side:\s*togglePos\.side,\s*top:/.test(SRC.core),
    '位置没有按 {side, top} 结构写入 storage');
  assert.ok(/saved\.side === 'left' \|\| saved\.side === 'right'/.test(SRC.core), '读回时没有校验 side 的合法值');
  assert.ok(/addEventListener\('resize'/.test(SRC.core), '缺少 resize 后重新 clamp（窗口变小胶囊会跑到视口外）');
  assert.ok(/setPointerCapture/.test(SRC.core), '拖拽没有用 pointer capture，鼠标移出胶囊就会丢事件');
  assert.ok(/touch-action: none/.test(CORE_CSS), '胶囊缺 touch-action:none，触摸设备上拖动会同时滚动页面');
});

check('迷你卡片有关闭路径：Esc、点外部、关闭按钮、取消按钮', () => {
  assert.ok(/e\.key !== 'Escape'/.test(SRC.core) || /'Escape'/.test(SRC.core), '缺少 Esc 关闭');
  assert.ok(/composedPath\(\)/.test(SRC.core), '点外部关闭必须用 composedPath（Shadow DOM 下 e.target 会被重定向）');
  assert.ok(SRC.capture.includes('aja-pop-close') && SRC.capture.includes('closePop'), '缺少关闭按钮');
  assert.ok(SRC.capture.includes('cancelBtn'), '缺少取消按钮');
  assert.ok(/#aja-capture-pop\[hidden\]\s*\{\s*display:\s*none/.test(CORE_CSS), '卡片缺 [hidden] 守卫');
});

check('胶囊键盘可达（HTML 拖拽与点击对键盘用户不可用）', () => {
  assert.ok(/setAttribute\('tabindex', '0'\)/.test(SRC.core), '胶囊缺 tabindex，键盘聚焦不到');
  assert.ok(/setAttribute\('role', 'button'\)/.test(SRC.core), '胶囊是 div，缺 role=button 读屏器不会当按钮念');
  assert.ok(/e\.key === 'Enter' \|\| e\.key === ' '/.test(SRC.core), '缺 Enter/Space 触发');
});

check('迷你卡片每次打开都重新解析（否则会把 A 公司的岗位存成 B 公司的链接）', () => {
  assert.ok(/AJA\.onCaptureOpen = \(\) => rescan\(\)/.test(SRC.capture), '打开卡片时没有重新解析');
  assert.ok(/AJA\.onCaptureOpen\(\)/.test(SRC.core) || /AJA\.onCaptureOpen/.test(SRC.core), 'core 侧没有调用 onCaptureOpen');
  assert.ok(/extractPageJobData\(\)/.test(SRC.capture), '解析入口没有复用 03-parsers.js');
});

// ============================================================================
section('H. Side Panel 运行时契约');

check('panel 的状态条三态判定正确（切页后必须更新，否则会串页存错链接）', () => {
  vm.runInContext(SRC.panelJs, sandbox, { filename: 'panel/panel.js' });
  const P = sandbox.AJAPanel;
  assert.ok(P, 'panel.js 未挂出 AJAPanel（纯函数无法单测）');
  assert.strictEqual(P.classifyPage('https://careers.tencent.com/jobdetail.html?x=1'), 'ok');
  assert.strictEqual(P.classifyPage('http://campus.jd.com/'), 'ok');
  assert.strictEqual(P.classifyPage(`${AJA.TRACKER_URL}#/records`), 'tracker', '网页版管理器应识别为 tracker');
  assert.strictEqual(P.classifyPage('edge://extensions/'), 'unsupported');
  assert.strictEqual(P.classifyPage('chrome-extension://abc/panel.html'), 'unsupported');
  assert.strictEqual(P.classifyPage(''), 'unsupported');
  assert.strictEqual(P.classifyPage('https://bad url'), 'unsupported', '畸形 URL 不该抛错');
  // 三态的可操作性
  assert.strictEqual(P.pageState('ok', 'https://a.com/').canCapture, true);
  assert.strictEqual(P.pageState('tracker', AJA.TRACKER_URL).canCapture, false);
  assert.strictEqual(P.pageState('unsupported', 'edge://x/').canCapture, false);
  // 内部页不要念 hostname（edge://extensions 的 hostname 是 "extensions"，对用户是噪音）
  assert.ok(!P.pageState('unsupported', 'edge://extensions/').html.includes('extensions'),
    '内部页文案里不该出现 hostname');
});

check('panel 的错误翻译覆盖 background 的每种 reason（否则用户只看到"操作失败"）', () => {
  const P = sandbox.AJAPanel;
  const reasons = ['no-content-script', 'no-tab', 'no-response', 'parser-unavailable', 'parse-error'];
  for (const r of reasons) {
    const text = P.reasonText({ reason: r, message: 'boom' });
    assert.ok(text && text !== '操作失败，请刷新页面后重试', `${r} 没有被翻译成具体提示`);
    assert.ok(!text.includes(r), `${r} 的提示里不该出现内部 reason 字面量`);
  }
  assert.ok(P.reasonText(null).length > 0, '空响应也要有兜底文案');
  assert.ok(P.reasonText({ reason: 'parse-error', message: 'X' }).includes('X'), 'parse-error 应带上原始错误信息');
});

check('简历字段渲染：折叠策略、空值跳过、注入转义', () => {
  const P = sandbox.AJAPanel;
  // 数据结构对齐 common/default-resume.js：对象段（优先信息）没有下划线键，
  // 数组段（教育经历）的 item 用 _rowName 作段名元数据
  const html = P.renderResumeHtml({
    '优先信息': { '姓名': '张三', '手机': '138', '邮箱': '' },
    '教育经历': [{ _rowName: '教育经历 1', '学校': '某大学', '学院': '' }]
  });
  assert.strictEqual((html.match(/p-res-sec/g) || []).length, 2, '应渲染两段');
  assert.ok(html.includes('is-collapsed'), '非「优先信息」的段应默认折叠');
  assert.ok(!html.includes('邮箱'), '对象段的空值字段不该渲染成 chip');
  assert.ok(!html.includes('学院'), '数组段的空值字段也不该渲染');
  assert.ok(!html.includes('>_rowName<'), '_rowName 是段名元数据，不该被当成字段渲染成 chip');
  assert.ok(html.includes('教育经历 1'), '数组段的 _rowName 应作为段内标题');
  assert.strictEqual(P.renderResumeHtml(null), '', '空简历返回空串');
  assert.ok(P.renderResumeHtml({ a: {} }).includes('p-empty'), '全空简历应给空态引导');
  const evil = P.renderResumeHtml({ a: { k: '"><script>alert(1)</script>' } });
  assert.ok(!evil.includes('<script>'), '简历内容未转义，存在注入面');
  assert.ok(evil.includes('&quot;&gt;&lt;script&gt;'), '尖括号与引号都应被转义');
});

check('已填字段计数与 chip 渲染口径一致（两段规则刻意不对称）', () => {
  const P = sandbox.AJAPanel;
  // 对象段：真实结构里没有下划线键，直接统计非空值
  assert.strictEqual(P.countResumeFilledFields({ '优先信息': { '手机': '138', '邮箱': '', '微信': null } }), 1);
  // 数组段：_rowName 是段名元数据，必须跳过
  assert.strictEqual(P.countResumeFilledFields({ '教育经历': [{ _rowName: '教育经历 1', '学校': '某大学', '学院': '' }] }), 1);
  assert.strictEqual(P.countResumeFilledFields({ '教育经历': [{ _rowName: 'n' }, { '学校': 'X' }] }), 1, '只有段名的 item 不计数');
  assert.strictEqual(P.countResumeFilledFields(null), 0);
  assert.strictEqual(P.countResumeFilledFields({}), 0);
  assert.strictEqual(P.countResumeFilledFields(AJA.DEFAULT_RESUME), 0, '默认简历不预置个人信息');
  // 计数与渲染必须同源，否则会出现「徽标说填了 2 项、展开只有 1 个 chip」这种对不上的现象
  const resume = { '优先信息': { '姓名': '张三', '手机': '' }, '教育经历': [{ _rowName: 'n', '学校': 'X', '学院': '' }] };
  const chips = (P.renderResumeHtml(resume).match(/class="p-chip"/g) || []).length;
  assert.strictEqual(chips, 2, '应渲染 2 个 chip（姓名 + 学校）');
  assert.strictEqual(chips, P.countResumeFilledFields(resume), '渲染出的 chip 数与徽标计数不一致');
});

check('panel 与 content 两侧都不重复实现表单（一律走 common/capture-form.js）', () => {
  for (const [name, src] of Object.entries({ 'panel.js': SRC.panelJs, '05-capture.js': SRC.capture })) {
    assert.ok(src.includes('AJA.CaptureForm.html()'), `${name} 没有复用 CaptureForm.html()`);
    assert.ok(src.includes('AJA.CaptureForm.els('), `${name} 没有复用 CaptureForm.els()`);
    assert.ok(src.includes('AJA.CaptureForm.collect('), `${name} 没有复用 CaptureForm.collect()`);
    assert.ok(src.includes('AJA.CaptureForm.save('), `${name} 没有复用 CaptureForm.save()`);
    // 两端都不该自己写死字段 id 去 getElementById
    assert.ok(!/getElementById\('cap-/.test(src), `${name} 绕过 CaptureForm.els 自己取字段元素，两端会漂移`);
  }
  // 填入逻辑只有 content 侧一份（panel 经消息调用），不许两处各写一遍
  assert.ok(/function fillFocusedField/.test(SRC.core), '01-core.js 缺少 fillFocusedField');
  assert.ok(!/fillFocusedField/.test(SRC.panelJs.replace(/FILL_FOCUSED_FIELD/g, '')), 'panel.js 不该自己实现填入');
});

check('填入逻辑的三处踩坑成果仍在（原生 setter / input+change / 光标定位）', () => {
  assert.ok(/Object\.getOwnPropertyDescriptor\(proto, 'value'\)/.test(SRC.core),
    '丢了原生 value setter：React/Vue 受控组件会把填进去的值覆盖回去');
  assert.ok(/dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/.test(SRC.core), '丢了 input 事件派发');
  assert.ok(/dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/.test(SRC.core), '丢了 change 事件派发');
  assert.ok(/setSelectionRange\(nextCursorPos, nextCursorPos\)/.test(SRC.core), '丢了光标定位');
  assert.ok(/isContentEditable/.test(SRC.core), '丢了 contentEditable 分支（富文本编辑器填不进去）');
  assert.ok(/return 'filled'|return 'copied'/.test(SRC.core), 'fillFocusedField 应返回结果码供面板提示');
});

check('面板与迷你卡片通过 storage.onChanged 同步（不需要额外广播消息）', () => {
  assert.ok(/chrome\.storage\.onChanged\.addListener/.test(SRC.panelJs), 'panel.js 没有监听 storage 变化');
  assert.ok(/changes\[AJA\.RESUME_STORAGE_KEY\]/.test(SRC.panelJs), '简历更新不会刷新面板');
  assert.ok(/changes\[AJA\.PENDING_KEY\]/.test(SRC.panelJs), '迷你卡片存的暂存不会刷新面板');
  assert.ok(/chrome\.tabs\.onActivated/.test(SRC.panelJs), '切标签页不会刷新当前页状态');
});

// ============================================================================
section('I. 跨端单一事实源（shared/ 与 extension/shared/ 生成拷贝）');

check('同源守卫：extension/shared/*.js 与仓库根 shared/*.js 逐字节相同', () => {
  for (const f of SHARED_FILES) {
    const srcPath = path.join(ROOT, 'shared', f);
    const dstPath = path.join(EXT, 'shared', f);
    assert.ok(fs.existsSync(srcPath), `仓库根 shared/${f} 不存在`);
    assert.ok(fs.existsSync(dstPath), `extension/shared/${f} 不存在——忘了跑 node scripts/pack-extension.js`);
    // 逐字节比对，不做「剥掉注释头再比」——那会给守卫开口子（真实改动可以藏进注释头里）
    assert.strictEqual(fs.readFileSync(dstPath, 'utf8'), fs.readFileSync(srcPath, 'utf8'),
      `extension/shared/${f} 与源不一致：改了 shared/ 后要跑 node scripts/pack-extension.js 重新同步；`
      + '绝不要手改生成拷贝，那等于又回到两份副本');
  }
  const extra = fs.readdirSync(path.join(EXT, 'shared')).filter(f => !SHARED_FILES.includes(f));
  assert.deepStrictEqual(extra, [], `extension/shared/ 里有多余文件：${extra.join(', ')}（源已删但拷贝没清）`);
});

check('shared 的值本身正确（源头错了三端一起错，所以源头也要有契约）', () => {
  assert.strictEqual(AJA.STAGE_PRESETS.length, 14, '阶段预设应为 14 档');
  // 跨 vm context 的数组原型不同，deepStrictEqual 会报「结构相同但引用不等」，所以先展开成本地数组
  assert.deepStrictEqual([...AJA.STAGE_PRESETS],
    ['待投递', '已投递', '测评', '笔试', '机试', '一面', '二面', '三面', '四面', '五面', '交叉面', 'HR面', 'Offer', '已结束']);
  assert.deepStrictEqual([...AJA.COMPANY_TYPES], ['央国企', '私企', '外企'], '企业性质应为约定的 3 档');
  assert.strictEqual(AJA.COMPANY_TYPE_UNSET, '未设置');
  assert.strictEqual(Object.keys(AJA.DEFAULT_RESUME).length, 6, '默认简历应为 6 段');
  // 归一化两套 API 缺一不可：少字符串版插件要改调用点，少 record 版网页版要改 31 处
  for (const fn of ['companyKey', 'positionKey', 'loosePositionKey', 'sameCompanyKey', 'sameCompany',
    'companyGroupKey', 'normalizePositionSlug', 'loosePositionSlug', 'sameCompanyGroup']) {
    assert.strictEqual(typeof AJA[fn], 'function', `shared/company-key.js 缺少 ${fn}`);
  }
  // LEGAL_SUFFIX_RE 此前在网页版与插件各有一份，现在应一并从 shared 导出。
  // 用行为断言而不是 instanceof RegExp：跨 vm context 的原型不同，instanceof 必然为假
  // （与上面 deepStrictEqual 要展开数组是同一个原因）。
  const re = AJA.LEGAL_SUFFIX_RE;
  assert.ok(re && typeof re.test === 'function' && typeof re.source === 'string',
    'LEGAL_SUFFIX_RE 应一并导出（此前网页版与插件各有一份）');
  assert.ok(re.test('腾讯科技有限公司'), 'LEGAL_SUFFIX_RE 应能匹配「有限公司」');
  assert.ok(re.test('华为集团'), 'LEGAL_SUFFIX_RE 应能匹配「集团」');
  assert.ok(!re.test('星海科技'), 'LEGAL_SUFFIX_RE 不该匹配行业词「科技」（否则星海科技与星海互娱会被并成一家）');
  assert.ok(!re.test('星海互娱'), '同上：「互娱」是行业词，必须保留');
});

check('别名是真的别名（同一函数引用），不是复制出来的第二份实现', () => {
  // 这是 D12 / 2.3 的核心：合并之后如果「别名」其实是又抄了一份实现，漂移风险原封不动还在
  assert.strictEqual(AJA.normalizePositionSlug, AJA.positionKey, 'normalizePositionSlug 应是 positionKey 的同一引用');
  assert.strictEqual(AJA.loosePositionSlug, AJA.loosePositionKey, 'loosePositionSlug 应是 loosePositionKey 的同一引用');
  assert.strictEqual(AJA.sameCompanyGroup, AJA.sameCompanyKey, 'sameCompanyGroup 应是 sameCompanyKey 的同一引用');
  // companyGroupKey 收 record、companyKey 收字符串，签名不同所以不能是同一引用，但必须行为等价
  for (const c of ['腾讯', '腾讯科技（深圳）有限公司', '字节跳动', '星海科技', '', null, undefined, 'ＴCL']) {
    assert.strictEqual(AJA.companyGroupKey({ company: c }), AJA.companyKey(c),
      `companyGroupKey 与 companyKey 对 ${JSON.stringify(c)} 结果不一致`);
  }
  assert.strictEqual(AJA.companyGroupKey(null), '', 'record 为 null 时不该抛错');
});

check('插件 constants.js 只做别名转发，不得再有阶段/企业性质字面量', () => {
  // constants.js 在 shared **之后**加载，留着字面量会把单一事实源覆盖回两份副本，
  // 而且测试与功能全都正常——只有下次改阶段名时才会发现两端不一致
  assert.ok(/root\.AJA\.STAGES = root\.AJA\.STAGE_PRESETS;/.test(SRC.constants),
    'constants.js 缺少 AJA.STAGES 的别名转发（插件全代码用的是 AJA.STAGES）');
  assert.ok(!/AJA\.STAGES = \[/.test(SRC.constants), 'constants.js 里又出现了阶段字面量数组');
  assert.ok(!/AJA\.COMPANY_TYPES = \[/.test(SRC.constants), 'constants.js 里又出现了企业性质字面量数组');
  assert.ok(!/央国企|私企|外企/.test(SRC.constants), 'constants.js 里不该再有企业性质的中文字面量');
  // 插件专有常量必须保留原地（网页版与 Action 用不到，搬进 shared 只会制造新耦合）
  for (const k of ['TRACKER_URL', 'TRACKER_ORIGIN', 'TRACKER_PATH_PREFIX', 'UI_STORAGE_KEY', 'MSG', 'VERSION', 'BRIDGE_SOURCE']) {
    assert.ok(SRC.constants.includes(`AJA.${k}`), `constants.js 丢了插件专有常量 ${k}`);
  }
});

check('三端都指向同一份 shared，五组原始副本已清零（语法级断言，不受排版影响）', () => {
  const html = fs.readFileSync(WEB, 'utf8');
  // ① 网页版：八个转发别名
  const ALIAS = {
    STAGE_PRESETS: /const STAGE_PRESETS = AJA\.STAGE_PRESETS;/,
    COMPANY_TYPES: /const COMPANY_TYPES = AJA\.COMPANY_TYPES;/,
    COMPANY_TYPE_UNSET: /const COMPANY_TYPE_UNSET = AJA\.COMPANY_TYPE_UNSET;/,
    DEFAULT_RESUME: /const DEFAULT_RESUME = AJA\.DEFAULT_RESUME;/,
    companyGroupKey: /const companyGroupKey = AJA\.companyGroupKey;/,
    sameCompanyGroup: /const sameCompanyGroup = AJA\.sameCompanyGroup;/,
    normalizePositionSlug: /const normalizePositionSlug = AJA\.normalizePositionSlug;/,
    loosePositionSlug: /const loosePositionSlug = AJA\.loosePositionSlug;/
  };
  for (const [name, re] of Object.entries(ALIAS)) {
    assert.ok(re.test(html), `index.html 的 ${name} 不是 shared 的转发别名（可能又出现了第二份实现）`);
  }
  // ② 网页版不得再有字面量副本
  assert.ok(!/const STAGE_PRESETS = \[/.test(html), 'index.html 又出现了阶段字面量');
  assert.ok(!/const COMPANY_TYPES = \[/.test(html), 'index.html 又出现了企业性质字面量');
  assert.ok(!/const LEGAL_SUFFIX_RE = \//.test(html), 'index.html 又出现了法人后缀正则副本');
  assert.ok(!/function companyGroupKey\(/.test(html), 'index.html 又出现了 companyGroupKey 的实现体');
  assert.ok(!/function normalizePositionSlug\(/.test(html), 'index.html 又出现了 normalizePositionSlug 的实现体');
  assert.ok(!/const DEFAULT_RESUME = \{/.test(html), 'index.html 又出现了默认简历字面量');
  // ③ 网页版必须真的加载这四个 script，否则别名全是 undefined（而且不报错）
  for (const f of SHARED_FILES) {
    assert.ok(html.includes(`<script src="./shared/${f}"></script>`), `index.html 缺少 <script src="./shared/${f}">`);
  }
  // ④ Action：config.js 在 services/mail-sync/src/ 深三层，需要三个 ../
  const cfg = readRoot('services/mail-sync/src/config.js');
  assert.ok(/require\('\.\.\/\.\.\/\.\.\/shared\/stages'\)/.test(cfg),
    'config.js 的 require 路径不对：本文件深三层，回到仓库根需要三个 ../（写两个只到 services/shared/）');
  assert.ok(!/const STAGE_PRESETS = \[/.test(cfg), 'config.js 又出现了阶段字面量');
  // ⑤ 插件：被取代的两个 common 文件必须已删除
  for (const gone of ['common/company-key.js', 'common/default-resume.js']) {
    assert.ok(!fs.existsSync(path.join(EXT, gone)), `extension/${gone} 应已删除（被 shared/ 取代）`);
  }
  // ⑥ background 的 importScripts 必须含 shared 四件，且排在 constants 之前
  const imp = /importScripts\(([\s\S]*?)\);/.exec(SRC.background);
  assert.ok(imp, 'background.js 找不到 importScripts');
  const list = [...imp[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  for (const f of SHARED_FILES) {
    assert.ok(list.includes(`shared/${f}`), `background.js 的 importScripts 缺 shared/${f}`);
  }
  assert.ok(list.indexOf('shared/stages.js') < list.indexOf('common/constants.js'),
    'background.js 里 shared 必须排在 constants 之前（别名转发依赖）');
  assert.ok(!list.some(s => s.includes('common/company-key') || s.includes('common/default-resume')),
    'background.js 还在 importScripts 已删除的 common 文件，扩展会加载失败');
});

check('shared/ 进了 dist 白名单与 APP_SHELL，且两边一一对应', () => {
  const build = readRoot('build.js');
  assert.ok(/existsSync\(path\.join\(ROOT, 'shared'\)\)/.test(build),
    'build.js 没有自动纳入 shared/（线上会 4 个 404）');
  const sw = readRoot('service-worker.js');
  const html = fs.readFileSync(WEB, 'utf8');
  for (const f of SHARED_FILES) {
    // cache.addAll 全有或全无：APP_SHELL 缺一个 → 整个 install 失败 → PWA 离线能力全废
    assert.ok(sw.includes(`'./shared/${f}'`),
      `service-worker.js 的 APP_SHELL 缺 ./shared/${f}（addAll 全有或全无，缺一个就打挂 PWA）`);
    assert.ok(html.includes(`./shared/${f}`),
      `index.html 没引用 ./shared/${f} 但 APP_SHELL 里有——那是白缓存，两边必须一一对应`);
  }
});

check('panel.css 的 .p-section 必须 flex: 0 0 auto（删了它整个 Side Panel 就滚不动）', () => {
  // 失效模式完全静默：.p-body 是高度被限死的 flex 纵向滚动容器，子项默认可收缩，
  // 于是内容超高时浏览器**压扁子项**而不是让它溢出；.p-section 又带 overflow:hidden，
  // 被压扁后多出的内容直接裁掉 → .p-body 永不溢出 → overflow-y:auto 永不出滚动条。
  // 控制台零报错、元素都在 DOM 里，只是够不着。v5.0.0 起就潜伏着（默认全折叠时高度不够触发），
  // 用户展开暂存箱才复现，报上来的症状是"打开后不能下滑"。
  const m = /\.p-section\s*\{[^}]*\}/.exec(SRC.panelCss);
  assert.ok(m, 'panel.css 里找不到 .p-section 规则');
  // 剥掉 CSS 注释再断言。本规则的注释里就写着「flex: 0 0 auto 是滚动能力的前提」来解释为什么，
  // 不剥的话**把声明删掉守卫依然绿** —— 第一次做 negative test 时正是这样漏过去的。
  // 同一个坑在 web-check.js 的 del-exp-field 守卫上踩过一次（那里是 JS 行注释），
  // 规律是：凡 negative 断言扫源码文本，就必须先剥注释，否则解释性注释会替被删的代码"顶罪"。
  const decls = m[0].replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/flex:\s*0 0 auto/.test(decls) || /flex-shrink:\s*0/.test(decls),
    '.p-section 必须声明 flex: 0 0 auto（或 flex-shrink: 0），否则在 .p-body 里会被压扁、内容被 overflow:hidden 裁掉，面板滚不动');
  // 滚动容器自身那半也不能少：min-height:0 是让 flex 子项肯收缩到内容以下的前提
  const body = /\.p-body\s*\{[^}]*\}/.exec(SRC.panelCss);
  assert.ok(body, 'panel.css 里找不到 .p-body 规则');
  const bodyDecls = body[0].replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/overflow-y:\s*auto/.test(bodyDecls), '.p-body 必须是滚动容器');
  assert.ok(/min-height:\s*0/.test(bodyDecls), '.p-body 必须有 min-height:0，否则它自己不肯收缩、滚动同样失效');
});

check('panel.html 的区块 id 齐全（顺序断言与桩初始化都按 id 定位）', () => {
  for (const id of ['p-sec-capture', 'p-sec-resume', 'p-sec-pending']) {
    assert.ok(SRC.panelHtml.includes(`id="${id}"`), `panel.html 缺 ${id}`);
  }
});

runAll();
