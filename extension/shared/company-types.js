/**
 * 企业性质枚举 —— 全项目唯一事实源
 *
 * 两端消费：网页版 `index.html`（`const COMPANY_TYPES = AJA.COMPANY_TYPES;`）与
 * 浏览器插件（`extension/shared/company-types.js` 生成拷贝；`common/constants.js` 不再写字面量）。
 * mail-sync Action 不用它（企业性质不由邮件解析产出）。
 *
 * 注意：这是**封闭枚举**，不像阶段那样允许自定义。网页端 `normalizeRecord` 做白名单校验：
 * 不在 `COMPANY_TYPES` 里的值一律归为「未设置」。所以多写或写错一个字，用户选了也等于没选
 * （静默落回未设置），且洞察里的企业性质统计永远缺这一档——这正是此前要靠
 * `test/extension-bridge.js` 的逐值一致性断言来防的事，现在结构上不可能漂移了。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // Node
  root.AJA = Object.assign(root.AJA || {}, api);                                // 浏览器 / 插件
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';

  const COMPANY_TYPES = ['央国企', '民企', '外企'];

  // 「未设置」是下拉的固定首项，value=''。解析器**从不猜**企业性质
  // （页面上没有可靠依据，猜错比留空更糟），所以收录时始终由用户手动选一次。
  const COMPANY_TYPE_UNSET = '未设置';

  return { COMPANY_TYPES, COMPANY_TYPE_UNSET };
});
