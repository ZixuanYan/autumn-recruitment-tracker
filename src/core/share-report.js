/*__SHARE_REPORT_START__*/
// 只读分享快照：不携带网址、行动、日程、邮件、简历或同步信息，也不执行脚本。
(function (root) {
  'use strict';
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function day(value) { const s = String(value || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '未填写'; }
  function stageRank(value) {
    const list = (root.AJA && root.AJA.STAGE_PRESETS) || [];
    const i = list.indexOf(String(value || '')); return i < 0 ? 9000 : i;
  }
  function groupsOf(list, includeMissing) {
    if (typeof groupRecordsByCompany === 'function') {
      const grouped = groupRecordsByCompany(list);
      if (!includeMissing) return grouped;
      const members = new Set(grouped.flatMap(group => group.records));
      return grouped.concat(list.filter(record => !members.has(record)).map(record => ({ label: '未填写公司', records: [record] })));
    }
    return list.map(record => ({ label: String(record.company || '未填写'), records: [record] }));
  }
  function currentStage(record) { return String(record && record.stage || '待投递').trim() || '待投递'; }
  function active(record) { return !['待投递', 'Offer', '已结束'].includes(currentStage(record)); }
  function timelineStages(record) {
    const tl = Array.isArray(record && record.timeline) ? record.timeline : [];
    return (tl.length ? tl : [{ stage: currentStage(record) }]).map(item => String(item.stage || ''));
  }
  function cityParts(value) {
    return String(value || '').split(/[\/、,，|;；]+/).map(v => v.trim()).filter(v => v && !/^(待确认|待定|待补充|待完善|未知|不限|无|none|n\/a|-)$/i.test(v));
  }
  function buildShareReport(records, options = {}) {
    const list = Array.isArray(records) ? records.filter(Boolean).map(r => ({ ...r })) : [];
    const exportedAt = String(options.exportedAt || new Date().toISOString());
    const appVersion = String(options.appVersion || '');
    const groups = groupsOf(list);
    const stageCounts = new Map();
    list.forEach(r => stageCounts.set(currentStage(r), (stageCounts.get(currentStage(r)) || 0) + 1));
    const stages = [...stageCounts.entries()].sort((a, b) => stageRank(a[0]) - stageRank(b[0]) || a[0].localeCompare(b[0], 'zh-CN'));
    const funnel = [
      ['投递', r => true],
      ['笔试 / 测评', r => timelineStages(r).some(s => ['测评', '笔试', '机试'].includes(s))],
      ['面试', r => timelineStages(r).some(s => s.includes('面'))],
      ['Offer', r => currentStage(r) === 'Offer']
    ].map(([label, test]) => [label, list.filter(test).length]);
    const cityStats = typeof computeCityStats === 'function' ? computeCityStats(list) : [];
    const cities = cityStats.map(row => ({ name: row.city || '未填写', count: row.total, offers: row.offers || 0 }));
    const namedCities = cities.filter(row => row.name !== '未填写').slice(0, 8);
    const otherRows = cities.filter(row => row.name !== '未填写').slice(8);
    const otherCount = otherRows.reduce((sum, row) => sum + row.count, 0);
    const otherOffers = otherRows.reduce((sum, row) => sum + row.offers, 0);
    if (otherCount) namedCities.push({ name: '其他', count: otherCount, offers: otherOffers });
    const unknownCity = cities.find(row => row.name === '未填写');
    if (unknownCity) namedCities.push(unknownCity);
    const companyTypes = ['央国企', '私企', '外企', '未设置'];
    const typeStats = typeof computeCompanyTypeStats === 'function' ? computeCompanyTypeStats(list) : [];
    const typeCounts = Object.fromEntries(companyTypes.map(type => [type, (typeStats.find(row => row.label === type) || {}).total || 0]));
    const sorted = list.slice().sort((a, b) => day(b.applicationDate).localeCompare(day(a.applicationDate)) || Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    const sortedGroups = groupsOf(sorted, true);
    const rowNumbers = new Map(sorted.map((record, index) => [record, index + 1]));
    const metric = (label, value) => `<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
    const bars = stages.length ? stages.map(([name, count]) => `<div class="bar-row"><span>${esc(name)}</span><b>${count}</b><i><em style="width:${Math.round(count / Math.max(1, list.length) * 100)}%"></em></i></div>`).join('') : '<p class="muted">暂无阶段数据</p>';
    const funnelHtml = funnel.map(([name, count], i) => `<div class="funnel"><span>${esc(name)}</span><strong>${count}</strong><small>${i ? `${Math.round(count / Math.max(1, list.length) * 100)}%` : '基准'}</small></div>`).join('');
    const cityMax = Math.max(1, ...namedCities.map(row => row.count));
    const cityHtml = namedCities.length ? namedCities.map(row => `<li class="city-row"><span class="city-name">${esc(row.name)}</span><span class="city-bar"><i style="width:${Math.round(row.count / cityMax * 100)}%"></i><em style="width:${Math.round(row.offers / cityMax * 100)}%"></em></span><b>${row.count}</b><small>${row.offers ? `Offer ${row.offers}` : '—'}</small></li>`).join('') : '<li>未填写 <b>0</b></li>';
    const typeTotal = Math.max(1, list.length);
    const typeBar = companyTypes.map(type => `<i class="type-seg type-${esc(type)}" style="width:${(typeCounts[type] / typeTotal * 100).toFixed(2)}%"></i>`).join('');
    const typeLegend = companyTypes.map(type => `<li><span><i class="type-dot type-${esc(type)}"></i>${esc(type)}</span><b>${typeCounts[type]} 条</b></li>`).join('');
    const typeHtml = `<div class="type-bar">${typeBar}</div><ul class="type-list">${typeLegend}</ul>`;
    const rows = sortedGroups.map(group => {
      const stageSummary = [...group.records.reduce((map, record) => map.set(currentStage(record), (map.get(currentStage(record)) || 0) + 1), new Map())]
        .sort((a, b) => stageRank(a[0]) - stageRank(b[0]))
        .map(([stage, count]) => `<small class="stage company-stage">${esc(stage)}${count > 1 ? ` × ${count}` : ''}</small>`).join('');
      const companyType = group.records.map(record => String(record.companyType || '').trim()).find(Boolean);
      const head = `<tr class="company-head"><th colspan="6"><div class="company-title"><span>${esc(group.label || '未填写公司')}${companyType ? ` <small class="tag">${esc(companyType)}</small>` : ''}</span><span class="company-meta">${group.records.length} 个岗位</span></div><div class="company-stages">${stageSummary}</div></th></tr>`;
      const body = group.records.map(r => {
        const tl = Array.isArray(r.timeline) ? r.timeline : [];
        const done = tl.length && tl[tl.length - 1].done === true;
        return `<tr><td data-label="编号">${rowNumbers.get(r)}</td><td data-label="机构">${esc(r.orgUnit || '—')}</td><td data-label="岗位">${esc(r.position || '未填写')}</td><td data-label="城市">${esc(r.city || '未填写')}</td><td data-label="投递日期">${esc(day(r.applicationDate))}</td><td data-label="当前阶段"><span class="stage">${esc(currentStage(r))}</span>${done ? ' <small class="done">已完成</small>' : ''}</td></tr>`;
      }).join('');
      return `<tbody class="company-group">${head}${body}</tbody>`;
    }).join('');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"><title>秋招投递进展报告</title><style>
      :root{color-scheme:light;--ink:#202124;--muted:#6b7280;--line:#e5e7eb;--soft:#f5f7fa;--accent:#356ae6;--ok:#34c759;--ct-soe:#c93400;--ct-private:#0071e3;--ct-foreign:#177e89;--ct-none:#6e6e73}*{box-sizing:border-box}body{margin:0;background:#f6f7f9;color:var(--ink);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}.page{max-width:1100px;margin:0 auto;padding:36px 24px 48px}.hero{background:#fff;border:1px solid var(--line);border-radius:18px;padding:28px 30px;margin-bottom:18px}.eyebrow{color:var(--accent);font-size:12px;letter-spacing:.12em;font-weight:700}.hero h1{margin:5px 0 4px;font-size:28px}.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:18px 0}.metric,.card{background:#fff;border:1px solid var(--line);border-radius:14px}.metric{padding:16px}.metric span{display:block;color:var(--muted);font-size:12px}.metric strong{display:block;font-size:25px;margin-top:3px}.two{display:grid;grid-template-columns:1fr 1fr;gap:18px}.card{padding:20px;margin-bottom:18px}.card h2{font-size:16px;margin:0 0 14px}.bar-row{display:grid;grid-template-columns:minmax(80px,1fr) 36px 2fr;gap:10px;align-items:center;margin:9px 0}.bar-row b,.funnel strong,.city-list b,.type-list b{font-variant-numeric:tabular-nums}.bar-row i{height:8px;background:#edf0f5;border-radius:99px;overflow:hidden}.bar-row em{display:block;height:100%;background:var(--accent);border-radius:99px}.funnel-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.funnel{background:var(--soft);padding:12px;border-radius:10px}.funnel span,.funnel small{display:block;color:var(--muted)}.funnel strong{font-size:22px;display:block}.funnel small{font-size:11px}.city-list,.type-list{list-style:none;padding:0;margin:0}.city-list li,.type-list li{border-bottom:1px solid var(--line);padding:7px 0}.city-row{display:grid;grid-template-columns:minmax(60px,auto) minmax(0,1fr) 30px 58px;align-items:center;gap:9px}.city-bar{position:relative;display:block;height:7px;border-radius:99px;background:#edf0f5;overflow:hidden}.city-bar i,.city-bar em{position:absolute;left:0;top:0;bottom:0;border-radius:inherit}.city-bar i{background:var(--accent);opacity:.28}.city-bar em{background:var(--ok)}.city-row small{color:var(--muted);font-size:11px;text-align:right;white-space:nowrap}.type-bar{display:flex;height:10px;border-radius:99px;background:#f0f1f3;overflow:hidden;margin-bottom:9px}.type-seg{display:block;height:100%;min-width:3px}.type-seg.type-央国企,.type-dot.type-央国企{background:var(--ct-soe)}.type-seg.type-私企,.type-dot.type-私企{background:var(--ct-private)}.type-seg.type-外企,.type-dot.type-外企{background:var(--ct-foreign)}.type-seg.type-未设置,.type-dot.type-未设置{background:var(--ct-none)}.type-list li{display:flex;justify-content:space-between}.type-list li span{display:flex;align-items:center;gap:7px}.type-dot{display:inline-block;width:8px;height:8px;border-radius:50%}.table-wrap{overflow:auto}.records{width:100%;border-collapse:collapse}.records th,.records td{text-align:left;padding:10px 9px;border-bottom:1px solid var(--line);vertical-align:top}.records th{font-size:12px;color:var(--muted);font-weight:600}.company-head th{padding:15px 10px 9px;background:#f7f8fb;border-top:10px solid #fff;color:var(--ink)}.company-title{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:14px;font-weight:700}.company-meta{color:var(--muted);font-size:12px;font-weight:500}.company-stages{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}.company-stage{font-weight:500}.stage,.tag,.done{display:inline-block;border-radius:99px;padding:1px 8px;background:#eef2ff;color:#3158ad;font-size:12px}.tag{background:#f1f3f5;color:#5f6368}.done{background:#e7f6ec;color:#238445}.footer{color:var(--muted);font-size:12px;margin-top:20px}.empty{padding:40px;text-align:center}.report-card{break-inside:avoid}
      @media(max-width:700px){.page{padding:18px 12px 30px}.hero{padding:22px 18px}.hero h1{font-size:23px}.grid{grid-template-columns:repeat(2,1fr)}.two{grid-template-columns:1fr}.funnel-row{grid-template-columns:repeat(2,1fr)}.records thead{display:none}.records,.records tbody,.records tr,.records td{display:block;width:100%}.records tr{padding:11px 0;border-bottom:1px solid var(--line)}.records .company-head{padding:0;border:0}.records .company-head th{display:block;width:100%;border-top:10px solid #fff}.records td{border:0;padding:2px 0 2px 92px;min-height:25px;position:relative}.records td:before{content:attr(data-label);position:absolute;left:0;color:var(--muted);font-size:12px}.records td:first-child{display:none}}
      @media print{body{background:#fff}.page{max-width:none;padding:0}.hero,.metric,.card{border-color:#d7dbe2;box-shadow:none}.records thead{display:table-header-group}.records tr{break-inside:avoid}.company-head{break-after:avoid}.card{break-inside:avoid}}
    </style></head><body><main class="page"><section class="hero"><div class="eyebrow">AUTUMN RECRUITMENT · STATIC SNAPSHOT</div><h1>秋招投递进展报告</h1><div class="muted">生成于 ${esc(exportedAt)} · 版本 ${esc(appVersion || '未标注')} · 本报告只读，不会随原台账更新</div></section>${list.length ? `<section class="grid">${metric('投递记录', list.length)}${metric('覆盖公司', groups.length)}${metric('进行中', list.filter(active).length)}${metric('Offer', list.filter(r => currentStage(r) === 'Offer').length)}${metric('已结束', list.filter(r => currentStage(r) === '已结束').length)}</section><section class="two"><div class="card report-card"><h2>当前阶段分布</h2>${bars}</div><div class="card report-card"><h2>转化漏斗</h2><div class="funnel-row">${funnelHtml}</div></div></section><section class="two"><div class="card report-card"><h2>城市分布</h2><ul class="city-list">${cityHtml}</ul><p class="muted">多城市岗位会在各城市分别计数。</p></div><div class="card report-card"><h2>企业性质</h2><ul class="type-list">${typeHtml}</ul></div></section><section class="card report-card"><h2>全部投递记录 <span class="muted">（${list.length} 条 · 按企业收纳）</span></h2><div class="table-wrap"><table class="records"><thead><tr><th>编号</th><th>机构</th><th>岗位</th><th>城市</th><th>投递日期</th><th>当前阶段</th></tr></thead>${rows}</table></div></section>` : '<section class="card empty"><h2>暂无可导出的投递记录</h2><p class="muted">请先在台账中添加投递记录。</p></section>'}<div class="footer">生成时间：${esc(exportedAt)} · 共 ${list.length} 条记录 · 本文件为离线静态快照</div></main></body></html>`;
  }
  root.buildShareReport = buildShareReport;
})(typeof globalThis !== 'undefined' ? globalThis : this);
/*__SHARE_REPORT_END__*/
