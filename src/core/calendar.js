      // ===== v4.27.0 日历视图纯函数：月网格 + 全台账关键时间按日聚合 =====
      // 与 collectScheduleEvents 的分工：那份是「前瞻清单」（剔除已了结、逾期置顶、限条数），
      // 这份是「事实日历」——一个月里每一天发生过 / 将发生什么。已了结的照列、只打 settled 标记，
      // 由渲染层灰显加「已完成」：历史在日历上仍有位置，「已完成」是标注而不是抹除。

      // 本地某月的月网格（v4.30.0 起行数自适应）：周一起始，含前后月补位，行数按需 4~6 行——
      // 固定 42 格的月份（如 2026-02 恰好 4 行整）会多出两行全空格子，页面高度被白白撑高。
      // 返回 N×7 格 { iso, day, inMonth, isToday }；iso 为 YYYY-MM-DD，
      // 必须走 localDateInput 而不是 toISOString()——后者按 UTC 取日期，东八区之外会差一天。
      function buildMonthGrid(year, monthIndex, now = new Date()) {
        const y = Number(year);
        const m = Number(monthIndex);
        if (!Number.isFinite(y) || !Number.isFinite(m)) return [];
        const todayIso = localDateInput(now);
        const lead = (new Date(y, m, 1).getDay() + 6) % 7; // getDay() 周日=0，换算成周一=0
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        const rows = Math.ceil((lead + daysInMonth) / 7);
        const start = new Date(y, m, 1 - lead);
        const cells = [];
        for (let i = 0; i < rows * 7; i += 1) {
          const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
          const iso = localDateInput(d);
          cells.push({ iso, day: d.getDate(), inMonth: d.getMonth() === m, isToday: iso === todayIso });
        }
        return cells;
      }

      // 全台账关键时间 → 日历条目。每条：
      //   date     本地日历日 YYYY-MM-DD（全天事件即其日期，定时事件按本地时区落到当天）
      //   time     「HH:mm」，全天事件为空串
      //   type     事件类型原文（截止 / 面试 / 笔试测评 / 其他）
      //   kind     'deadline'（截止）/ 'start'（开始）——渲染层据此配色
      //   settled  isEventSettled（含 v4.27.0 规则③：当前阶段完成 → 截止已了结）
      //   terminal Offer / 已结束 —— 渲染层一并灰显（与 collectScheduleEvents 不列终态截止同一取舍）
      //   overdue  已过且没人处理（未了结、非终态）—— 渲染层标红
      // 排序：日期升序 → 全天在前 → 时刻升序；渲染层按 date 直接落格，无需再排。
      function collectCalendarEvents(records, now = new Date()) {
        const out = [];
        for (const r of (Array.isArray(records) ? records : [])) {
          if (!r) continue;
          const terminal = ['Offer', '已结束'].includes(r.stage);
          for (const ev of (Array.isArray(r.events) ? r.events : [])) {
            if (!ev) continue;
            const allDay = !!ev.allDay;
            const at = allDay ? parseDay(ev.at) : parseLocal(ev.at);
            if (!at) continue;
            const settled = isEventSettled(r, ev);
            const past = isEventPast(at, allDay, now);
            out.push({
              date: localDateInput(at),
              time: allDay ? '' : clockOf(at),
              type: ev.type,
              kind: ev.type === TIME_EVENT_DEADLINE ? 'deadline' : 'start',
              record: r,
              event: ev,
              allDay,
              settled,
              past,
              overdue: past && !settled && !terminal,
              terminal
            });
          }
        }
        return out.sort((a, b) =>
          a.date.localeCompare(b.date)
          || (a.time === b.time ? 0 : a.time === '' ? -1 : b.time === '' ? 1 : a.time.localeCompare(b.time))
        );
      }
