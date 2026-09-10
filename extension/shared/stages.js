/**
 * 阶段预设（14 档）—— 全项目唯一事实源（v4.9.0 / 插件 v5.1.0 起）
 *
 * 三端消费同一份：
 * - 网页版 `index.html`：`<script src="./shared/stages.js">` 挂到 `window.AJA`，
 *   内联脚本里写 `const STAGE_PRESETS = AJA.STAGE_PRESETS;`（转发别名，不再是字面量）
 * - 浏览器插件：`manifest.json` 的 content_scripts、`panel/panel.html` 的 script、
 *   `background.js` 的 importScripts 加载 `extension/shared/stages.js`（本文件的生成拷贝，
 *   由同源守卫断言与根目录这份逐字节相同）；`common/constants.js` 里 `AJA.STAGES = AJA.STAGE_PRESETS`
 * - mail-sync Action：`services/mail-sync/src/config.js` 用 `require('../../../shared/stages')`
 *
 * 为什么要有这个文件：此前 15 个阶段值散在三处字面量里（index.html / constants.js / config.js），
 * 靠注释「两处必须同步修改」和外部仓库的测试断言维持一致。谁改了网页版忘了改 Action，
 * Action 就会把「交叉面」判成非法阶段——而这个失败要等下一次邮件同步才暴露，中间没有任何信号。
 *
 * UMD 包装：同一份代码要能在浏览器全局、插件 isolated world、扩展页、Node require 四种环境里工作。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // Node
  root.AJA = Object.assign(root.AJA || {}, api);                                // 浏览器 / 插件
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';

  // 仅用于排序 / 推进建议 / 分布统计 / 配色。实际阶段**可自定义**：
  // 允许跳过笔试、支持三/四/五面、交叉面等；不在这 15 个里的阶段一律按 stageOrder() 的兜底排序。
  // AI面试 排在机试之后、一面之前：它是测评/笔试之后、真人面之前的自动化环节
  // （牛客/赛码一类 AI 视频面），有些企业会有这一步。加在这里即可全链路生效——
  // stageOrder 用 indexOf 排序、Action 的 allowedStages 与合法性校验都读这一份。
  const STAGE_PRESETS = ['待投递', '已投递', '测评', '笔试', '机试', 'AI面试', '一面', '二面', '三面', '四面', '五面', '交叉面', 'HR面', 'Offer', '已结束'];

  return { STAGE_PRESETS };
});
