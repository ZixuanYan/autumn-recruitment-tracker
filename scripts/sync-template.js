#!/usr/bin/env node
/**
 * template 同步：把 monorepo 的 services/mail-sync/ 同步成公开模板仓库
 * `ZixuanYan/autumn-mail-sync-template` 的布局（给用户 fork 去跑自己的邮箱）。
 *
 * 映射与三类改写的完整说明见 scripts/lib/sync-core.js（两个目标共用那一份逻辑）。
 * 简要：① package.json 的 test 脚本只跑 run.js + integration.js（另外 7 个测试依赖仓库根的
 * index.html 与 extension/，独立仓库里跑必然 ENOENT——这正是 template 旧版 npm test 一跑就崩的原因）；
 * ② 测试文件去掉 monorepo 路径前缀（14 处）；③ src/config.js 的 shared require 从三层改为一层，
 * 并把 shared/ 四件一并拷过去（目标仓库本来没有这个目录）。
 *
 * 本脚本**不推送**。生成后请人工 review，再用 --apply 应用到已 clone 的仓库、自己 commit + push。
 *
 * 运行：
 *   node scripts/sync-template.js                 生成 staging/ + 隔离目录验证
 *   node scripts/sync-template.js --apply <dir>   额外把产物全量替换进 <dir>（已 clone 的 template 仓库）
 */
'use strict';

const path = require('path');
const core = require('./lib/sync-core');

const STAGING = path.join(core.ROOT, 'staging');
const BANNER = '> 本仓库是 monorepo `autumn-recruitment-tracker` 里 `services/mail-sync/` 的**同步产物**，'
  + '由 `scripts/sync-template.js` 生成。请勿直接在此修改——改动会在下次同步时被覆盖；'
  + '要改代码请改 monorepo 的 `services/mail-sync/`，再跑同步脚本。';

try {
  const stats = core.generate({ outDir: STAGING, banner: BANNER, label: 'template' });
  console.log('✓ staging/ 生成完毕（目标：公开 template 仓库）');
  console.log(`  src/ ${stats.srcFiles} 个文件 · workflow ${stats.wfFiles} 个（已提升到仓库根）· shared ${core.SHARED_FILES.length} 个 · test ${core.TEST_FILES.length} 个`);
  console.log(`  改写：测试路径 ${stats.testPaths} 处 · shared require 层级 ${stats.requireLevel} 处 · `
    + `test 脚本 → ${stats.testScript} · 版本 ${stats.version} · README 链接 ${stats.readmeLink} 处`);
  console.log('✓ 产物自检通过：无 monorepo 路径残留、shared require 恰好一层、不依赖 tracker 仓库');

  // 必须在 monorepo 之外验证：在里面跑会因路径逃逸到仓库根的 shared/ 而假绿（core 里有详细说明）
  const passed = core.verifyInIsolation(STAGING, 'template');
  console.log(`✓ 隔离目录 npm test 通过，${passed} 项（= run.js 54 + integration.js 10）`);

  const applyIdx = process.argv.indexOf('--apply');
  if (applyIdx > -1) {
    const repoDir = process.argv[applyIdx + 1];
    if (!repoDir) { console.error('✗ --apply 需要目标仓库路径'); process.exit(1); }
    const changes = core.applyToRepo({ stagingDir: STAGING, repoDir, label: 'template' });
    console.log(`\n✓ 已全量替换 ${path.resolve(repoDir)}（${changes.length} 项变更）`);
    for (const c of changes.slice(0, 30)) console.log(`    ${c}`);
    if (changes.length > 30) console.log(`    …另有 ${changes.length - 30} 项`);
    console.log('\n下一步（手动）：进目标仓库确认 git status → git commit → git push。');
    console.log('推送后按方案 T.4 验收：全新 clone 到空目录跑 npm test 应为 64 项。');
  } else {
    console.log('\n（未指定 --apply，只生成 staging/ 供 review；推送需手动执行）');
  }
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
