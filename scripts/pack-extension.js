#!/usr/bin/env node
/**
 * 插件打包脚本：同步 shared/ 生成拷贝 + 重打包 zip
 *
 * 为什么需要它：Chrome 扩展**只能加载扩展目录内的文件**，而插件又是独立打 zip 分发的
 * （用户"加载已解压的扩展程序"选的是 extension/ 目录）。所以仓库根的 shared/ 既不能被
 * manifest 的 content_scripts 引用（`../shared/` 逃出扩展根，Chrome 拒绝加载），
 * 也不在 zip 里。唯一可行的是「根目录单一源 + 生成拷贝进 extension/shared/」。
 *
 * 生成拷贝的最大风险是与源漂移（那等于又回到两份副本）。本脚本 + 同源守卫测试
 * （test/extension-ui.js 断言两边逐字节相同）共同消除它：改完 shared/ 跑一次本脚本，
 * 拷贝与 zip 一起更新；忘了跑，守卫会红。
 *
 * 刻意**不给生成物加任何注释头**（比如"本文件为生成物，请勿直接修改"）——
 * 加了就没法做逐字节断言，而"剥掉首行注释后再比"会给守卫开口子（真实改动可以藏进注释头）。
 * 生成物的身份由 extension/README.md 与守卫本身说明。
 *
 * 运行：node scripts/pack-extension.js          同步 + 打包
 *      node scripts/pack-extension.js --sync-only  只同步（开发时加载已解压扩展用）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SHARED_SRC = path.join(ROOT, 'shared');
const SHARED_DST = path.join(ROOT, 'extension', 'shared');
const ZIP = path.join(ROOT, 'downloads', 'autumn-assistant-extension.zip');

// 只有这四个是跨端共享的。extension/common/ 里的 constants.js / tokens.js / icons.js /
// capture-form.js 是**插件专有**（TRACKER_URL、MSG 协议、设计令牌、收录表单模板），
// 网页版与 Action 用不到，搬进 shared/ 只会制造新耦合。
const SHARED_FILES = ['stages.js', 'company-types.js', 'company-key.js', 'default-resume.js'];

function syncShared() {
  if (!fs.existsSync(SHARED_SRC)) {
    console.error(`✗ 找不到 ${path.relative(ROOT, SHARED_SRC)}/，本脚本必须在仓库根运行`);
    process.exit(1);
  }
  fs.mkdirSync(SHARED_DST, { recursive: true });
  let copied = 0;
  for (const f of SHARED_FILES) {
    const src = path.join(SHARED_SRC, f);
    if (!fs.existsSync(src)) {
      console.error(`✗ shared/${f} 不存在——若已改名，请同步更新本脚本的 SHARED_FILES、`
        + `manifest.json 的 content_scripts、panel/panel.html 的 script、background.js 的 importScripts，`
        + `以及 test/extension-ui.js 的同源守卫`);
      process.exit(1);
    }
    fs.copyFileSync(src, path.join(SHARED_DST, f));
    copied += 1;
  }
  // 反向检查：extension/shared/ 里不该有 SHARED_FILES 之外的东西（残留会让守卫与 zip 都带上死文件）
  const extra = fs.readdirSync(SHARED_DST).filter(f => !SHARED_FILES.includes(f));
  if (extra.length) {
    console.error(`✗ extension/shared/ 里有多余文件：${extra.join(', ')}（源目录已删但拷贝没清）`);
    process.exit(1);
  }
  console.log(`✓ 同步 shared/ → extension/shared/（${copied} 个文件，逐字节拷贝、无注释头）`);
  return copied;
}

function packZip() {
  if (!fs.existsSync(path.join(ROOT, 'extension', 'manifest.json'))) {
    console.error('✗ extension/manifest.json 不存在');
    process.exit(1);
  }
  // -FS（filesync）是必须的：zip 的默认追加语义**不会删除**源目录里已消失的条目。
  // 上一轮就踩过——用 `zip -r` 更新已有的包，结果包内仍残留已删除的 05-sidebar.js 与
  // 02-resume.js，下载包与仓库不一致，用户排查问题时看到两个 sidebar 文件会被误导。
  fs.mkdirSync(path.dirname(ZIP), { recursive: true });
  execFileSync('zip', ['-r', '-q', '-FS', path.relative(ROOT, ZIP), 'extension',
    '-x', '*.DS_Store', '-x', 'extension/*.zip'], { cwd: ROOT, stdio: 'inherit' });

  // 打完立刻校验：包内必须含 shared 四件与 manifest 引用的每个文件，且不含已删除的旧文件
  const list = execFileSync('unzip', ['-l', ZIP], { cwd: ROOT, encoding: 'utf8' });
  const missing = [];
  for (const f of SHARED_FILES) {
    if (!list.includes(`extension/shared/${f}`)) missing.push(`extension/shared/${f}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8'));
  for (const f of manifest.content_scripts[0].js) {
    if (!list.includes(`extension/${f}`)) missing.push(`extension/${f}`);
  }
  if (manifest.side_panel && !list.includes(`extension/${manifest.side_panel.default_path}`)) {
    missing.push(`extension/${manifest.side_panel.default_path}`);
  }
  const stale = ['extension/content/02-resume.js', 'extension/content/05-sidebar.js',
    'extension/common/company-key.js', 'extension/common/default-resume.js']
    .filter(f => list.includes(f));
  if (missing.length || stale.length) {
    if (missing.length) console.error(`✗ zip 里缺 ${missing.length} 个必需文件：${missing.join(', ')}`);
    if (stale.length) console.error(`✗ zip 里残留 ${stale.length} 个已删除文件：${stale.join(', ')}`);
    process.exit(1);
  }
  const size = fs.statSync(ZIP).size;
  console.log(`✓ 重打包 ${path.relative(ROOT, ZIP)}（${size} 字节，含 shared 四件，无残留旧文件）`);
}

syncShared();
if (!process.argv.includes('--sync-only')) packZip();
