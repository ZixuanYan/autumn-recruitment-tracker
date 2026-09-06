/**
 * 秋招求职与简历助手 - 公共归一化模块（公司名 / 岗位名）
 * 全端共享：content scripts 由 manifest 注入，background service worker 用 importScripts 加载。
 * 挂载到全局命名空间 AJA，不使用 export，保证加载环境通用（与 constants.js 同款写法）。
 *
 * ⚠️ 本文件是网页版 autumn-recruitment-tracker/index.html 中
 *    companyGroupKey / sameCompanyGroup / normalizePositionSlug / loosePositionSlug
 *    的**镜像副本**，两处必须同步修改。autumn-mail-sync/test/company-dedup.js 有一条
 *    跨实现一致性断言：两边对同一批样例的输出必须逐值相同，漂移即测试失败。
 *
 * 为什么需要它：暂存箱去重（background.js）此前用「公司名与岗位名原文精确相等」，
 * 与网页端的归一化判定不一致 ——「腾讯」与「腾讯 」（尾空格）、「腾讯」与「腾讯科技（深圳）有限公司」
 * 都会在暂存箱里堆成两条，推给网页端时要逐条弹窗确认。
 */
(() => {
  'use strict';
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.AJA = root.AJA || {};

  // 法人形式后缀（可循环剥离，如「××集团有限公司」→「××」）；**不含行业词**。
  // 刻意保守：保留「科技 / 互娱 / 智能」这类行业词，否则「星海科技」与「星海互娱」会被并成一家。
  const LEGAL_SUFFIX_RE = /(股份有限公司|有限责任公司|集团有限公司|有限公司|股份公司|集团|公司|股份|co\.,?ltd\.?|inc\.?|ltd\.?|corp\.?|llc)+$/i;

  // 公司归一键：镜像 index.html 的 companyGroupKey(record)，入参改为直接收公司名字符串。
  // 顺序必须一致：先 trim 原文 → 全角 ASCII 转半角 → 去括号标点空白 → 小写 → 循环剥法人后缀；
  // 兜底返回的是**未做全角转换**的原文小写（与网页端一致）。
  function companyKey(company) {
    const raw = String(company == null ? '' : company).trim();
    if (!raw) return '';
    let key = raw
      .replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/[（）()[\]【】·・,，.。、\-—_\s]/g, '')
      .toLowerCase();
    let prev = null;
    while (key !== prev && key.length > 2) { prev = key; key = key.replace(LEGAL_SUFFIX_RE, ''); }
    return key || raw.toLowerCase();
  }

  // 岗位归一键：镜像 index.html 的 normalizePositionSlug。
  // **保留括号内容** —— 括号里常是城市 / iOS-Android / 校招社招 / 提前批正式批，
  // 是同一家公司多个岗位的关键区分维度；删掉会让两条独立投递撞成同名，第二个岗位就录不进去。
  function positionKey(position) {
    return String(position == null ? '' : position)
      .replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  // 岗位宽松键：镜像 index.html 的 loosePositionSlug。
  // 再去掉括号与连字符后缀，**只用于「疑似同岗位不同方向」提示，绝不能用于判重**。
  function loosePositionKey(position) {
    return positionKey(position).replace(/[（(][^）)]*[）)]/g, '').replace(/[-—|·_~].*$/, '');
  }

  // 两个**已归一化的键**是否属于同一家公司：镜像 index.html 的 sameCompanyGroup。
  // 语义 = 相等或互相包含，与网页端 groupRecordsByCompany 的聚类完全一致。
  function sameCompanyKey(keyA, keyB) {
    const a = String(keyA == null ? '' : keyA);
    const b = String(keyB == null ? '' : keyB);
    if (!a || !b) return false;
    if (a === b) return true;
    return a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a));
  }

  // 便捷版：直接收两个公司名原文
  function sameCompany(companyA, companyB) {
    return sameCompanyKey(companyKey(companyA), companyKey(companyB));
  }

  root.AJA.companyKey = companyKey;
  root.AJA.positionKey = positionKey;
  root.AJA.loosePositionKey = loosePositionKey;
  root.AJA.sameCompanyKey = sameCompanyKey;
  root.AJA.sameCompany = sameCompany;
})();
