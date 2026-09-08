/**
 * 同步核心：把 monorepo 的 services/mail-sync/ 变成「独立仓库布局」的产物
 *
 * 两个目标共用这一份逻辑，因为它们要做的映射与改写**完全相同**，只有 README 顶部那句
 * banner 不一样：
 *   - 公开 template（autumn-mail-sync-template）：给用户 fork 去跑自己的邮箱
 *   - 私有运行实例（autumn-mail-sync）：实际在跑定时任务的那一份
 * 各写一份脚本就是新的漂移面——这个项目一直在消灭的正是这种东西。
 *
 * 三类改写缺一类，目标仓库就会崩（详见 sync-template.js / sync-private.js 的说明）：
 *   ① package.json 的 test 脚本 → 只跑 run.js + integration.js
 *   ② test/*.js 去掉 monorepo 路径前缀（14 处）
 *   ③ src/ 里 require shared 的层级 ../../../ → ../（一层）
 * 另外：shared/ 四件必须一并拷过去（目标仓库本来没有这个目录），
 *      workflow 必须提升到仓库根（否则定时任务不触发且无报错）。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'services', 'mail-sync');

// 跨端单一事实源：config.js 依赖 stages.js，其余三件一并带上
// （12.5 KB，且将来 config/ai 若用到 company-types 不必再改这里）
const SHARED_FILES = ['stages.js', 'company-types.js', 'company-key.js', 'default-resume.js'];

// 只带这两个测试：其余 7 个依赖仓库根的 index.html 与 extension/，独立仓库里没有
const TEST_FILES = ['run.js', 'integration.js'];

// 独立仓库里跑 npm test 应有的断言数（run.js 54 + integration.js 10）
const EXPECTED_ASSERTIONS = 64;

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === '.DS_Store') continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) n += copyTree(s, d);
    else { fs.copyFileSync(s, d); n += 1; }
  }
  return n;
}

// 改写 ②：去掉测试文件里的 monorepo 前缀
function rewriteTestPaths(file, stats) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before.replace(/\.\.\/services\/mail-sync\//g, '../');
  after = after.replace(/'\.\.'\s*,\s*'services'\s*,\s*'mail-sync'/g, "'..'");
  stats.testPaths += (before.match(/\.\.\/services\/mail-sync\//g) || []).length
    + (before.match(/'\.\.'\s*,\s*'services'\s*,\s*'mail-sync'/g) || []).length;
  if (after !== before) fs.writeFileSync(file, after);
  // 改完必须确认没有残留：残留意味着 npm test 会以 MODULE_NOT_FOUND 失败
  if (/services\/mail-sync|'services'/.test(after)) {
    throw new Error(`${path.basename(file)} 里仍有 monorepo 路径残留，请检查替换规则`);
  }
}

/**
 * 改写 ③：src/ 下 require shared 的层级。
 * monorepo：services/mail-sync/src/config.js → 仓库根需**三个** ../
 * 独立仓库：src/config.js                    → 仓库根需**一个** ../
 *
 * 这里曾写错成 '../../shared/'（以为独立仓库"深两层"），而且在 monorepo 内跑测试
 * **发现不了**：staging/src 往上两层恰好逃逸到仓库根，那里真有 shared/，于是假绿。
 * 直到把产物复制到 monorepo 之外才暴露 MODULE_NOT_FOUND——所以 verifyInIsolation()
 * 刻意在 os.tmpdir() 里跑。
 */
