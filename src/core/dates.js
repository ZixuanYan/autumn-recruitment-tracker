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
      // 把「安排时间(scheduleAt)」与「截止日期(deadline)」合成统一事件流：
      // 逾期未处理项置顶（按逾期时长倒序），其余按时间升序，最后截断 limit 条。
      function collectScheduleEvents(records, now = new Date(), limit = 6) {
        const out = [];
        for (const r of (Array.isArray(records) ? records : [])) {
          const closed = ['Offer', '已结束'].includes(r.stage);
          const s = parseLocal(r.scheduleAt);
          if (s && (!closed || s >= now)) out.push({ type: 'schedule', at: s, allDay: false, record: r, overdue: s < now && !closed });
          const d = parseDay(r.deadline);
          if (d && !closed) out.push({ type: 'deadline', at: d, allDay: true, record: r, overdue: d < now });
        }
        const overdueList = out.filter(e => e.overdue).sort((a, b) => a.at - b.at);
        const futureList = out.filter(e => !e.overdue).sort((a, b) => a.at - b.at);
        return [...overdueList, ...futureList].slice(0, Number(limit) > 0 ? limit : 6);
      }
      // ICS 文本转义（RFC 5545）：反斜杠/分号/逗号/换行
