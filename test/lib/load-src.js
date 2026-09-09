/**
 * 按 src/bundle.js 的清单加载拆分后的源码，供各套测试使用。
 *
 * 存在的理由：阶段 3 之前，测试是用 extractBlock / extractFunction 从 6892 行的
 * index.html 里**按文本**抠出函数体（花括号配平算法，注释里记着踩过的坑：默认参数写成
 * `options = {}` 时 `indexOf('{')` 会命中默认值里的 `{`，配平后只返回 56 字符的签名）。
 * 拆分之后已入库的模块直接按文件读，那套配平算法在已拆模块上就不再需要了。
 *
 * 🔴 清单必须来自 src/bundle.js，**不得在测试里另写一份顺序**：两边各写一份就会漂移，
 * 漂移后测试测的不再是上线的那份代码——那比没有测试更糟（绿灯是假的）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const BUNDLE = require(path.join(SRC, 'bundle.js'));

const read = (rel) => {
  const p = path.join(SRC, rel);
  if (!fs.existsSync(p)) throw new Error(`src/${rel} 不存在（bundle.js 清单里有、磁盘上没有）`);
  return fs.readFileSync(p, 'utf8');
};

function moduleFiles(name) {
  const entry = BUNDLE.app.find(e => typeof e === 'object' && e.module === name);
  if (!entry) throw new Error(`src/bundle.js 的 app 清单里没有 module: ${name}`);
  return entry.files;
}

const joinFiles = (files) => files.map(read).join('');

// 模块标记行在产物里已被模块内容替换，所以 app/ 三段单独取时要剥掉它们。
// 标记顶格（0 缩进），带缩进的话那几个空格会残留进产物——见 build.js 的 splice 说明。
const stripModuleMarkers = (text) => text.replace(/^\/\*__MODULE:[a-z0-9]+__\*\/\n/gm, '');

module.exports = {
  ROOT, SRC, BUNDLE, read, moduleFiles, joinFiles,
  /** CORE_PURE 那 531 行（6 个文件），含首尾的 __CORE_PURE_START__/END__ 标记行（都是注释，沙箱执行无害） */
  coreSrc: joinFiles(moduleFiles('core')),
  /** MAIL_PURE 那 140 行，完全自洽（10 个函数只调用彼此与内置方法） */
  mailSrc: joinFiles(moduleFiles('mail')),
  /** CSS 两层：基础层 + Apple 覆盖层 */
  stylesSrc: joinFiles(BUNDLE.styles),
  /** 剩余 DOM 层（尚未细分的三段），已剥掉模块标记行 */
  appSrc: stripModuleMarkers(BUNDLE.app.filter(e => typeof e === 'string').map(read).join('')),
  /** 完整内联 JS，与产物 index.html 里 <script> 的内容一致 */
  get inlineJs() {
    let app = BUNDLE.app.filter(e => typeof e === 'string').map(read).join('');
    for (const e of BUNDLE.app) {
      if (typeof e !== 'object') continue;
      app = app.split(`/*__MODULE:${e.module}__*/\n`).join(joinFiles(e.files));
    }
    return app;
  }
};
