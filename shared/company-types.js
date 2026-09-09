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
 *
 * v4.11.0：第二档从「民企」改名为「私企」（口语里更常用，且能自然容纳互联网 / 车企这些子类）。
 * 改名对封闭枚举来说是**破坏性**的：用户已有记录里存的还是旧值，白名单一校验就落回「未设置」，
 * 洞察统计静默少一档、徽章静默变灰。所以配一张 `COMPANY_TYPE_ALIASES` 做**读时迁移**，
 * 而不是写时批量改写 —— 记录分散在 localStorage / IndexedDB 快照 / 云端 envelope 三处，
 * 批量改写要同时动三处且不可回滚；读时归一化只在 `normalizeRecord` 一处，旧备份导入时同样生效。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // Node
  root.AJA = Object.assign(root.AJA || {}, api);                                // 浏览器 / 插件
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';

  const COMPANY_TYPES = ['央国企', '私企', '外企'];

  // 旧值 → 新值。**值必须都在 COMPANY_TYPES 里**（test/web-check.js 有守卫盯着）：
  // 迁到一个非法值等于没迁 —— 紧接着的白名单校验会把它打回「未设置」，而且不报错。
  const COMPANY_TYPE_ALIASES = { '民企': '私企', '民营企业': '私企', '民营': '私企' };

  // 「未设置」是下拉的固定首项，value=''。解析器**从不猜**企业性质
  // （页面上没有可靠依据，猜错比留空更糟），所以收录时始终由用户手动选一次。
  const COMPANY_TYPE_UNSET = '未设置';

  return { COMPANY_TYPES, COMPANY_TYPE_UNSET, COMPANY_TYPE_ALIASES };
});
