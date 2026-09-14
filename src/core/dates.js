      /*__CORE_PURE_START__*/
      // ===== v4.4.0 核心纯函数区（不触 DOM / 不读全局状态，便于本地单测）=====
      // 日期-only 字符串（YYYY-MM-DD）用 new Date(str) 会被当成 UTC 午夜，在东八区以外的时区会差一天；
      // 因此截止日一律走 parseDay（补 T00:00:00 → 本地午夜）。
      function parseDay(value) {
        const s = String(value || '').trim();
        if (!s) return null;
        const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s);
        return Number.isNaN(d.getTime()) ? null : d;
      }
      // 相差整天数（按本地日历日，忽略时分秒）：正数=未来，负数=已过
      function daysUntil(date, now = new Date()) {
        if (!date) return null;
        const a = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
        const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        return Math.round((a - b) / 86400000);
      }
      // 截止日倒计时：{ text, level }，level ∈ ''（>3天）| 'warn'（0~3天）| 'danger'（已过期）
      function deadlineInfo(deadline, now = new Date()) {
        const d = parseDay(deadline);
        if (!d) return null;
        const diff = daysUntil(d, now);
        if (diff < 0) return { text: `截止 · 已过期 ${-diff} 天`, level: 'danger', days: diff };
        if (diff === 0) return { text: '截止 · 今天', level: 'danger', days: 0 };
        if (diff <= 3) return { text: `截止 · 还剩 ${diff} 天`, level: 'warn', days: diff };
        return { text: `截止 · 还剩 ${diff} 天`, level: '', days: diff };
      }
      // 事件是否已经过去（v4.21.0 修正）。**全天事件必须按日历日比较**：
      // 它的 at 是当天本地零点，用时间戳比会把「今天到期」判成已过期（00:00 < 现在）。
      // 定时事件（面试/笔试测评/其他）有具体时刻，就按时刻比——今天 14:00 的面试在 15:00 确实已过。
      function isEventPast(at, allDay, now = new Date()) {
        if (!at) return false;
        if (!allDay) return at < now;
        const d = daysUntil(at, now);
        return d != null && d < 0;
      }
      // 取事件列表里「最该显示」的一条：优先最近的未来事件，其次最近的过去事件。
      // 台账「最近时间」列与看板 chip 都用它，避免两处各写一套"取哪一条"的规则。
      function nextTimeEvent(events, now = new Date()) {
        const list = (Array.isArray(events) ? events : [])
          .map(ev => ({ ev, at: ev && ev.allDay ? parseDay(ev.at) : parseLocal(ev && ev.at) }))
          .filter(x => x.ev && x.at);
        if (!list.length) return null;
        const future = list.filter(x => !isEventPast(x.at, x.ev.allDay, now)).sort((a, b) => a.at - b.at);
        if (future.length) return { event: future[0].ev, at: future[0].at, future: true };
        const past = list.sort((a, b) => b.at - a.at);
        return { event: past[0].ev, at: past[0].at, future: false };
      }
      // 最近的截止事件（未来的优先）。存在性判定与倒计时都用它，口径只有这一处。
      function nearestDeadlineEvent(events, now = new Date()) {
        return nextTimeEvent((Array.isArray(events) ? events : []).filter(e => e && e.type === TIME_EVENT_DEADLINE), now);
      }
      // 把记录的关键时间合成统一事件流（v4.19.0：来源由单一 scheduleAt/deadline 改为 events[]）。
      // 逾期未处理项置顶（按时间倒序），其余按时间升序，最后截断 limit 条。
      // 语义与旧版保持：终态（Offer / 已结束）不再列截止；已发生的"安排"若已终态也不再列。
      function collectScheduleEvents(records, now = new Date(), limit = 6) {
        const out = [];
        for (const r of (Array.isArray(records) ? records : [])) {
          const closed = ['Offer', '已结束'].includes(r.stage);
          for (const ev of (Array.isArray(r.events) ? r.events : [])) {
            if (!ev) continue;
            const isDeadline = ev.type === TIME_EVENT_DEADLINE;
            const at = ev.allDay ? parseDay(ev.at) : parseLocal(ev.at);
            if (!at) continue;
            if (isDeadline) {
              if (!closed) out.push({ type: ev.type, at, allDay: true, record: r, event: ev, overdue: isEventPast(at, true, now) });
            } else if (!closed || at >= now) {
              out.push({ type: ev.type, at, allDay: false, record: r, event: ev, overdue: isEventPast(at, false, now) && !closed });
            }
          }
        }
        const overdueList = out.filter(e => e.overdue).sort((a, b) => a.at - b.at);
        const futureList = out.filter(e => !e.overdue).sort((a, b) => a.at - b.at);
        return [...overdueList, ...futureList].slice(0, Number(limit) > 0 ? limit : 6);
      }
      // ICS 文本转义（RFC 5545）：反斜杠/分号/逗号/换行
