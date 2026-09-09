#!/usr/bin/env node
/**
 * 构建脚本：把 src/ 拼接成 index.html，再把 Pages 需要伺服的文件按白名单拷进 dist/
 *
 * 阶段 1 时这里是"空转"（dist/index.html 与根 index.html 逐字节相同），目的只是把
 * 「部署方式变更」与「代码变更」解耦。阶段 3 起它真正开始做事：**index.html 是构建产物**，
 * 源在 src/（template.html + styles/ + core/ + mail/ + app/），改代码要改 src/ 然后
 * `npm run build:write`，直接改 index.html 会在下次构建时被覆盖。
 *
 * 刻意不压缩、不转译：目标是现代 Chrome/Safari（`?.` `??` `Array.at` 原生支持），
 * Pages 自带 gzip，压缩换来的字节收益抵不上「DevTools 行号对不上」的调试代价。
 *
 * 刻意不外链 app.js / styles.css（仍然内联）：这样 index.html 仍是唯一入口，
 * service-worker.js 的 APP_SHELL 与白名单都不用动（addAll 是全有或全无，漏一项就打挂
 * 所有用户的 PWA 离线能力），web-check.js 的「内联 <script> 用 vm.Script 校验」也继续有效。
 *
 * 零依赖：只用 node 内置的 fs/path，CI 不需要 npm install（本仓库 9 套测试同样零依赖）。
 *
 * 运行：node build.js            只生成 dist/
 *       node build.js --write    额外把拼接结果写回仓库根 index.html（提交前跑这个）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const SRC = path.join(ROOT, 'src');

// ---- 白名单 ---------------------------------------------------------------
// 只有列在这里的才会进 dist（= 才会被 Pages 伺服）。依据见方案 4.2：
// 四个入口文件的全部站内引用，加上第三方资源目录。
//
// 规则：第三方库的资源目录一律**整目录**拷贝，不按引用逐个挑。
// 曾经的教训：ocr/ 里的 tesseract 在运行时按 CPU 特性动态加载 worker.min.js 与 core/*.wasm.js，
// 而 index.html 只静态引用了其中两个文件——按静态引用挑就会漏，且只在用户真的用到那条
// 低频路径时才 404，极难测出来。（ocr/ 本身已随截图识别功能在 v4.12.0 删除，规则保留。）
//
// ⚠️ index.html **不在这里**：阶段 3 起它由 src/ 拼接生成（见下面的 buildIndexHtml），
// 生成后直接写进 dist。若同时留在这个白名单里，就会变成"先拷旧的、再被生成的覆盖"，
// 结果取决于代码顺序——那种隐式依赖迟早咬人。
const FILES = [
  'download.html',
  'manifest.webmanifest',
  'service-worker.js',
  // .nojekyll 在 Actions 部署模式下已无作用（GitHub Actions 不跑 Jekyll），
  // 保留它是为了方案 1.5 的回滚路径：一旦 Settings 改回 branch 模式，
  // 缺了它会因下划线开头的文件被 Jekyll 忽略而出问题。
  '.nojekyll'
];
// v4.12.0：'ocr' 已从白名单移除 —— 截图识别功能与 ocr/ 那 14 MB tesseract 一起删了
// （岗位库是它的唯一出口，岗位库删了它就没有落点）。少一个整目录上线，
// dist 从 ~15 MB 降到 ~1 MB，Pages 部署与首屏都快一截。
const DIRS = ['icons', 'downloads', 'docs'];

// 阶段 2 引入 shared/ 后必须进 dist（index.html 会 <script src="./shared/…">），
// 且要与 service-worker.js 的 APP_SHELL 在**同一次提交**里加上——
// addAll 是全有或全无：任一 URL 404 就会让整个 SW install 失败、PWA 离线能力全废。
// 这里用 existsSync 自动纳入，阶段 1 没有该目录时不报错。
if (fs.existsSync(path.join(ROOT, 'shared'))) DIRS.push('shared');

// ---- 拼接：src/ → index.html ----------------------------------------------
/**
 * 清单来自 src/bundle.js，**build.js 与测试共用同一份**（test/lib/load-src.js 也读它）。
 * 两边各写一份拼接顺序就会漂移，漂移后测试测的不再是上线的那份代码——
 * 那正是这个项目一直在消灭的东西。
 */
const BUNDLE = require(path.join(SRC, 'bundle.js'));

const readSrc = (rel) => {
  const p = path.join(SRC, rel);
  if (!fs.existsSync(p)) throw new Error(`src/${rel} 不存在（清单里有、磁盘上没有）`);
  return fs.readFileSync(p, 'utf8');
};

