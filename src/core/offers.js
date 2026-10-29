      // ===== Offer 独立管理与评分（v4.37.0） =====
      const OFFER_STATUS_VALUES = ['pending', 'intent_signed', 'contract_signed', 'rejected'];
      const OFFER_STATUS_LABELS = {
        pending: '待决定', intent_signed: '意向已签', contract_signed: '合同协议已签', rejected: '已拒绝'
      };
      const OFFER_COMPENSATION_MODES = ['monthly', 'total', 'confidential'];
      const OFFER_COMPENSATION_LABELS = { monthly: '月薪 × 薪资月数', total: '总包', confidential: '密薪' };
      const DEFAULT_OFFER_RULES = {
        criteria: [
          { id: 'compensation', label: '薪资待遇', weight: 1, enabled: true },
          { id: 'fit', label: '岗位匹配', weight: 1, enabled: true },
          { id: 'growth', label: '发展空间', weight: 1, enabled: true },
          { id: 'location', label: '城市与地点', weight: 1, enabled: true },
          { id: 'stability', label: '稳定性', weight: 1, enabled: true },
          { id: 'workload', label: '工作强度', weight: 1, enabled: true }
        ]
      };
      function defaultOffer() {
        return { status: 'pending', compensation: { mode: 'monthly', monthlySalary: '', salaryMonths: '', totalPackage: '', note: '' }, ratings: {}, updatedAt: '' };
      }
      function normalizeOffer(value, shouldCreate = false) {
        if (!value || typeof value !== 'object') return shouldCreate ? defaultOffer() : null;
        const rawStatus = String(value.status || '').trim();
        const status = OFFER_STATUS_VALUES.includes(rawStatus) ? rawStatus : 'pending';
        const source = value.compensation && typeof value.compensation === 'object' ? value.compensation : {};
        const mode = OFFER_COMPENSATION_MODES.includes(String(source.mode || '')) ? String(source.mode) : 'monthly';
        const ratings = {};
        const sourceRatings = value.ratings && typeof value.ratings === 'object' ? value.ratings : {};
        Object.keys(sourceRatings).slice(0, 100).forEach(id => {
          const n = Number(sourceRatings[id]);
          if (Number.isFinite(n) && n >= 1 && n <= 10) ratings[String(id).slice(0, 80)] = Math.round(n * 10) / 10;
        });
        return {
          status,
          compensation: {
            mode,
            monthlySalary: String(source.monthlySalary ?? '').trim().slice(0, 30),
            salaryMonths: String(source.salaryMonths ?? '').trim().slice(0, 12),
            totalPackage: String(source.totalPackage ?? '').trim().slice(0, 30),
            note: String(source.note ?? '').trim().slice(0, 1000)
          },
          ratings,
          updatedAt: String(value.updatedAt || '').trim()
        };
      }
      function normalizeOfferRules(value) {
        const source = value && typeof value === 'object' ? value : {};
        const list = Array.isArray(source.criteria) ? source.criteria : DEFAULT_OFFER_RULES.criteria;
        const criteria = [];
        const seen = new Set();
        list.slice(0, 30).forEach((item, index) => {
          const id = String(item && item.id || `criterion-${index + 1}`).trim().slice(0, 80);
          const label = String(item && item.label || '').trim().slice(0, 30);
          if (!id || !label || seen.has(id)) return;
          seen.add(id);
          const weight = Number(item && item.weight);
          criteria.push({ id, label, weight: Number.isFinite(weight) && weight > 0 ? Math.min(100, weight) : 1, enabled: item.enabled !== false });
        });
        return {
          criteria: criteria.length ? criteria : DEFAULT_OFFER_RULES.criteria.map(item => ({ ...item })),
          updatedAt: String(source.updatedAt || '').trim()
        };
      }
      function getOfferRecords(list) {
        return (Array.isArray(list) ? list : []).filter(record => record && (record.offer || String(record.stage || '') === 'Offer'));
      }
      function computeOfferScore(offer, rules) {
        const clean = normalizeOffer(offer, false);
        const normalized = normalizeOfferRules(rules);
        if (!clean) return { score: null, rated: 0, total: normalized.criteria.filter(item => item.enabled).length };
        let weighted = 0, weight = 0, rated = 0;
        for (const item of normalized.criteria) {
          if (!item.enabled) continue;
          const value = Number(clean.ratings[item.id]);
          if (!Number.isFinite(value) || value < 1 || value > 10) continue;
          weighted += value * item.weight;
          weight += item.weight;
          rated += 1;
        }
        return { score: weight ? weighted / weight : null, rated, total: normalized.criteria.filter(item => item.enabled).length };
      }
      function computeOfferSalaryValue(offer) {
        const clean = normalizeOffer(offer, false);
        if (!clean) return null;
        const c = clean.compensation;
        if (c.mode === 'monthly') {
          const monthly = Number(c.monthlySalary), months = Number(c.salaryMonths);
          return Number.isFinite(monthly) && monthly >= 0 && Number.isFinite(months) && months > 0 ? monthly * months : null;
        }
        if (c.mode === 'total') {
          const total = Number(c.totalPackage);
          return Number.isFinite(total) && total >= 0 ? total : null;
        }
        return null;
      }
      function sortOfferRecords(list, sortMode = 'score', rules) {
        const normalized = normalizeOfferRules(rules);
        const items = (Array.isArray(list) ? list : []).slice();
        const scoreOf = record => computeOfferScore(record.offer || {}, normalized).score;
        const statusRank = { pending: 0, intent_signed: 1, contract_signed: 2, rejected: 3 };
        const updatedOf = record => String(record.offer?.updatedAt || record.updatedAt || '');
        const compareUpdated = (a, b) => {
          const av = updatedOf(a), bv = updatedOf(b);
          const an = Number(av), bn = Number(bv);
          if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return bn - an;
          return bv.localeCompare(av);
        };
        const compareCompany = (a, b) => String(a.company || '').localeCompare(String(b.company || ''), 'zh-CN')
          || String(a.position || '').localeCompare(String(b.position || ''), 'zh-CN');
        return items.sort((a, b) => {
          if (sortMode === 'salary') return (computeOfferSalaryValue(b.offer) ?? -1) - (computeOfferSalaryValue(a.offer) ?? -1)
            || (statusRank[a.offer?.status] ?? 9) - (statusRank[b.offer?.status] ?? 9) || compareCompany(a, b);
          if (sortMode === 'status') return (statusRank[a.offer?.status] ?? 9) - (statusRank[b.offer?.status] ?? 9) || compareCompany(a, b);
          if (sortMode === 'updated') return compareUpdated(a, b) || compareCompany(a, b);
          if (sortMode === 'company') return compareCompany(a, b);
          const sa = scoreOf(a), sb = scoreOf(b);
          const aRejected = a.offer?.status === 'rejected', bRejected = b.offer?.status === 'rejected';
          if (aRejected !== bRejected) return aRejected ? 1 : -1;
          if (sa == null && sb != null) return 1;
          if (sa != null && sb == null) return -1;
          if (sa != null && sb != null && sa !== sb) return sb - sa;
          return compareUpdated(a, b) || compareCompany(a, b);
        });
      }
