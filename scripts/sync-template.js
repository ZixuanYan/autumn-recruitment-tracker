#!/usr/bin/env node
/**
 * template 同步脚本：把 monorepo 的 services/mail-sync/ 同步成独立仓库布局的 staging/
 *
 * 目标仓库是公开的 autumn-mail-sync-template（给用户 fork 去跑自己的邮件同步 Action）。
 * 它需要 mail-sync 的一部分、但不能全要，而且**目录布局与 monorepo 不同**，所以不能直接 push。
 *
 * 三类改写（缺一类，template 用户就会崩）：
 *  ① package.json 的 test 脚本：只跑 run.js + integration.js。
 *     另外 7 个测试文件依赖仓库根的 index.html / extension/，template 里没有，跑起来必 ENOENT。
 *     （template 当前的 test 脚本正是这个 bug：它跑了 web-check.js 与 web-runtime.js）
 *  ② test/run.js 与 test/integration.js 的路径：去掉 monorepo 前缀（方案 D9，共 14 处）。
 *     阶段 0 把它们从 '../src/…' 改成了 '../services/mail-sync/src/…'，而 template 是根级 src/。
 *     漏了这步，用户跑 npm test 只会从 ENOENT 变成 MODULE_NOT_FOUND——问题没修完，只是换了个报错。
 *  ③ src/config.js 的 require 层级：'../../../shared/stages' → '../../shared/stages'（方案 D17）。
 *     monorepo 里 config.js 在 services/mail-sync/src/（深三层），template 里在 src/（深两层）；
 *     而且 template 本来没有 shared/，必须把 shared/stages.js 一并拷过去，否则 Action 启动即崩。
 *
 * 运行：node scripts/sync-template.js            生成 staging/
 *      node scripts/sync-template.js --test      生成后在 staging/ 里实跑 npm test（推荐）
 * 生成后请人工 review staging/，确认无误再自行 push 到 template 仓库（本脚本**不推送**）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'services', 'mail-sync');
const STAGING = path.join(ROOT, 'staging');

// template 需要的 shared 文件：config.js 只 require stages，但整目录拷过去更省心
// （12.5 KB，且将来 config/ai 若用到 company-types 不必再改本脚本）
const SHARED_FILES = ['stages.js', 'company-types.js', 'company-key.js', 'default-resume.js'];

// 只带这两个测试：其余 7 个依赖仓库根的 index.html 与 extension/，template 里没有
const TEST_FILES = ['run.js', 'integration.js'];

let rewrites = { testPaths: 0, requireLevel: 0, pkgTest: 0, pkgVersion: 0, readmeLink: 0 };

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === '.DS_Store') continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) n += copyTree(s, d);
    else { fs.copyFileSync(s, d); n += 1; }
  }
  return n;
}

// 改写 ②：去掉测试文件里的 monorepo 前缀
function rewriteTestPaths(file) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before.replace(/\.\.\/services\/mail-sync\//g, '../');
  after = after.replace(/'\.\.'\s*,\s*'services'\s*,\s*'mail-sync'/g, "'..'");
  const hits = (before.match(/\.\.\/services\/mail-sync\//g) || []).length
    + (before.match(/'\.\.'\s*,\s*'services'\s*,\s*'mail-sync'/g) || []).length;
  if (after !== before) fs.writeFileSync(file, after);
  rewrites.testPaths += hits;
  // 改完必须确认没有残留：残留意味着 npm test 会以 MODULE_NOT_FOUND 失败
  if (/services\/mail-sync|'services'/.test(after)) {
    console.error(`✗ ${path.basename(file)} 里仍有 monorepo 路径残留，请检查替换规则`);
    process.exit(1);
  }
  return hits;
}

// 改写 ③：src/ 下所有 require shared 的层级
// monorepo 里 config.js 在 services/mail-sync/src/（到仓库根要三个 ../），
// template 里在 src/（到仓库根只要**一个** ../）。
// ⚠️ 这里曾写错成 '../../shared/'（以为独立仓库是"深两层"），而且在 monorepo 内跑 --test
// **发现不了**：staging/src/ 往上两层恰好逃逸到仓库根，那里真有 shared/，于是假绿。
// 直到把 staging 复制到 monorepo 之外才暴露 MODULE_NOT_FOUND。教训见 --test 那段的注释。
function rewriteSharedRequire(dir) {
  let hits = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { hits += rewriteSharedRequire(p); continue; }
    if (!e.name.endsWith('.js')) continue;
    const before = fs.readFileSync(p, 'utf8');
    const after = before.replace(/require\('\.\.\/\.\.\/\.\.\/shared\//g, "require('../shared/");
    if (after !== before) {
      fs.writeFileSync(p, after);
      hits += (before.match(/require\('\.\.\/\.\.\/\.\.\/shared\//g) || []).length;
    }
  }
  rewrites.requireLevel += hits;
  return hits;
}

// ---- 执行 ----
fs.rmSync(STAGING, { recursive: true, force: true });
fs.mkdirSync(STAGING, { recursive: true });

// 1) src/ 与根级文件
const srcCount = copyTree(path.join(SRC, 'src'), path.join(STAGING, 'src'));
for (const f of ['index.js', 'README.md', '.gitignore']) {
  const s = path.join(SRC, f);
  if (fs.existsSync(s)) fs.copyFileSync(s, path.join(STAGING, f));
}

// 2) workflow 提升一级：monorepo 里它们在 services/mail-sync/.github/workflows/（GitHub 不读，天然不激活），
//    template 里必须落在仓库根 .github/workflows/，否则定时任务完全不触发且没有任何报错
const wfSrc = path.join(SRC, '.github', 'workflows');
const wfCount = fs.existsSync(wfSrc) ? copyTree(wfSrc, path.join(STAGING, '.github', 'workflows')) : 0;

// 3) shared/（config.js 依赖，template 原本没有这个目录）
fs.mkdirSync(path.join(STAGING, 'shared'), { recursive: true });
for (const f of SHARED_FILES) {
  const s = path.join(ROOT, 'shared', f);
  if (!fs.existsSync(s)) { console.error(`✗ 仓库根 shared/${f} 不存在`); process.exit(1); }
  fs.copyFileSync(s, path.join(STAGING, 'shared', f));
}

// 4) 测试只带两个
fs.mkdirSync(path.join(STAGING, 'test'), { recursive: true });
for (const f of TEST_FILES) {
  const s = path.join(ROOT, 'test', f);
  if (!fs.existsSync(s)) { console.error(`✗ 根 test/${f} 不存在`); process.exit(1); }
  fs.copyFileSync(s, path.join(STAGING, 'test', f));
  rewriteTestPaths(path.join(STAGING, 'test', f));
}

// 5) 改写 src/ 里的 shared require 层级
rewriteSharedRequire(path.join(STAGING, 'src'));

// 6) package.json：test 脚本与版本号
const pkgPath = path.join(SRC, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const oldTest = pkg.scripts.test;
pkg.scripts.test = `node test/${TEST_FILES.join(' && node test/')}`;
if (oldTest !== pkg.scripts.test) rewrites.pkgTest = 1;
rewrites.pkgVersion = 1;   // 版本号直接取 services/mail-sync 的，天然对齐
fs.writeFileSync(path.join(STAGING, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

// 7) README 的相对链接改绝对 URL（相对链接在独立仓库里会指向不存在的路径）
const readmePath = path.join(STAGING, 'README.md');
if (fs.existsSync(readmePath)) {
  const before = fs.readFileSync(readmePath, 'utf8');
  const after = before.replace(/\.\.\/autumn-recruitment-tracker/g,
    'https://github.com/ZixuanYan/autumn-recruitment-tracker');
  if (after !== before) {
    fs.writeFileSync(readmePath, after);
    rewrites.readmeLink = (before.match(/\.\.\/autumn-recruitment-tracker/g) || []).length;
  }
  // 明确标注这是同步产物，避免有人直接在 template 里改（改了下次同步就丢）
  const banner = '> 本仓库是 monorepo `autumn-recruitment-tracker` 里 `services/mail-sync/` 的**同步产物**，'
    + '由 `scripts/sync-template.js` 生成。请勿直接在此修改——改动会在下次同步时被覆盖。\n\n';
  const cur = fs.readFileSync(readmePath, 'utf8');
  if (!cur.includes('同步产物')) {
    const lines = cur.split('\n');
    lines.splice(1, 0, '', banner.trim());
    fs.writeFileSync(readmePath, lines.join('\n'));
  }
}

console.log(`✓ staging/ 生成完毕（${path.relative(ROOT, STAGING)}）`);
console.log(`  src/ ${srcCount} 个文件 · workflow ${wfCount} 个（已提升到仓库根）· shared ${SHARED_FILES.length} 个 · test ${TEST_FILES.length} 个`);
console.log(`  改写：测试路径 ${rewrites.testPaths} 处 · shared require 层级 ${rewrites.requireLevel} 处 · `
  + `package.json test 脚本 ${rewrites.pkgTest ? '已改为 ' + pkg.scripts.test : '无需改'} · 版本号 ${pkg.version} · README 链接 ${rewrites.readmeLink} 处`);

// 8) 自检：staging 必须自洽（不依赖 monorepo 的任何路径）
const bad = [];
for (const dir of ['src', 'test']) {
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      const s = fs.readFileSync(p, 'utf8');
      // 只查**真实的代码引用**（require 与 path 字面量），不查注释文本：
      // config.js 的注释里刻意保留了「monorepo 深三层 / 独立仓库深两层」的对照说明，
      // 那正是同步脚本要改写 require 层级的依据；把它当残留报出来是误报，删掉它反而
      // 让 template 里的读者不明白这个 require 为什么是两层。
      if (/require\(\s*['"][^'"]*services\/mail-sync|['"]\.\.\/services\/mail-sync|['"]services['"]\s*,\s*['"]mail-sync['"]/.test(s)) {
        bad.push(`${p} 的代码里仍引用 services/mail-sync`);
      }
      // shared 的 require 必须**恰好一层** ../（template 布局：src/config.js → 仓库根）。
      // 这条要查"层级不对"而不是只查"仍是三层"：写错成两层同样致命，而且在 monorepo 内
      // 跑测试会假绿（staging/src 往上两层恰好是仓库根，那里真有 shared/）。本轮就写错过一次。
      for (const hit of s.match(/require\(\s*'(?:\.\.\/)+shared\//g) || []) {
        if (hit !== "require('../shared/") {
          bad.push(`${p} 的 shared require 层级不对：${hit}shared/…（应为 require('../shared/…）`);
        }
      }
      if (/['"][^'"]*autumn-recruitment-tracker\/(index\.html|extension)/.test(s)) bad.push(`${p} 仍依赖 tracker 仓库`);
    }
  };
  walk(path.join(STAGING, dir));
}
if (bad.length) {
  console.error(`\n✗ staging 自检失败 ${bad.length} 项：`);
  for (const b of bad) console.error(`    ${b}`);
  process.exit(1);
}
console.log('✓ staging 自检通过：无 monorepo 路径残留、无三层 shared require、不依赖 tracker 仓库');

if (process.argv.includes('--test')) {
  // 🔴 必须把 staging 复制到 **monorepo 之外**再跑，不能在 staging/ 原地跑。
  // 原因：staging/src/config.js 的 require('../shared/stages') 如果层级写错（多一层或少一层 ../），
  // 在 monorepo 内解析时会**逃逸到仓库根的 shared/** 而恰好命中，测试假绿；
  // 只有复制到隔离目录才会暴露 MODULE_NOT_FOUND。
  // 本轮就靠这一步抓到 require 层级写错（写成 ../../shared，正确是 ../shared）——
  // 而在 staging/ 原地跑时它是"通过"的。这也是方案 T.4「全新 clone 到空目录再 npm test」不可省略的原因。
  const os = require('os');
  const verifyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-verify-'));
  copyTree(STAGING, verifyDir);
  console.log(`\n=== 在 monorepo 外的隔离目录实跑 npm test（${path.basename(verifyDir)}）===`);
  console.log('    等价于 template 用户全新 clone 的体验；在 staging/ 原地跑会因路径逃逸而假绿');
  let out = '';
  try {
    out = execFileSync('npm', ['test'], { cwd: verifyDir, encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    fs.rmSync(verifyDir, { recursive: true, force: true });
    console.error('✗ 隔离目录里 npm test 失败（说明 staging 不自洽，template 用户会崩）：');
    console.error(String(err.stdout || '') + String(err.stderr || ''));
    process.exit(1);
  }
  fs.rmSync(verifyDir, { recursive: true, force: true });
  const passed = (out.match(/✓/g) || []).length;
  console.log(out.split('\n').filter(l => /全部通过|通过 \d+/.test(l)).join('\n'));
  console.log(`✓ 隔离目录 npm test 通过，累计 ${passed} 项（预期 64 = run 54 + integration 10）`);
  if (passed !== 64) {
    console.error(`⚠ 断言数 ${passed} 与预期 64 不符：可能有人为了让测试变绿而少跑了 integration.js`
      + '（那 10 项是编排层守卫，历史上抓到过 adjudicated is not defined 那次线上事故）');
    process.exit(1);
  }
}
