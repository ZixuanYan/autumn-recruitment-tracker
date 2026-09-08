#!/usr/bin/env node
/**
 * 私有运行实例同步：把 monorepo 的 services/mail-sync/ 同步到**实际在跑定时任务**的
 * 私有仓库 `ZixuanYan/autumn-mail-sync`。
 *
 * 与 sync-template.js 的映射与改写完全相同（共用 scripts/lib/sync-core.js），差别只有：
 *   - README 顶部的 banner 文案（说明这是运行实例而非供人 fork 的模板）
 *   - 输出目录 staging-private/
 *   - 本脚本会额外提醒你「这是生产环境」：它每 12 小时跑一次真实邮件同步，
 *     同步后必须手动 dispatch 一次验证，别等下一次定时任务才发现崩了
 *
 * ⚠️ 为什么这个仓库要保持私有（不并进公开的 monorepo 跑）：
 * Action 的运行日志在公开仓库里**任何人可看、不需要登录**，而当前代码会把
 * 每封被丢弃邮件的**发件人地址与主题**打进日志（index.js 的丢弃行、connectivity-test
 * 的最近 3 封预览），还会打印你的预筛关键词。这些信息足以推断你在投哪些公司、进度如何。
 * 同样的明细其实已经写进你自己的私有 Gist（meta.lastDropped.recent），网页端「邮件提醒」
 * 状态栏展开就能看，所以真要搬去公开仓库跑，得先做日志脱敏 + 一条守卫盯住不许加回来。
 * 本轮决定不搬，保持私有。
 *
 * Secrets 不受同步影响：QQ 授权码 / AI Key / GIST_PAT 存在 GitHub 侧（Settings → Secrets），
 * 不在仓库文件里，全量替换代码不会动它们。
 *
 * 运行：
 *   node scripts/sync-private.js                 生成 staging-private/ + 隔离目录验证
 *   node scripts/sync-private.js --apply <dir>   额外把产物全量替换进 <dir>（已 clone 的私有仓库）
 */
'use strict';

const path = require('path');
const core = require('./lib/sync-core');

const STAGING = path.join(core.ROOT, 'staging-private');
const BANNER = '> 本仓库是 monorepo `autumn-recruitment-tracker` 里 `services/mail-sync/` 的**同步产物**'
  + '（这是实际跑定时任务的运行实例），由 `scripts/sync-private.js` 生成。'
  + '请勿直接在此修改——改动会在下次同步时被覆盖；要改代码请改 monorepo 的 `services/mail-sync/` 再跑同步。'
  + '\n>\n> 本仓库必须保持 **private**：Secrets 与运行日志都在这里，而日志含邮件发件人与主题。';

try {
  const stats = core.generate({ outDir: STAGING, banner: BANNER, label: 'private' });
  console.log('✓ staging-private/ 生成完毕（目标：私有运行实例）');
  console.log(`  src/ ${stats.srcFiles} 个文件 · workflow ${stats.wfFiles} 个（已在仓库根）· shared ${core.SHARED_FILES.length} 个 · test ${core.TEST_FILES.length} 个`);
  console.log(`  改写：测试路径 ${stats.testPaths} 处 · shared require 层级 ${stats.requireLevel} 处 · `
    + `test 脚本 → ${stats.testScript} · 版本 ${stats.version} · README 链接 ${stats.readmeLink} 处`);
  console.log('✓ 产物自检通过：无 monorepo 路径残留、shared require 恰好一层、不依赖 tracker 仓库');

  const passed = core.verifyInIsolation(STAGING, 'private');
  console.log(`✓ 隔离目录 npm test 通过，${passed} 项（= run.js 54 + integration.js 10）`);

  const applyIdx = process.argv.indexOf('--apply');
  if (applyIdx > -1) {
    const repoDir = process.argv[applyIdx + 1];
    if (!repoDir) { console.error('✗ --apply 需要目标仓库路径'); process.exit(1); }
    const changes = core.applyToRepo({ stagingDir: STAGING, repoDir, label: '私有运行实例' });
    console.log(`\n✓ 已全量替换 ${path.resolve(repoDir)}（${changes.length} 项变更）`);
    for (const c of changes.slice(0, 30)) console.log(`    ${c}`);
    if (changes.length > 30) console.log(`    …另有 ${changes.length - 30} 项`);
    console.log('\n🔴 这是**生产环境**（每 12 小时跑真实邮件同步），推送后请务必：');
    console.log('   1. git commit + git push');
    console.log('   2. 立刻手动 dispatch 一次 mail-sync 验证：');
    console.log('      gh workflow run mail-sync.yml -R ZixuanYan/autumn-mail-sync');
    console.log('      （别等下一次定时任务才发现崩了；cron 在高峰期还会延迟 2-4 小时）');
    console.log('   3. 看运行日志确认 lastUid 水位正常推进、没有 MODULE_NOT_FOUND');
    console.log('   4. 回网页端「邮件提醒」点「重新读取」，确认建议仍在');
    console.log('   注：UID 水位存在 Gist 的 meta 里、不在仓库，所以同步不会触发全量重扫。');
  } else {
    console.log('\n（未指定 --apply，只生成 staging-private/ 供 review；本脚本不推送）');
  }
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