function rewriteSharedRequire(dir, stats) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { rewriteSharedRequire(p, stats); continue; }
    if (!e.name.endsWith('.js')) continue;
    const before = fs.readFileSync(p, 'utf8');
    const after = before.replace(/require\('\.\.\/\.\.\/\.\.\/shared\//g, "require('../shared/");
    if (after !== before) {
      fs.writeFileSync(p, after);
      stats.requireLevel += (before.match(/require\('\.\.\/\.\.\/\.\.\/shared\//g) || []).length;
    }
  }
}

/**
 * 生成独立仓库布局的产物。
 * @param {object} opts
 * @param {string} opts.outDir  输出目录（会被清空重建）
 * @param {string} opts.banner  插到 README 第 2 行的说明（两个目标文案不同）
 * @param {string} opts.label   日志里显示的目标名
 * @returns {object} 统计信息
 */
function generate(opts) {
  const outDir = opts.outDir;
  const stats = { testPaths: 0, requireLevel: 0, readmeLink: 0, srcFiles: 0, wfFiles: 0 };

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // 1) src/ 与根级文件
  stats.srcFiles = copyTree(path.join(SRC, 'src'), path.join(outDir, 'src'));
  for (const f of ['index.js', 'README.md', '.gitignore']) {
    const s = path.join(SRC, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(outDir, f));
  }

  // 2) workflow 提升一级：monorepo 里它们在 services/mail-sync/.github/workflows/（GitHub 不读，
  //    天然不激活），独立仓库必须落在根 .github/workflows/，否则定时任务完全不触发且无任何报错
  const wfSrc = path.join(SRC, '.github', 'workflows');
  stats.wfFiles = fs.existsSync(wfSrc) ? copyTree(wfSrc, path.join(outDir, '.github', 'workflows')) : 0;

  // 3) shared/（config.js 依赖，目标仓库原本没有这个目录）
  fs.mkdirSync(path.join(outDir, 'shared'), { recursive: true });
  for (const f of SHARED_FILES) {
    const s = path.join(ROOT, 'shared', f);
    if (!fs.existsSync(s)) throw new Error(`仓库根 shared/${f} 不存在`);
    fs.copyFileSync(s, path.join(outDir, 'shared', f));
  }

  // 4) 测试只带两个，并改写路径
  fs.mkdirSync(path.join(outDir, 'test'), { recursive: true });
  for (const f of TEST_FILES) {
    const s = path.join(ROOT, 'test', f);
    if (!fs.existsSync(s)) throw new Error(`根 test/${f} 不存在`);
    fs.copyFileSync(s, path.join(outDir, 'test', f));
    rewriteTestPaths(path.join(outDir, 'test', f), stats);
  }

  // 5) src/ 里 require shared 的层级
  rewriteSharedRequire(path.join(outDir, 'src'), stats);

  // 6) package.json：test 脚本 + 版本号（版本号直接取 services/mail-sync 的，天然对齐）
  const pkg = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8'));
  pkg.scripts.test = `node test/${TEST_FILES.join(' && node test/')}`;
  fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  stats.version = pkg.version;
  stats.testScript = pkg.scripts.test;

  // 7) README：相对链接改绝对 URL + 插入 banner
  const readmePath = path.join(outDir, 'README.md');
  if (fs.existsSync(readmePath)) {
    let text = fs.readFileSync(readmePath, 'utf8');
    const before = text;
    text = text.replace(/\.\.\/autumn-recruitment-tracker/g,
      'https://github.com/ZixuanYan/autumn-recruitment-tracker');
    stats.readmeLink = (before.match(/\.\.\/autumn-recruitment-tracker/g) || []).length;
    if (opts.banner && !text.includes(opts.banner)) {
      const lines = text.split('\n');
      lines.splice(1, 0, '', opts.banner);
      text = lines.join('\n');
    }
    fs.writeFileSync(readmePath, text);
  }

  selfCheck(outDir);
  return stats;
}

// 产物必须自洽：不依赖 monorepo 的任何路径
function selfCheck(outDir) {
  const bad = [];
  for (const dir of ['src', 'test']) {
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!e.name.endsWith('.js')) continue;
        const s = fs.readFileSync(p, 'utf8');
        // 只查**真实的代码引用**（require 与 path 字面量），不查注释文本：
        // config.js 的注释里刻意保留了「monorepo 深三层 / 独立仓库深一层」的对照说明，
        // 那正是改写 require 层级的依据，把它当残留报出来是误报。
        if (/require\(\s*['"][^'"]*services\/mail-sync|['"]\.\.\/services\/mail-sync|['"]services['"]\s*,\s*['"]mail-sync['"]/.test(s)) {
          bad.push(`${path.relative(outDir, p)} 的代码里仍引用 services/mail-sync`);
        }
        // shared 的 require 必须**恰好一层** ../；写错成两层同样致命，且在 monorepo 内会假绿
        for (const hit of s.match(/require\(\s*'(?:\.\.\/)+shared\//g) || []) {
          if (hit !== "require('../shared/") {
            bad.push(`${path.relative(outDir, p)} 的 shared require 层级不对：${hit}shared/…（应为 require('../shared/…）`);
          }
        }
        if (/['"][^'"]*autumn-recruitment-tracker\/(index\.html|extension)/.test(s)) {
          bad.push(`${path.relative(outDir, p)} 仍依赖 tracker 仓库`);
        }
      }
    };
    walk(path.join(outDir, dir));
  }
  if (bad.length) {
    throw new Error(`产物自检失败 ${bad.length} 项：\n    ${bad.join('\n    ')}`);
  }
}

/**
 * 在 monorepo **之外**的隔离目录里跑 npm test。
 *
 * 这一步不可省：在 monorepo 内跑会因路径逃逸而假绿（见 rewriteSharedRequire 的注释）。
 * 等价于目标仓库的用户全新 clone 后的体验。
 */
function verifyInIsolation(outDir, label) {
  const verifyDir = fs.mkdtempSync(path.join(os.tmpdir(), `sync-verify-${label}-`));
  try {
    copyTree(outDir, verifyDir);
    let out = '';
    try {
      out = execFileSync('npm', ['test'], { cwd: verifyDir, encoding: 'utf8', stdio: 'pipe' });
    } catch (err) {
      throw new Error(`隔离目录里 npm test 失败（说明产物不自洽，目标仓库会崩）：\n`
        + String(err.stdout || '') + String(err.stderr || ''));
    }
    const passed = (out.match(/✓/g) || []).length;
    if (passed !== EXPECTED_ASSERTIONS) {
      throw new Error(`断言数 ${passed} 与预期 ${EXPECTED_ASSERTIONS} 不符：`
        + '可能有人为了让测试变绿而少跑了 integration.js（那 10 项是编排层守卫，'
        + '历史上抓到过 adjudicated is not defined 那次线上事故）');
    }
    return passed;
  } finally {
    fs.rmSync(verifyDir, { recursive: true, force: true });
  }
}

function listFiles(dir, prefix) {
  const base = prefix || '';
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === '.DS_Store' || e.name === 'node_modules') continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out = out.concat(listFiles(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

/**
 * 把产物应用到一个已 clone 的目标仓库（全量替换，保留 .git）。
 * 这是**破坏性**操作，所以带四道防线：
 *   1. 目标必须是 git 仓库
 *   2. 目标不得是 monorepo 本身或其子目录（否则等于删自己的源码）
 *   3. 目标工作区必须干净（有未提交改动就先停下，避免覆盖掉没保存的东西）
 *   4. 列出「目标仓库独有、产物里没有」的文件——全量替换会删掉它们
 *      （比如你手工加的笔记或额外 workflow）。删了还能用 git 恢复，但必须先看见。
 */
function applyToRepo(opts) {
  const { stagingDir, repoDir, label } = opts;
  const repo = path.resolve(repoDir);
  if (!fs.existsSync(path.join(repo, '.git'))) {
    throw new Error(`${repo} 不是 git 仓库（找不到 .git），拒绝执行全量替换`);
  }
  const rel = path.relative(ROOT, repo);
  if (!rel.startsWith('..') && rel !== '') {
    throw new Error(`目标仓库 ${repo} 在 monorepo 内部，拒绝执行（那会删掉源码本身）`);
  }
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' });
  if (status.trim()) {
    throw new Error(`${label} 的工作区不干净，先提交或 stash 再同步：\n${status}`);
  }
  const staged = new Set(listFiles(stagingDir));
  const onlyInRepo = listFiles(repo).filter(f => !staged.has(f));
  if (onlyInRepo.length) {
    console.warn(`⚠ ${label} 有 ${onlyInRepo.length} 个文件不在同步产物里，全量替换会删除它们：`);
    for (const f of onlyInRepo.slice(0, 25)) console.warn(`    - ${f}`);
    if (onlyInRepo.length > 25) console.warn(`    …另有 ${onlyInRepo.length - 25} 个`);
    console.warn('  （删掉后仍可用 git 恢复；如需长期保留，请先把它加进同步脚本的映射）');
  }
  // git rm 而不是 rm -rf：删的是 git 跟踪的文件，.git 与未跟踪文件不受影响，且可 checkout 恢复
  execFileSync('git', ['rm', '-rq', '.'], { cwd: repo, stdio: 'ignore' });
  copyTree(stagingDir, repo);
  execFileSync('git', ['add', '-A'], { cwd: repo });
  const after = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' });
  return after.split('\n').filter(Boolean);
}

module.exports = {
  ROOT, SRC, SHARED_FILES, TEST_FILES, EXPECTED_ASSERTIONS,
  copyTree, listFiles, generate, selfCheck, verifyInIsolation, applyToRepo
};
