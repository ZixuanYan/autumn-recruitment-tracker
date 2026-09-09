      // ----- 漏斗转化率 -----
      // 语义：记录的 timeline 里**出现过**该组里程碑即计入（不是只看当前阶段），
      // 因此后来「已结束」的记录仍算进面试转化，符合漏斗口径。
      const FUNNEL_GROUPS = [
        { key: 'applied', label: '投递', test: () => true },
        { key: 'assess', label: '笔试 / 测评', test: s => ['测评', '笔试', '机试'].includes(s) },
        { key: 'interview', label: '面试', test: s => String(s).includes('面') },
        { key: 'offer', label: 'Offer', test: s => s === 'Offer' }
      ];
      function funnelCounts(items) {
        const base = Array.isArray(items) ? items.length : 0;
        return FUNNEL_GROUPS.map(group => {
          const count = (Array.isArray(items) ? items : []).filter(record => {
            const stages = Array.isArray(record.timeline) && record.timeline.length
              ? record.timeline.map(m => String(m.stage || ''))
              : [String(record.stage || '')];
            return stages.some(group.test);
          }).length;
          return { key: group.key, label: group.label, count, rate: base ? count / base : 0 };
        });
      }
      function computeFunnel(records) {
        const groups = groupRecordsByCompany(records);
        // 公司去重口径：一家公司只要有任一岗位达到该阶段即计入
        const perCompany = groups.map(g => ({
          timeline: g.records.flatMap(r => (Array.isArray(r.timeline) ? r.timeline : [])),
          stage: g.records[0] && g.records[0].stage
        }));
        return { byRecord: funnelCounts(records), byCompany: funnelCounts(perCompany), companies: groups.length };
      }

      // ----- 各阶段平均停留天数（相邻里程碑日期差）-----
      function computeStageDwell(records, top = 5) {
        const acc = new Map();
        for (const r of (Array.isArray(records) ? records : [])) {
          const tl = (Array.isArray(r.timeline) ? r.timeline : [])
            .map(m => ({ stage: String(m.stage || ''), date: parseDay(m.at) }))
            .filter(m => m.stage && m.date);
          for (let i = 0; i < tl.length - 1; i += 1) {
            const days = Math.round((tl[i + 1].date - tl[i].date) / 86400000);
            if (!Number.isFinite(days) || days < 0 || days > 365) continue;
            const key = tl[i].stage;
            if (!acc.has(key)) acc.set(key, { stage: key, total: 0, count: 0 });
            const bucket = acc.get(key);
            bucket.total += days;
            bucket.count += 1;
          }
        }
        return [...acc.values()]
          .map(b => ({ stage: b.stage, avgDays: b.count ? b.total / b.count : 0, count: b.count }))
          .sort((a, b) => b.avgDays - a.avgDays || b.count - a.count)
          .slice(0, Number(top) > 0 ? top : 5);
      }

      // ----- 近 N 天投递节奏 -----
      function computeDailyApplications(records, days = 14, now = new Date()) {
        const span = Number(days) > 0 ? Number(days) : 14;
        const counts = new Map();
        for (let i = span - 1; i >= 0; i -= 1) {
          const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
          counts.set(localDateInput(d), 0);
        }
        for (const r of (Array.isArray(records) ? records : [])) {
          const key = String(r.applicationDate || '').slice(0, 10);
          if (counts.has(key)) counts.set(key, counts.get(key) + 1);
        }
        return [...counts.entries()].map(([date, count]) => ({ date, count }));
      }
      // 生成 sparkline 的折线与面积路径（无第三方依赖）
      function sparklinePath(counts, width = 280, height = 46) {
        const list = Array.isArray(counts) ? counts : [];
        const n = list.length;
        if (!n) return { line: '', area: '', max: 0, total: 0, dots: [] };
        const max = Math.max(1, ...list.map(c => Number(c.count) || 0));
        const step = n > 1 ? width / (n - 1) : width;
        const dots = list.map((c, i) => ({
          x: +(i * step).toFixed(2),
          y: +(height - ((Number(c.count) || 0) / max) * (height - 6) - 3).toFixed(2),
          count: Number(c.count) || 0,
          date: c.date
        }));
        const line = dots.map(d => `${d.x},${d.y}`).join(' ');
        const area = `M${dots[0].x},${height} L${dots.map(d => `${d.x},${d.y}`).join(' L')} L${dots[n - 1].x},${height} Z`;
        return { line, area, max, total: list.reduce((s, c) => s + (Number(c.count) || 0), 0), dots };
      }

      // ----- 卡点：停滞 / 临期截止 / 逾期安排 / 同公司多岗位 -----
      function findStalled(records, now = new Date(), thresholdDays = 14) {
        const out = [];
        for (const r of (Array.isArray(records) ? records : [])) {
          if (!isActive(r)) continue;
          const tl = Array.isArray(r.timeline) ? r.timeline : [];
          const lastDate = tl.length ? parseDay(tl[tl.length - 1].at) : parseDay(r.applicationDate);
          if (!lastDate) continue;
          // 用日历日差（daysUntil）而不是时间戳差：里程碑只有日期（本地午夜），
          // 直接减带时刻的 now 会因为半天偏移把「20 天」算成「21 天」
          const days = -daysUntil(lastDate, now);
          if (days >= thresholdDays) out.push({ record: r, stage: r.stage, days });
        }
        return out.sort((a, b) => b.days - a.days);
      }
      // 临期 / 逾期截止清单：返回 [{ record, info }]（info 来自 deadlineInfo），按紧急度升序（逾期最久在前）。
      // 已结束 / Offer 的记录不再需要赶截止，直接排除。卡点清单与未来安排共用同一套判定，避免两处口径不一致。
      function findUpcomingDeadlines(records, now = new Date(), withinDays = 3) {
        const span = Number.isFinite(Number(withinDays)) ? Number(withinDays) : 3;
        const out = [];
        for (const r of (Array.isArray(records) ? records : [])) {
          if (['Offer', '已结束'].includes(r.stage)) continue;
          const info = deadlineInfo(r.deadline, now);
          if (!info) continue;
          if (info.days < 0 || info.days <= span) out.push({ record: r, info });
        }
        return out.sort((a, b) => a.info.days - b.info.days);
      }
      // 汇总需要关注的事项，danger 优先，最多 limit 条；每条带 recordId 便于点击跳转
      function collectAlerts(records, now = new Date(), limit = 5) {
        const alerts = [];
        const list = Array.isArray(records) ? records : [];
        for (const item of findUpcomingDeadlines(list, now, 3)) {
          const r = item.record;
          alerts.push({ level: item.info.level === 'danger' ? 'danger' : 'warn', id: r.id, text: `${r.company} · ${r.position}：${item.info.text}` });
        }
        for (const r of list) {
          if (['Offer', '已结束'].includes(r.stage)) continue;
          const s = parseLocal(r.scheduleAt);
          if (s && s < now) alerts.push({ level: 'danger', id: r.id, text: `${r.company} · ${r.position}：安排已过（${formatDateTime(r.scheduleAt)}）但阶段仍是「${r.stage}」` });
        }
        for (const item of findStalled(list, now, 14)) {
          alerts.push({ level: 'warn', id: item.record.id, text: `${item.record.company} · ${item.record.position}：停在「${item.stage}」已 ${item.days} 天` });
        }
        for (const group of groupRecordsByCompany(list)) {
          const open = group.records.filter(r => isActive(r));
          if (group.records.length > 1 && open.length > 1) {
            alerts.push({ level: 'info', id: open[0].id, text: `${group.label}：同时有 ${open.length} 个岗位在流程中（${open.map(r => r.stage).join(' / ')}）` });
          }
        }
        const rank = { danger: 0, warn: 1, info: 2 };
        return alerts.sort((a, b) => (rank[a.level] - rank[b.level])).slice(0, Number(limit) > 0 ? limit : 5);
      }
