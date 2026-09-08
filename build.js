#!/usr/bin/env node
/**
 * 构建脚本：把 GitHub Pages 需要伺服的文件按白名单拷进 dist/
 *
 * 阶段 1 刻意"空转"：dist/index.html 与根 index.html **逐字节相同**。
 * 这一阶段唯一目的是把「部署方式变更」与「代码变更」彻底解耦——先证明部署链本身没问题、
 * 线上产物与现在完全一致，再在阶段 3 让它真正开始做事（拼接拆分后的模块）。
 *
 * 刻意不压缩、不转译：目标是现代 Chrome/Safari（`?.` `??` `Array.at` 原生支持），
 * Pages 自带 gzip，压缩换来的字节收益抵不上「DevTools 行号对不上」的调试代价。
 *
 * 零依赖：只用 node 内置的 fs/path，CI 不需要 npm install（本仓库 9 套测试同样零依赖）。
 *
 * 运行：node build.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// ---- 白名单 ---------------------------------------------------------------
// 只有列在这里的才会进 dist（= 才会被 Pages 伺服）。依据见方案 4.2：
// 四个入口文件的全部站内引用，加上第三方资源目录。
//
// 规则：第三方库的资源目录一律**整目录**拷贝，不按引用逐个挑——
// tesseract 在运行时按配置动态加载 ocr/worker.min.js 与 ocr/core/*.wasm.js，
// 而 index.html 只静态引用了 ocr/tesseract.min.js 与 ocr/chi_sim-data.js；
// 按静态引用挑文件会漏掉它们，且只在用户真的用到 OCR 时才 404（低频路径，极易漏测）。
const FILES = [
  'index.html',
  'download.html',
  'manifest.webmanifest',
  'service-worker.js',
  // .nojekyll 在 Actions 部署模式下已无作用（GitHub Actions 不跑 Jekyll），
  // 保留它是为了方案 1.5 的回滚路径：一旦 Settings 改回 branch 模式，
  // 缺了它会因下划线开头的文件被 Jekyll 忽略而出问题。
  '.nojekyll'
];
const DIRS = ['icons', 'ocr', 'downloads', 'docs'];

// 阶段 2 引入 shared/ 后必须进 dist（index.html 会 <script src="./shared/…">），
// 且要与 service-worker.js 的 APP_SHELL 在**同一次提交**里加上——
// addAll 是全有或全无：任一 URL 404 就会让整个 SW install 失败、PWA 离线能力全废。
// 这里用 existsSync 自动纳入，阶段 1 没有该目录时不报错。
if (fs.existsSync(path.join(ROOT, 'shared'))) DIRS.push('shared');

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

  // HTML：只扫 href/src **属性**。
  // 刻意不扫内联 JS 里的任意 './x' 字符串——index.html:5738 有 `const key = './chi_sim.traineddata'`，
  // 那是 tesseract 写进 IndexedDB keyval 的**键名**（中文语言数据由 ocr/chi_sim-data.js 的内联
  // base64 解码后存入 IndexedDB，全程不发网络请求），不是要 fetch 的 URL。扫它会误报"上线就是 404"。
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

let totalFiles = 0, totalBytes = 0;
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

console.log(`\n✓ dist/ 构建完成：${totalFiles} 个文件，${(totalBytes / 1024).toFixed(1)} KB`);
console.log(`✓ 自检通过：入口文件的全部站内引用都在产物里（含 manifest 图标与 docs 内部链接）`);
