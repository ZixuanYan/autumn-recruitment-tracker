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

  // 关键时间类型（v4.19.0）。一条记录可以有**多个**时间，且必须分类——
  // 此前只有单一 scheduleAt（安排）+ deadline（签约截止）两个字段，"确定的面试时间"与
  // "截止时间"只能靠字段区分，笔试/面试时间又和"最近安排"混在一处。
  // 现在每个时间是一条事件 { id, type, at, allDay }，type 取这里的枚举：
  //   截止     = 必须赶的硬期限 —— 网申/测评/笔试/签约截止
  //   面试     = 已确定的面试
  //   笔试测评 = 已确定的笔试 / 测评 / 机试
  //   其他     = 宣讲会、资料提交等兜底
  // type 只是**展示标签**；语义上的两类分界由 timeEventKind 给出（截止 = deadline，其余 = start）。
  const TIME_EVENT_TYPES = ['截止', '面试', '笔试测评', '其他'];
  // 「截止」在代码里被单独判定（倒计时 / 逾期提醒 / ICS 标题），故给出具名常量，
  // 免得各处散落 '截止' 字面量——将来改类型名漏改一处，就会静默退化成「其他」。
  const TIME_EVENT_DEADLINE = TIME_EVENT_TYPES[0];
  // 两类语义（v4.24.0）：截止 = 必须赶的期限，开始 = 到点要参加的事。界面按它分组显示。
  function timeEventKind(type) {
    return String(type || '').trim() === TIME_EVENT_DEADLINE ? 'deadline' : 'start';
  }
  // v4.24.0：全天与否**不再由类型决定**，而是每条事件自己的数据 —— `at` 含 'T' 是定时
  //（精确到分），只有日期就是全天。此前「截止」被硬编码成全天（TIME_EVENT_ALL_DAY），
  // 于是邮件里写清的「9 月 17 日 18:00 前」无处安放、手填的时刻会被静默截掉；
  // 现在判定只按 at 走（sanitizeEvents / collectEvents 各一处），共享端不再提供按类型的开关。
  // 非法/缺失类型一律归到「其他」，避免自由文本污染分桶（与 companyType 的白名单同源思路）
  function normalizeTimeEventType(type) {
    const t = String(type || '').trim();
    return TIME_EVENT_TYPES.includes(t) ? t : '其他';
  }

  return { STAGE_PRESETS, TIME_EVENT_TYPES, TIME_EVENT_DEADLINE, timeEventKind, normalizeTimeEventType };
});
