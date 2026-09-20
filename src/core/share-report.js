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
      const head = `<summary class="company-head"><div class="company-title"><span>${esc(group.label || '未填写公司')}${companyType ? ` <small class="tag">${esc(companyType)}</small>` : ''}</span><span class="company-meta">${group.records.length} 个岗位</span></div><div class="company-stages">${stageSummary}</div></summary>`;
      const body = group.records.map(r => {
        const tl = Array.isArray(r.timeline) ? r.timeline : [];
        const done = tl.length && tl[tl.length - 1].done === true;
        return `<tr><td data-label="编号">${rowNumbers.get(r)}</td><td data-label="机构">${esc(r.orgUnit || '—')}</td><td data-label="岗位">${esc(r.position || '未填写')}</td><td data-label="城市">${esc(r.city || '未填写')}</td><td data-label="投递日期">${esc(day(r.applicationDate))}</td><td data-label="当前阶段"><span class="stage">${esc(currentStage(r))}</span>${done ? ' <small class="done">已完成</small>' : ''}</td></tr>`;
      }).join('');
      return `<details class="company-group" open>${head}<div class="company-table"><table><thead><tr><th>编号</th><th>机构</th><th>岗位</th><th>城市</th><th>投递日期</th><th>当前阶段</th></tr></thead><tbody>${body}</tbody></table></div></details>`;
    }).join('');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-share-report-controls-v1'; base-uri 'none'"><title>秋招投递进展报告</title><style>
      .report-controls{display:flex;justify-content:flex-end;align-items:center;gap:7px;margin:-2px 0 10px;color:var(--muted);font-size:12px}.report-control-btn{border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:7px;padding:4px 9px;font:inherit;cursor:pointer}.report-control-btn:hover{border-color:var(--accent);color:var(--accent)}.report-control-btn:disabled{opacity:.45;cursor:default}.company-group{background:#fff;border:1px solid var(--line);border-radius:12px;margin:10px 0;overflow:hidden}.company-group summary{list-style:none;cursor:pointer}.company-group summary::-webkit-details-marker{display:none}.company-group summary:before{content:'⌄';display:inline-block;width:18px;color:var(--accent);transition:transform .15s ease}.company-group:not([open]) summary:before{transform:rotate(-90deg)}.company-head{padding:14px 16px;background:#f7f8fb}.company-table{padding:0 10px 6px}.company-table table{width:100%;border-collapse:collapse}.company-table th,.company-table td{text-align:left;padding:9px;border-bottom:1px solid var(--line);vertical-align:top}.company-table th{font-size:12px;color:var(--muted);font-weight:600}.company-group:last-child{margin-bottom:0}
      @media(max-width:700px){.page{padding:18px 12px 30px}.hero{padding:22px 18px}.hero h1{font-size:23px}.grid{grid-template-columns:repeat(2,1fr)}.two{grid-template-columns:1fr}.funnel-row{grid-template-columns:repeat(2,1fr)}.company-table{overflow:auto}.company-table table{min-width:650px}.company-title{align-items:flex-start}.city-row{grid-template-columns:minmax(52px,auto) minmax(0,1fr) 28px 52px}}
      @media print{body{background:#fff}.page{max-width:none;padding:0}.hero,.metric,.card,.company-group{border-color:#d7dbe2;box-shadow:none}.company-group{break-inside:avoid}.company-table{display:block!important}}
      @media(max-width:700px){.page{padding:18px 12px 30px}.hero{padding:22px 18px}.hero h1{font-size:23px}.grid{grid-template-columns:repeat(2,1fr)}.two{grid-template-columns:1fr}.funnel-row{grid-template-columns:repeat(2,1fr)}.records thead{display:none}.records,.records tbody,.records tr,.records td{display:block;width:100%}.records tr{padding:11px 0;border-bottom:1px solid var(--line)}.records .company-head{padding:0;border:0}.records .company-head th{display:block;width:100%;border-top:10px solid #fff}.records td{border:0;padding:2px 0 2px 92px;min-height:25px;position:relative}.records td:before{content:attr(data-label);position:absolute;left:0;color:var(--muted);font-size:12px}.records td:first-child{display:none}}
      @media print{body{background:#fff}.page{max-width:none;padding:0}.hero,.metric,.card{border-color:#d7dbe2;box-shadow:none}.records thead{display:table-header-group}.records tr{break-inside:avoid}.company-head{break-after:avoid}.card{break-inside:avoid}}
    </style></head><body><main class="page"><section class="hero"><div class="eyebrow">AUTUMN RECRUITMENT · STATIC SNAPSHOT</div><h1>秋招投递进展报告</h1><div class="muted">生成于 ${esc(exportedAt)} · 版本 ${esc(appVersion || '未标注')} · 本报告只读，不会随原台账更新</div></section>${list.length ? `<section class="grid">${metric('投递记录', list.length)}${metric('覆盖公司', groups.length)}${metric('进行中', list.filter(active).length)}${metric('Offer', list.filter(r => currentStage(r) === 'Offer').length)}${metric('已结束', list.filter(r => currentStage(r) === '已结束').length)}</section><section class="two"><div class="card report-card"><h2>当前阶段分布</h2>${bars}</div><div class="card report-card"><h2>转化漏斗</h2><div class="funnel-row">${funnelHtml}</div></div></section><section class="two"><div class="card report-card"><h2>城市分布</h2><ul class="city-list">${cityHtml}</ul><p class="muted">多城市岗位会在各城市分别计数。</p></div><div class="card report-card"><h2>企业性质</h2>${typeHtml}</div></section><section class="card report-card"><div class="company-title"><h2>全部投递记录 <span class="muted">（${list.length} 条 · 按企业收纳）</span></h2><div class="report-controls"><button id="expandAllBtn" class="report-control-btn" type="button">全部展开</button><button id="collapseAllBtn" class="report-control-btn" type="button">全部合并</button></div></div><p class="muted">点击企业标题可展开或合并该企业的岗位</p><div class="table-wrap">${rows}</div></section>` : '<section class="card empty"><h2>暂无可导出的投递记录</h2><p class="muted">请先在台账中添加投递记录。</p></section>'}<div class="footer">生成时间：${esc(exportedAt)} · 共 ${list.length} 条记录 · 本文件为离线静态快照</div></main><script nonce="share-report-controls-v1">(()=>{const groups=[...document.querySelectorAll('.company-group')];const expand=document.querySelector('#expandAllBtn');const collapse=document.querySelector('#collapseAllBtn');const sync=()=>{if(!groups.length)return;expand.disabled=groups.every(group=>group.open);collapse.disabled=groups.every(group=>!group.open)};expand?.addEventListener('click',()=>{groups.forEach(group=>{group.open=true});sync()});collapse?.addEventListener('click',()=>{groups.forEach(group=>{group.open=false});sync()});groups.forEach(group=>group.addEventListener('toggle',sync));sync()})()<\/script></body></html>`;
  }
  root.buildShareReport = buildShareReport;
})(typeof globalThis !== 'undefined' ? globalThis : this);
/*__SHARE_REPORT_END__*/
