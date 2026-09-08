/**
 * 公司名 / 岗位名归一化 —— 全项目唯一事实源
 *
 * 此前存在**两份签名不同的实现**：网页版 `index.html` 的
 * `companyGroupKey(record)` / `sameCompanyGroup` / `normalizePositionSlug` / `loosePositionSlug`
 * （收 record 对象），与插件侧独立模块（原 `extension/common/company-key.js`，已随本次合并删除）的
 * `companyKey(company)` / `sameCompanyKey` / `positionKey` / `loosePositionKey`（收字符串）。
 * 逻辑等价、名字与入参不同，靠 `test/company-dedup.js` 的 22 项断言钉住"两边对同一批样例
 * 输出逐值相同"。现在合并为一份核心实现 + 两套薄封装，**两端调用点零改动**。
 *
 * 消费方：
 * - 网页版：`index.html` 里 `const companyGroupKey = AJA.companyGroupKey;` 等四行转发别名
 * - 插件：`background.js` 的 importScripts 加载 `extension/shared/company-key.js`（生成拷贝），
 *   暂存箱去重 `findDuplicateRecord` 用 `AJA.companyKey` / `AJA.positionKey` / `AJA.loosePositionKey`
 * - Action：不用（邮件同步不做公司归一化）
 *
 * 为什么需要归一化：暂存箱去重此前用「公司名与岗位名原文精确相等」，与网页端判定不一致——
 * 「腾讯」与「腾讯 」（尾空格）、「腾讯」与「腾讯科技（深圳）有限公司」会堆成两条，
 * 推给网页端时要逐条弹窗确认。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // Node
  root.AJA = Object.assign(root.AJA || {}, api);                                // 浏览器 / 插件
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';

  // 法人形式后缀（可循环剥离，如「××集团有限公司」→「××」）；**不含行业词**。
  // 刻意保守：保留「科技 / 互娱 / 智能」这类行业词，否则「星海科技」与「星海互娱」会被并成一家。
  // 旧版有个激进的 normalizeCompanySlug 连行业词也剥，已退役（它只还服务于邮件建议的模糊匹配）。
  const LEGAL_SUFFIX_RE = /(股份有限公司|有限责任公司|集团有限公司|有限公司|股份公司|集团|公司|股份|co\.,?ltd\.?|inc\.?|ltd\.?|corp\.?|llc)+$/i;

  // 空值收敛统一用 `|| ''`（网页版语义）。插件旧实现用的是 `== null ? '' : x`，
  // 两者只在传入 0 / false 这类 falsy 非空值时有别——公司名与岗位名现实中不会是它们，
  // 选网页版语义是因为网页端才是数据入库与判重的权威（normalizeRecord / findDuplicateRecord）。
  const str = (v) => String(v || '');

  /**
   * 公司归一键（核心实现，收字符串）。
   * 顺序**必须**保持：先 trim 原文 → 全角 ASCII 转半角 → 去括号标点空白 → 小写 → 循环剥法人后缀。
   * 兜底返回的是**未做全角转换**的原文小写——这是刻意与旧网页端保持一致的，
   * 剥到空时宁可给个粗键也不要返回 ''（返回空串会让该记录在聚类里被整个丢掉）。
   */
  function companyKey(company) {
    const raw = str(company).trim();
    if (!raw) return '';
    let key = raw
      .replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/[（）()[\]【】·・,，.。、\-—_\s]/g, '')
      .toLowerCase();
    let prev = null;
    while (key !== prev && key.length > 2) { prev = key; key = key.replace(LEGAL_SUFFIX_RE, ''); }
    return key || raw.toLowerCase();
  }

  /**
   * 岗位归一键：全半角统一、去空白、小写。
   * **保留括号内容** —— 括号里常是城市 / iOS-Android / 校招社招 / 提前批正式批，
   * 是同一家公司多个岗位的关键区分维度。旧版这里有一行 `.replace(/[（(][^）)]*[）)]/g,'')`
   * 把括号整块删掉，导致「后端（深圳）」与「后端（北京）」撞成同名被判重复；
   * 而岗位库与插件两条路径当时都是硬拦截、没有逃生口 → 第二个岗位根本录不进去。
   */
  function positionKey(position) {
    return str(position)
      .replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  /**
   * 岗位宽松键：再去掉括号与连字符后缀。
   * **只用于「疑似同岗位不同方向」提示，绝不能用于判重**——用它判重就会重演上面那个
   * 「第二个岗位录不进去」的事故。
   */
  function loosePositionKey(position) {
    return positionKey(position).replace(/[（(][^）)]*[）)]/g, '').replace(/[-—|·_~].*$/, '');
  }

  /**
   * 两个**已归一化的键**是否属于同一家公司：相等或互相包含（腾讯 ⊂ 腾讯科技深圳）。
   * 查重与展示必须共用它，否则会出现自相矛盾：实证过「字节 / 字节跳动」展示合并但查重放行
   * （重复记录被美化成「一家 2 个岗位」），而「小米科技 / 小米智能」展示分成两家却被查重判为重复
   * （两家不同公司被合并）。
   */
  function sameCompanyKey(keyA, keyB) {
    const a = str(keyA), b = str(keyB);
    if (!a || !b) return false;
    if (a === b) return true;
    return a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a));
  }

  // 便捷版：直接收两个公司名原文
  function sameCompany(companyA, companyB) {
    return sameCompanyKey(companyKey(companyA), companyKey(companyB));
  }

  // ---- 网页版调用点用的名字与签名（转发到上面的核心实现，**不是第二份实现**）----
  // 保留这四个别名是为了让 index.html 里几十处调用点零改动；test/company-dedup.js
  // 有别名守卫断言它们确实 === 核心实现，防止将来又有人复制一份出来。
  function companyGroupKey(record) {
    return companyKey((record && record.company) || '');
  }
  const normalizePositionSlug = positionKey;
  const loosePositionSlug = loosePositionKey;
  const sameCompanyGroup = sameCompanyKey;

  return {
    LEGAL_SUFFIX_RE,
    // 字符串入参（插件 background 与外部调用）
    companyKey, positionKey, loosePositionKey, sameCompanyKey, sameCompany,
    // 网页版签名（record 入参 / 旧名字）
    companyGroupKey, normalizePositionSlug, loosePositionSlug, sameCompanyGroup
  };
});