/**
 * 把标记行替换成一段内容。
 *
 * 🔴 一律用 split(marker).join(content)，**绝不能用 String.replace(marker, content)**：
 * 内联 JS 里有 156 个模板字面量，满是 `$&` `$'` `${` 这类字符，而 replace 的第二个
 * 字符串参数会把 `$&` 当成"匹配到的内容"、`$'` 当成"匹配点之后的全部文本"——
 * 代码被静默改写、语法仍然合法、构建也不报错，症状是上线后某处行为诡异却无从归因。
 * web-check.js 有一条探针断言专门盯着这件事（谁"优化"成 replace 就会红）。
 *
 * 每个 src/ 文件都以换行结尾，所以文件之间是 join('')；标记必须顶格独占一行，
 * 带缩进的话那几个空格会残留进产物（多出来的缩进会让 SHA 变化）。
 */
function splice(text, marker, content) {
  const m = marker + '\n';
  if (!text.includes(m)) {
    throw new Error(`拼接失败：找不到标记 ${marker}（模板结构变了或标记名拼错）`);
  }
  return text.split(m).join(content);
}

function bundleApp() {
  // 先把 app/ 的几段（清单里的字符串项）接起来，再把 { module, files } 的内容
  // 填进各段里预留的顶格标记处。两类项混在同一个清单里，顺序即语义。
  let app = BUNDLE.app.filter(e => typeof e === 'string').map(readSrc).join('');
  for (const entry of BUNDLE.app) {
    if (typeof entry !== 'object') continue;
    app = splice(app, `/*__MODULE:${entry.module}__*/`, entry.files.map(readSrc).join(''));
  }
  return app;
}

function buildIndexHtml() {
  const css = BUNDLE.styles.map(readSrc).join('');
  const out = splice(splice(readSrc('template.html'), '/*__STYLES__*/', css), '/*__APP__*/', bundleApp());
  // 守卫：标记必须全部被消费掉。残留意味着标记名拼错或模板结构变了，
  // 症状是线上少一整块代码（`$ is not defined` 直接白屏），而构建本身不报错。
  const left = out.match(/\/\*__(?:STYLES|APP|MODULE:[a-z0-9]+)__\*\//g);
  if (left) throw new Error(`产物里残留未消费的拼接标记：${[...new Set(left)].join(', ')}`);
  return out;
}

// ---- 工具 -----------------------------------------------------------------
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  let files = 0, bytes = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      const sub = copyDir(s, d);
      files += sub.files; bytes += sub.bytes;
    } else {
      fs.copyFileSync(s, d);
      files += 1; bytes += fs.statSync(s).size;
    }
  }
  return { files, bytes };
}

/**
 * 拷完自检：入口文件里的每一个站内引用都必须能在 dist 里找到。
 * 这一步把「线上 404」提前成「构建期失败」——尤其是 SW 的 APP_SHELL，
 * 它缺一个文件就会打挂所有用户的 PWA，而症状（离线能力失效）离原因（白名单漏了一项）非常远。
 */
function selfCheck() {
  const missing = [];
  const check = (entry, ref) => {
    const rel = String(ref || '').replace(/^\.\//, '');
    if (!rel || rel === '/' || /^(https?:|data:|#|mailto:)/.test(rel)) return;
    if (!fs.existsSync(path.join(DIST, rel))) missing.push(`${entry} → ${ref}`);
  };

  // HTML：只扫 href/src **属性**，不扫内联 JS 里的任意 './x' 字符串。
  // 这条限制最初是被一个真实误报逼出来的：截图识别功能里有 `const key = './chi_sim.traineddata'`，
  // 那是 tesseract 写进 IndexedDB keyval 的**键名**（中文语言数据由内联 base64 解码后存入 IndexedDB，
  // 全程不发网络请求），根本不是要 fetch 的 URL，扫它就会报"上线就是 404"。
  // 那个功能已随岗位库在 v4.12.0 删除，但限制保留 —— 内联 JS 里的字符串常量与真实 URL
  // 从形态上就分不开，靠正则猜只会持续产生误报，而属性值是明确的资源引用。
  for (const entry of ['index.html', 'download.html']) {
    const src = fs.readFileSync(path.join(DIST, entry), 'utf8');
    for (const m of src.matchAll(/(?:href|src)="\.\/([^"]+)"/g)) check(entry, m[1]);
  }

  // service-worker.js 是纯 JS 且没有 IndexedDB，里面的 './x' 字符串就是 APP_SHELL 与
  // cache.put 的真实路径，可以整扫——这正是最需要守住的一处（addAll 全有或全无）。
  {
    const src = fs.readFileSync(path.join(DIST, 'service-worker.js'), 'utf8');
    for (const m of src.matchAll(/'\.\/([^']+)'/g)) check('service-worker.js', m[1]);
  }

  // manifest.webmanifest 是 JSON，路径可能不带 ./ 前缀，单独解析而不是靠正则
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.webmanifest'), 'utf8'));
    check('manifest.webmanifest', manifest.start_url);
    for (const icon of manifest.icons || []) check('manifest.webmanifest', icon.src);
  } catch (err) {
    missing.push(`manifest.webmanifest 解析失败: ${err.message}`);
  }

  // docs/ 里的 md 也可能互相引用或引用图片
  const docsDir = path.join(DIST, 'docs');
  if (fs.existsSync(docsDir)) {
    for (const f of fs.readdirSync(docsDir)) {
      if (!f.endsWith('.md')) continue;
      const src = fs.readFileSync(path.join(docsDir, f), 'utf8');
      for (const m of src.matchAll(/\]\((\.\.?\/[^)]+)\)/g)) {
        // md 里的相对链接是相对 docs/ 的，换算到 dist 根
        const rel = path.normalize(path.join('docs', m[1]));
        if (!fs.existsSync(path.join(DIST, rel))) missing.push(`docs/${f} → ${m[1]}`);
      }
    }
  }
  return missing;
}

