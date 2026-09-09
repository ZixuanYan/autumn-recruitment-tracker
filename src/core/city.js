      // ----- 城市维度统计（v4.6.0）-----
      // 城市写法很脏：「深圳」/「深圳市」/「 上海 」/ 全角字母都可能出现，岗位库「记为已投递」
      // 还会写入默认值「待确认」。先归一化再分桶，否则同一座城市会裂成好几行、统计看着像算错了。
      const CITY_UNKNOWN_RE = /^(待确认|待定|待补充|待完善|未知|不限|无|none|n\/?a|-+)$/i;
      const CITY_SUFFIX_RE = /(特别行政区|自治区|市)$/;
      function normalizeCityKey(city) {
        const raw = String(city == null ? '' : city).trim();
        if (!raw) return '';
        // 与公司键同款归一化：全角 ASCII → 半角、去括号标点空白、latin 小写
        let key = raw
          .replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
          .replace(/[（）()[\]【】·・,，.。、\-—_\s]/g, '')
          .toLowerCase();
        if (!key || CITY_UNKNOWN_RE.test(key)) return ''; // 占位值等同「未填」，不给它单独开一桶
        // 循环剥行政后缀直到不再变化；用 key 非空做守卫，这样「市」这种纯后缀输入会归为未填而不是留下残骸
        let prev = null;
        while (key && key !== prev) { prev = key; key = key.replace(CITY_SUFFIX_RE, ''); }
        return key;
      }
      // 一条记录可能写了多个城市（「深圳/广州」「北京、上海」）：拆开各计一次。
      // 面板会明写这条口径，否则各城市投递数之和 > 台账条数会被当成算错。
      function cityKeysOf(record) {
        const raw = String((record && record.city) || '');
        if (!raw.trim()) return [];
        const out = [];
        for (const part of raw.split(/[\/、,，|;；]+/)) {
          const key = normalizeCityKey(part);
          if (key && !out.includes(key)) out.push(key);
        }
        return out;
      }
      // 城市统计 → [{ city, total, offers, offerRate, active, companies, records }]
      //   city === '' 是「未填 / 待确认」桶，固定排在最后，且不计入「覆盖 N 个城市」
      function computeCityStats(records) {
        const list = Array.isArray(records) ? records : [];
        const map = new Map();
        for (const record of list) {
          const keys = cityKeysOf(record);
          // 没填城市的记录也要进桶（''），否则「未填」这一行的投递/Offer 数会是假的 0
          for (const key of (keys.length ? keys : [''])) {
            if (!map.has(key)) map.set(key, { city: key, total: 0, offers: 0, active: 0, records: [] });
            const bucket = map.get(key);
            bucket.total += 1;
            if (record && record.stage === 'Offer') bucket.offers += 1;
            if (isActive(record)) bucket.active += 1;
            bucket.records.push(record);
          }
        }
        return [...map.values()]
          .map(bucket => ({
            city: bucket.city,
            total: bucket.total,
            offers: bucket.offers,
            offerRate: bucket.total ? bucket.offers / bucket.total : 0,
            active: bucket.active,
            // 公司数必须走 groupRecordsByCompany 的「互相包含」聚类，不能用键精确相等的 Set：
            // 否则「腾讯」与「腾讯科技」会被算成两家，与多岗位公司块、漏斗公司口径自相矛盾
            companies: groupRecordsByCompany(bucket.records).length,
            records: bucket.records
          }))
          .sort((a, b) => {
            if (!a.city !== !b.city) return a.city ? -1 : 1; // 未填桶永远最后
            return b.total - a.total || b.offers - a.offers || String(a.city).localeCompare(String(b.city), 'zh-CN');
          });
      }
      // 企业性质统计 → **固定 4 行**（三档 + 未设置），为 0 也出现。
      // 面板结构因此稳定，用户能分辨「这一档我一条都没有」和「这块没渲染出来」。
      function computeCompanyTypeStats(records) {
        const list = Array.isArray(records) ? records : [];
        const buckets = [...COMPANY_TYPES, ''].map(type => ({ type, total: 0, offers: 0, active: 0, records: [] }));
        for (const record of list) {
          const index = COMPANY_TYPES.indexOf(String((record && record.companyType) || '').trim());
          const bucket = buckets[index === -1 ? buckets.length - 1 : index]; // 非法/缺失一律落「未设置」
          bucket.total += 1;
          if (record && record.stage === 'Offer') bucket.offers += 1;
          if (isActive(record)) bucket.active += 1;
          bucket.records.push(record);
        }
        return buckets.map(bucket => ({
          type: bucket.type,
          label: bucket.type || COMPANY_TYPE_UNSET,
          total: bucket.total,
          offers: bucket.offers,
          offerRate: bucket.total ? bucket.offers / bucket.total : 0,
          active: bucket.active,
          companies: groupRecordsByCompany(bucket.records).length, // 同城市统计：走聚类口径，不用键精确相等
          records: bucket.records
        }));
      }

      // ----- 悬浮明细（v4.6.0）-----
      // 面板上只放结论（数字 / 比例条），明细放进悬浮层：这样块的高度不随记录数膨胀，
      // 又不用为了看清「深圳那 2 条到底是哪两条」再跳去台账搜索。
      // 指标口径必须能就地查：否则「停滞 >14 天 = 3」这种数字，用户没法判断它算的是投递日期还是最新里程碑。
      const TIP_METRIC_NOTES = {
        companies: '覆盖公司 = 按公司名聚类去重后的家数（「腾讯」与「腾讯科技（深圳）有限公司」算同一家）。',
        cities: '覆盖城市 = 归一化后的城市数（「深圳市」等同「深圳」）。一条记录写了多个城市时，会在每个城市各计一次，因此各城市投递数之和可能大于台账条数；「待确认 / 不限」这类占位值算未填。',
        flow: '在流程中 = 当前阶段不是「待投递 / Offer / 已结束」的记录数；平均天数按投递日期算到今天。',
        stalled: '停滞 = 仍在流程中，且最新一条里程碑（没有里程碑时按投递日期）距今 ≥14 天。',
        offers: '已拿 Offer = 当前阶段为 Offer 的记录数；占比按台账总条数计算。',
        alerts: '需要关注 = 截止逾期或 3 天内临期、安排时间已过但阶段没推进、停滞超 14 天、同公司多岗位同时在流程。同一条记录可能命中多项，所以这里的条数可能大于记录数。'
      };
      const TIP_MAX_ROWS = 12;
      // 返回 HTML 字符串（内部所有用户数据都经 escapeHtml）；无内容时返回 ''，调用方据此不显示浮层。
      // kind: 'city' 某城市的投递清单 | 'ctype' 某档企业性质的公司清单 | 'metric' 指标口径 | 'record' 单条记录摘要
      function tipContentFor(records, kind, key) {
        const list = Array.isArray(records) ? records : [];
        const value = String(key == null ? '' : key);
        if (kind === 'metric') {
          const note = TIP_METRIC_NOTES[value];
          return note ? `<div class="tip-note">${escapeHtml(note)}</div>` : '';
        }
        if (kind === 'record') {
          const record = list.find(item => String(item.id) === value);
          if (!record) return '';
          const rows = [
            ['公司', record.company],
            ['岗位', record.position || '未填岗位'],
            ['机构', record.orgUnit],
            ['城市', record.city],
            ['企业性质', record.companyType || COMPANY_TYPE_UNSET],
            ['当前阶段', record.stage],
            ['下一步', record.nextAction]
          ].filter(([, text]) => String(text || '').trim());
          return `<div class="tip-head">${escapeHtml(record.company || '未填公司')}</div>
            <div class="tip-list">${rows.map(([label, text]) => `<div class="tip-row"><span class="tip-k">${escapeHtml(label)}</span><span class="tip-v">${escapeHtml(text)}</span></div>`).join('')}</div>`;
        }
        if (kind === 'city') {
          const bucket = computeCityStats(list).find(row => row.city === value);
          if (!bucket || !bucket.total) return '';
          const title = bucket.city || '没填城市';
          const items = bucket.records.slice(0, TIP_MAX_ROWS).map(record => `
            <div class="tip-row"><span class="tip-v">${escapeHtml(record.company || '未填公司')} · ${escapeHtml(record.position || '未填岗位')}${record.orgUnit ? `（${escapeHtml(record.orgUnit)}）` : ''}</span><span class="badge badge-sm" data-stage="${escapeHtml(record.stage)}">${escapeHtml(record.stage)}</span></div>`).join('');
          const rest = bucket.records.length - TIP_MAX_ROWS;
          return `<div class="tip-head">${escapeHtml(title)} · ${bucket.total} 条投递 · ${bucket.companies} 家公司${bucket.offers ? ` · ${bucket.offers} 个 Offer` : ''}</div>
            <div class="tip-list">${items}${rest > 0 ? `<div class="tip-more">另有 ${rest} 条，去台账按城市搜索查看</div>` : ''}</div>`;
        }
        if (kind === 'ctype') {
          const bucket = computeCompanyTypeStats(list).find(row => row.type === value);
          if (!bucket || !bucket.total) return '';
          // 按公司聚类列出：这一档我投了哪几家、各家几条、最好走到哪一步
          const groups = groupRecordsByCompany(bucket.records).slice(0, TIP_MAX_ROWS);
          const items = groups.map(group => {
            const best = group.records.reduce((acc, record) => (stageOrder(record.stage) > stageOrder(acc) ? record.stage : acc), group.records[0].stage);
            return `<div class="tip-row"><span class="tip-v">${escapeHtml(group.label)}${group.records.length > 1 ? ` · ${group.records.length} 个岗位` : ''}</span><span class="badge badge-sm" data-stage="${escapeHtml(best)}">${escapeHtml(best)}</span></div>`;
          }).join('');
          const rest = bucket.companies - groups.length;
          return `<div class="tip-head">${escapeHtml(bucket.label)} · ${bucket.total} 条投递 · ${bucket.companies} 家公司${bucket.offers ? ` · ${bucket.offers} 个 Offer` : ''}</div>
            <div class="tip-list">${items}${rest > 0 ? `<div class="tip-more">另有 ${rest} 家公司</div>` : ''}</div>`;
        }
        return '';
      }
      /*__CORE_PURE_END__*/
