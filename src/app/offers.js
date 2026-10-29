      // ================= Offer 页面（v4.37.0） =================
      if (!offerRules) offerRules = loadOfferRules();
      if (!offerRules.updatedAt) saveOfferRules();
      // 本文件在 core 之后执行：把 bootstrap 早期载入的旧记录再过一遍 Offer 归一化，
      // 兼容首屏启动时 core 尚未初始化的加载顺序。
      records = records.map(normalizeRecord);
      let offerFilterStatus = 'all';
      let offerFilterCity = 'all';
      let offerFilterType = 'all';
      let offerSortMode = 'score';
      let selectedOfferIds = new Set();
      let editingOfferId = '';

      function offerStatusLabel(status) { return OFFER_STATUS_LABELS[String(status || '')] || '待决定'; }
      function offerStatusClass(status) { return `offer-status-${String(status || 'pending').replace(/_/g, '-')}`; }
      function offerCompensationText(offer) {
        const c = offer && offer.compensation ? offer.compensation : {};
        if (c.mode === 'total') return c.totalPackage ? `${c.totalPackage} 元 / 年总包` : '总包未填写';
        if (c.mode === 'confidential') return '密薪';
        if (c.monthlySalary && c.salaryMonths) return `${c.monthlySalary} 元/月 × ${c.salaryMonths} 薪`;
        if (c.monthlySalary) return `${c.monthlySalary} 元/月`;
        return '薪资未填写';
      }
      function offerScoreText(record) {
        const result = computeOfferScore(record.offer, offerRules);
        return result.score == null ? '暂未评分' : `${result.score.toFixed(1)} / 10 · ${result.rated}/${result.total}`;
      }
      function offerFilteredRecords() {
        let list = getOfferRecords(records);
        if (offerFilterStatus !== 'all') list = list.filter(record => record.offer && record.offer.status === offerFilterStatus);
        if (offerFilterCity !== 'all') list = list.filter(record => String(record.city || '') === offerFilterCity);
        if (offerFilterType !== 'all') list = list.filter(record => String(record.companyType || '') === offerFilterType);
        return sortOfferRecords(list, offerSortMode, offerRules);
      }
      function offerFilterOptions(list) {
        const cities = [...new Set(list.map(record => String(record.city || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
        const types = [...new Set(list.map(record => String(record.companyType || '').trim()).filter(Boolean))];
        const select = (id, options, value, allLabel) => {
          const el = $(id); if (!el) return;
          el.innerHTML = `<option value="all">${allLabel}</option>${options.map(item => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('')}`;
          el.value = options.includes(value) ? value : 'all';
        };
        select('#offerCityFilter', cities, offerFilterCity, '全部城市');
        select('#offerTypeFilter', types, offerFilterType, '全部企业性质');
      }
      function renderOfferSummary(list) {
        const stats = {
          total: list.length,
          pending: list.filter(r => r.offer?.status === 'pending').length,
          intent: list.filter(r => r.offer?.status === 'intent_signed').length,
          contract: list.filter(r => r.offer?.status === 'contract_signed').length,
          rejected: list.filter(r => r.offer?.status === 'rejected').length,
          rated: list.filter(r => computeOfferScore(r.offer, offerRules).score != null).length
        };
        for (const [id, value] of Object.entries({ offerTotal: stats.total, offerPending: stats.pending, offerIntentSigned: stats.intent, offerContractSigned: stats.contract, offerRejected: stats.rejected, offerRated: stats.rated })) {
          const el = $(`#${id}`); if (el) el.textContent = value;
        }
        const best = sortOfferRecords(list, 'score', offerRules).find(record => computeOfferScore(record.offer, offerRules).score != null);
        const bestEl = $('#offerBestScore');
        if (bestEl) bestEl.textContent = best ? `${best.company} · ${computeOfferScore(best.offer, offerRules).score.toFixed(1)}` : '—';
      }
      function renderOffersView() {
        const host = $('#offerList');
        if (!host) return;
        // runtime.js 会在本文件执行前完成首屏 render；这里惰性初始化，
        // 避免带有历史 Offer 的用户首屏进入 /offers 时读到空规则或未归一化记录。
        if (!offerRules) offerRules = loadOfferRules();
        records = records.map(normalizeRecord);
        const all = getOfferRecords(records);
        offerFilterOptions(all);
        const list = offerFilteredRecords();
        renderOfferSummary(all);
        const selected = [...selectedOfferIds].filter(id => list.some(record => record.id === id));
        selectedOfferIds = new Set(selected);
        const compare = $('#offerCompareHint');
        if (compare) compare.textContent = selected.length ? `已选择 ${selected.length} 个 Offer${selected.length > 4 ? '（建议最多选择 4 个）' : ''}` : '勾选 2～4 个 Offer 可重点对比';
        if (!list.length) {
          host.innerHTML = '<div class="empty"><div class="empty-icon">🏆</div><h3>还没有 Offer</h3><p>把投递记录推进到 Offer 后，这里会自动出现对应记录。</p></div>';
          const comparePanel = $('#offerComparePanel'); if (comparePanel) comparePanel.hidden = true;
          return;
        }
        const criteria = offerRules.criteria.filter(item => item.enabled);
        host.innerHTML = `<div class="table-scroll offer-table-scroll"><table class="offer-table"><thead><tr><th>对比</th><th>公司 / 岗位</th><th>城市</th><th>状态</th><th>薪资</th><th>综合分</th>${criteria.map(item => `<th>${escapeHtml(item.label)}</th>`).join('')}<th>操作</th></tr></thead><tbody>${list.map(record => {
          const score = computeOfferScore(record.offer, offerRules);
          const selectedClass = selectedOfferIds.has(record.id) ? ' is-selected' : '';
          return `<tr class="offer-row${selectedClass}" data-offer-id="${escapeHtml(record.id)}"><td data-label="对比"><input type="checkbox" class="offer-select" data-offer-select="${escapeHtml(record.id)}"${selectedOfferIds.has(record.id) ? ' checked' : ''} aria-label="选择 ${escapeHtml(record.company)}"></td><td data-label="公司 / 岗位"><strong>${escapeHtml(record.company || '未填写公司')}</strong>${record.orgUnit ? `<span class="offer-unit"> · ${escapeHtml(record.orgUnit)}</span>` : ''}<div class="offer-position">${escapeHtml(record.position || '未填写岗位')}</div></td><td data-label="城市">${escapeHtml(record.city || '未填写')}</td><td data-label="状态"><span class="offer-status ${offerStatusClass(record.offer?.status)}">${escapeHtml(offerStatusLabel(record.offer?.status))}</span></td><td data-label="薪资">${escapeHtml(offerCompensationText(record.offer))}</td><td data-label="综合分"><strong>${score.score == null ? '—' : score.score.toFixed(1)}</strong><small class="offer-score-meta">${score.rated}/${score.total}</small></td>${criteria.map(item => `<td data-label="${escapeHtml(item.label)}">${record.offer?.ratings?.[item.id] ? `${escapeHtml(record.offer.ratings[item.id])}/10` : '—'}</td>`).join('')}<td data-label="操作"><button class="btn btn-small btn-primary" type="button" data-offer-action="edit" data-offer-id="${escapeHtml(record.id)}">编辑</button></td></tr>`;
        }).join('')}</tbody></table></div>`;
        renderOfferCompare(list);
      }
      function renderOfferCompare(list) {
        const panel = $('#offerComparePanel'), host = $('#offerCompareList');
        if (!panel || !host) return;
        const selected = [...selectedOfferIds].map(id => list.find(record => record.id === id)).filter(Boolean).slice(0, 4);
        if (selected.length < 2) { panel.hidden = true; host.innerHTML = ''; return; }
        const criteria = offerRules.criteria.filter(item => item.enabled);
        host.innerHTML = `<div class="offer-compare-grid">${selected.map(record => {
          const score = computeOfferScore(record.offer, offerRules);
          const ratings = criteria.map(item => `<div class="offer-compare-line"><span>${escapeHtml(item.label)}</span><b>${record.offer?.ratings?.[item.id] ? `${escapeHtml(record.offer.ratings[item.id])}/10` : '—'}</b></div>`).join('');
          return `<article class="offer-compare-card"><div class="offer-compare-company"><strong>${escapeHtml(record.company || '未填写公司')}</strong><span>${escapeHtml(record.position || '未填写岗位')}</span></div><div class="offer-compare-line"><span>城市 / 企业性质</span><b>${escapeHtml(record.city || '未填写')} · ${escapeHtml(record.companyType || '未设置')}</b></div><div class="offer-compare-line"><span>状态</span><b>${escapeHtml(offerStatusLabel(record.offer?.status))}</b></div><div class="offer-compare-line"><span>薪资</span><b>${escapeHtml(offerCompensationText(record.offer))}</b></div><div class="offer-compare-line"><span>综合分</span><b>${score.score == null ? '暂未评分' : `${score.score.toFixed(1)} / 10`}</b></div>${ratings}<div class="offer-compare-note">${escapeHtml(record.offer?.compensation?.note || '暂无备注')}</div></article>`;
        }).join('')}</div>`;
        panel.hidden = false;
      }
      function openOfferDialog(id) {
        const record = records.find(item => item.id === id);
        if (!record || !record.offer) return;
        editingOfferId = id;
        const offer = normalizeOffer(record.offer, true);
        $('#offerDialogTitle').textContent = `${record.company} · ${record.position || '未填写岗位'}`;
        $('#offerStatusInput').value = offer.status;
        $('#offerCompensationMode').value = offer.compensation.mode;
        $('#offerMonthlySalary').value = offer.compensation.monthlySalary;
        $('#offerSalaryMonths').value = offer.compensation.salaryMonths;
        $('#offerTotalPackage').value = offer.compensation.totalPackage;
        $('#offerNoteInput').value = offer.compensation.note;
        renderOfferCompensationFields();
        const facts = $('#offerSourceFacts');
        if (facts) {
          const timeline = Array.isArray(record.timeline) ? record.timeline : [];
          const timelineHtml = timeline.length
            ? `<div class="offer-source-timeline">${timeline.map(item => `<span class="offer-source-milestone"><b>${escapeHtml(item.stage || '未填写阶段')}</b><small>${escapeHtml(item.at || '未填写日期')}${item.done ? ' · 已完成' : ''}</small></span>`).join('')}</div>`
            : '<div class="offer-source-timeline muted-text">暂无阶段时间线</div>';
          facts.innerHTML = `<div>${escapeHtml(record.company || '未填写公司')} · ${escapeHtml(record.position || '未填写岗位')} · ${escapeHtml(record.city || '未填写')} · ${escapeHtml(record.companyType || '企业性质未设置')}</div><div class="offer-source-meta">投递日期：${escapeHtml(record.applicationDate || '未填写')} · 当前阶段：${escapeHtml(record.stage || '—')}</div>${timelineHtml}<button class="btn btn-small offer-source-link" type="button" data-offer-view-record="${escapeHtml(record.id)}">查看投递记录</button>`;
        }
        const grid = $('#offerRatingGrid');
        if (grid) grid.innerHTML = offerRules.criteria.filter(item => item.enabled).map(item => `<label class="offer-rating-field"><span>${escapeHtml(item.label)}</span><input class="control" type="number" min="1" max="10" step="1" data-offer-rating="${escapeHtml(item.id)}" value="${offer.ratings[item.id] || ''}" placeholder="1-10"></label>`).join('');
        const score = computeOfferScore(offer, offerRules);
        $('#offerDialogScore').textContent = score.score == null ? '暂未评分' : `${score.score.toFixed(1)} / 10（${score.rated}/${score.total} 项）`;
        $('#offerDialog').showModal();
      }
      function renderOfferCompensationFields() {
        const mode = $('#offerCompensationMode')?.value || 'monthly';
        const monthly = $('#offerMonthlyFields'), months = $('#offerSalaryMonthsFields'), total = $('#offerTotalFields');
        if (monthly) monthly.hidden = mode !== 'monthly';
        if (months) months.hidden = mode !== 'monthly';
        if (total) total.hidden = mode !== 'total';
      }
      function saveOfferDialog() {
        const record = records.find(item => item.id === editingOfferId);
        if (!record) return;
        const offer = normalizeOffer(record.offer, true);
        offer.status = $('#offerStatusInput').value;
        offer.compensation = {
          mode: $('#offerCompensationMode').value,
          monthlySalary: $('#offerMonthlySalary').value.trim(), salaryMonths: $('#offerSalaryMonths').value.trim(),
          totalPackage: $('#offerTotalPackage').value.trim(), note: $('#offerNoteInput').value.trim()
        };
        offer.ratings = {};
        document.querySelectorAll('[data-offer-rating]').forEach(input => {
          const value = Number(input.value);
          if (Number.isFinite(value) && value >= 1 && value <= 10) offer.ratings[input.dataset.offerRating] = Math.round(value);
        });
        offer.updatedAt = new Date().toISOString();
        record.offer = normalizeOffer(offer, true);
        record.updatedAt = Date.now();
        saveRecords('Offer 信息已保存');
        $('#offerDialog').close();
        editingOfferId = '';
        renderOffersView();
      }
      function openOfferRulesDialog() {
        const host = $('#offerRulesList');
        if (!host) return;
        host.innerHTML = offerRules.criteria.map((item, index) => `<div class="offer-rule-row" data-rule-index="${index}" data-rule-id="${escapeHtml(item.id)}"><input class="control" data-rule-label value="${escapeHtml(item.label)}" maxlength="30"><input class="control offer-rule-weight" data-rule-weight type="number" min="0.1" max="100" step="0.1" value="${item.weight}"><label class="offer-rule-enabled"><input type="checkbox" data-rule-enabled${item.enabled ? ' checked' : ''}>启用</label><span class="offer-rule-actions"><button class="text-button" type="button" data-rule-up aria-label="上移评分项">上移</button><button class="text-button" type="button" data-rule-down aria-label="下移评分项">下移</button><button class="text-button danger" type="button" data-rule-delete>删除</button></span></div>`).join('');
        $('#offerRulesDialog').showModal();
      }
      function saveOfferRulesFromDialog() {
        const criteria = [];
        const seen = new Set();
        document.querySelectorAll('#offerRulesList .offer-rule-row').forEach((row, index) => {
          const label = row.querySelector('[data-rule-label]')?.value.trim();
          const old = offerRules.criteria.find(item => item.id === row.dataset.ruleId);
          const id = old?.id || row.dataset.ruleId || `criterion-${Date.now()}-${index}`;
          if (!label || seen.has(id)) return;
          seen.add(id);
          const weight = Number(row.querySelector('[data-rule-weight]')?.value);
          criteria.push({ id, label, weight: Number.isFinite(weight) && weight > 0 ? weight : 1, enabled: !!row.querySelector('[data-rule-enabled]')?.checked });
        });
        offerRules = normalizeOfferRules({ criteria, updatedAt: new Date().toISOString() });
        saveOfferRules();
        $('#offerRulesDialog').close();
        renderOffersView();
        showToast(`评分规则已更新，已重新计算 ${getOfferRecords(records).length} 个 Offer`);
      }
      function resetOfferRules() {
        offerRules = normalizeOfferRules(DEFAULT_OFFER_RULES);
        saveOfferRules();
        openOfferRulesDialog();
      }