// ---- 执行 -----------------------------------------------------------------
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// index.html 由 src/ 拼接生成（刻意不在 FILES 白名单里，见上面的说明）。
// --write 时同时写回仓库根：根那份是**入库的产物**，本地可以直接双击打开调试，
// web-check.js 的九十来处产物守卫也读它。CI 用 `diff dist/index.html index.html`
// 抓两种漂移：改了 src/ 忘记 --write、或手改了 index.html 而没改 src/。
const SRC_COUNT = BUNDLE.styles.length + BUNDLE.app.reduce(
  (n, e) => n + (typeof e === 'string' ? 1 : e.files.length), 0) + 1; // +1 = template.html
const html = buildIndexHtml();
fs.writeFileSync(path.join(DIST, 'index.html'), html);
let totalFiles = 1, totalBytes = Buffer.byteLength(html);
console.log(`  生成  ${'index.html'.padEnd(24)} ${String(totalBytes).padStart(8)} B  ← src/ 的 ${SRC_COUNT} 个文件拼接`);

if (process.argv.includes('--write')) {
  const rootIndex = path.join(ROOT, 'index.html');
  const before = fs.existsSync(rootIndex) ? fs.readFileSync(rootIndex, 'utf8') : null;
  fs.writeFileSync(rootIndex, html);
  console.log(before === html
    ? '  ✓ 仓库根 index.html 已是最新（本次无变化）'
    : '  ✓ 已写回仓库根 index.html —— 记得与 src/ 的改动一起提交');
}

const absent = [];

for (const f of FILES) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) { absent.push(f); continue; }
  fs.copyFileSync(src, path.join(DIST, f));
  const size = fs.statSync(src).size;
  totalFiles += 1; totalBytes += size;
  console.log(`  文件  ${f.padEnd(24)} ${String(size).padStart(8)} B`);
}

for (const d of DIRS) {
  const src = path.join(ROOT, d);
  if (!fs.existsSync(src)) { absent.push(d + '/'); continue; }
  const { files, bytes } = copyDir(src, path.join(DIST, d));
  totalFiles += files; totalBytes += bytes;
  console.log(`  目录  ${(d + '/').padEnd(24)} ${files} 个文件 ${String(bytes).padStart(10)} B`);
}

// 白名单里的东西缺失就直接失败：宁可构建红，也不要线上静默 404
if (absent.length) {
  console.error(`\n✗ 白名单里的路径不存在：${absent.join(', ')}`);
  console.error('  如果是有意移除，请同步更新 build.js 的 FILES/DIRS 与 service-worker.js 的 APP_SHELL。');
  process.exit(1);
}

const missing = selfCheck();
if (missing.length) {
  console.error(`\n✗ dist 自检失败，${missing.length} 个站内引用在产物里找不到（上线就是 404）：`);
  for (const m of missing) console.error(`    ${m}`);
  console.error('  最常见原因：新加了 <script src> 或 APP_SHELL 条目，但没把对应目录加进白名单。');
  process.exit(1);
}

// 守卫：源码目录不得上线。白名单是显式的，正常不会漏，但"把 src 加进 DIRS"这种误操作
// 后果是源文件公开可访问（体积 + 隐私双泄漏），而症状（线上能 curl 到 template.html）
// 离原因很远。本项目 CSS 只内联，所以 dist 里出现任何 .css 也一定是误拷。
const LEAK = ['src', 'template.html', 'bundle.js'];
const leaked = LEAK.filter(p => fs.existsSync(path.join(DIST, p)));
const strayCss = fs.existsSync(path.join(DIST, 'styles')) ? ['styles/'] : [];
if (leaked.length || strayCss.length) {
  console.error(`\n✗ 源码泄漏进 dist：${[...leaked, ...strayCss].join(', ')}`);
  console.error('  src/ 是构建源，只应存在于仓库里；本项目的 CSS 一律内联，dist 不该有 .css 文件。');
  process.exit(1);
}

console.log(`\n✓ dist/ 构建完成：${totalFiles} 个文件，${(totalBytes / 1024).toFixed(1)} KB`);
console.log(`✓ 自检通过：入口文件的全部站内引用都在产物里（含 manifest 图标与 docs 内部链接）`);
console.log(`✓ 源码未泄漏：dist 里没有 src/ / template.html / .css`);
