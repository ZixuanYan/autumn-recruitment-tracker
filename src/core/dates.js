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
      // 「HH:mm」——只给截止倒计时用（`formatDateTime` 会带上日期与星期，塞进 chip 太长）
      function clockOf(date) {
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
      }
      // 截止倒计时：{ text, level }，level ∈ ''（>3天）| 'warn'（0~3天）| 'danger'（已过期/今天）
      // v4.24.0：截止可以带具体时刻了（`2026-09-17T18:00`），24 小时内改用小时级文案 ——
      // 否则「今天 18:00 截止」在 17:00 仍显示「今天」，看不出只剩一小时。
      // 只给日期的（全天截止）走下面第二条分支，行为与 v4.21.0 一字不差。
      function deadlineInfo(deadline, now = new Date()) {
        const raw = String(deadline || '').trim();
        if (!raw) return null;
        const timed = raw.includes('T');
        const at = timed ? parseLocal(raw) : parseDay(raw);
        if (!at) return null;
        const diff = daysUntil(at, now);
        if (timed) {
          const hours = Math.round((at.getTime() - now.getTime()) / 3600000);
          if (hours < 0) return { text: `截止 · 已过期 ${hours <= -24 ? Math.max(1, -diff) + ' 天' : -hours + ' 小时'}`, level: 'danger', days: diff };
          if (diff === 0) return { text: `截止 · 今天 ${clockOf(at)}`, level: 'danger', days: 0 };
          if (hours <= 24) return { text: `截止 · 还剩 ${hours} 小时`, level: 'warn', days: diff };
        }
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
      // 事件是否已被「了结」（v4.23.0）：只服务「未来安排」与「需要关注」这两个**前瞻**清单——
      // 已经做完的事不该再以"逾期"的姿态催办（用户实测：把 AI面试 标记完成之后，
      // 那条 9/12 的安排仍以"逾期"置顶挂在总览上）。
      // 判定 = 时间线里存在里程碑 m 满足其一：
      //   ① m 已标记完成，且完成日 ≥ 事件日 —— 完成动作覆盖了这次安排（对截止也适用）；
      //   ② m 的日期**严格晚于**事件日 —— 流程已经走到这次安排之后。
      // ② 只对「安排」（面试/笔试测评/其他）生效，不看截止：截止是硬期限，逾期本身就是要看的信号，
      // 不会因为后来推进了阶段就变得不需要知道。
      // ② 必须严格大于：当前阶段的里程碑日期等于事件当天时（"今天 9:00 的面试、还没标记完成"）
      // 那正是该提醒的逾期项，用 ≥ 会被自己的规则吞掉。
      //   ③（v4.27.0）当前阶段（时间线**末条**）已标记完成时，该记录的**截止**一律已了结——
      // 对过去与未来的截止都成立：网申这一步都做完了，"网申截止还剩 2 天"只是催人。
      // 之前只认①，完成日早于截止日就照样倒计时，与"已完成网申投递"并排出现（用户实测反馈）。
      // 只看末条：更早的里程碑完成不代表当前阶段的截止无效（一面完成、笔试截止仍然要赶）；
      // 推进到下一阶段后末条不再是 done，截止自动恢复倒计时。
      function isEventSettled(record, event) {
        const evDate = parseDay(String((event && event.at) || '').slice(0, 10));
        if (!evDate) return false;
        const deadline = event && event.type === TIME_EVENT_DEADLINE;
        if (deadline) {
          const tl = Array.isArray(record && record.timeline) ? record.timeline : [];
          const last = tl[tl.length - 1];
          if (last && last.done) return true;
        }
        for (const m of (Array.isArray(record && record.timeline) ? record.timeline : [])) {
          if (!m) continue;
          if (m.done) {
            const done = parseDay(m.doneAt || m.at);
            // daysUntil(a, b) = a − b（天）。要的是「完成日 ≥ 事件日」，所以事件日是**第二个**参数
            //（这里踩过一次：写成 daysUntil(evDate, done) 就等于断言"完成日 ≤ 事件日"，整条规则反了）
            if (done && daysUntil(done, evDate) >= 0) return true;
          }
          if (!deadline) {
            const at = parseDay(m.at);
            if (at && daysUntil(at, evDate) > 0) return true;
          }
        }
        return false;
      }
      // 最近的截止事件（未来的优先）。存在性判定与倒计时都用它，口径只有这一处。
      function nearestDeadlineEvent(events, now = new Date()) {
        return nextTimeEvent((Array.isArray(events) ? events : []).filter(e => e && e.type === TIME_EVENT_DEADLINE), now);
      }
      // 把记录的关键时间合成统一事件流（v4.19.0：来源由单一 scheduleAt/deadline 改为 events[]）。
      // 逾期未处理项置顶（按时间倒序），其余按时间升序，最后截断 limit 条。
      // 语义与旧版保持：终态（Offer / 已结束）不再列截止；已发生的"安排"若已终态也不再列。
      // v4.23.0：已被了结的事件（标记完成覆盖 / 流程已走到它之后）一律不再出现——见 isEventSettled。
      function collectScheduleEvents(records, now = new Date(), limit = 6) {
        const out = [];
        for (const r of (Array.isArray(records) ? records : [])) {
          const closed = ['Offer', '已结束'].includes(r.stage);
          for (const ev of (Array.isArray(r.events) ? r.events : [])) {
            if (!ev) continue;
            if (isEventSettled(r, ev)) continue;
            const isDeadline = ev.type === TIME_EVENT_DEADLINE;
            // v4.24.0：allDay 一律读事件**自己**的值（由 at 是否带时刻推导），不再按类型硬编码。
            // 以前「截止」被写死成全天、其余写死成定时，于是带时刻的截止会被当日历日比较
            //（今天 18:00 的截止在 19:00 才显示逾期，且倒计时算不出剩下几小时），
            // 而只有日期的「其他」事件又会被当定时事件、按当天零点判定为"已过"。
            const allDay = !!ev.allDay;
            const at = allDay ? parseDay(ev.at) : parseLocal(ev.at);
            if (!at) continue;
            if (isDeadline) {
              if (!closed) out.push({ type: ev.type, at, allDay, record: r, event: ev, overdue: isEventPast(at, allDay, now) });
            } else if (!closed || at >= now) {
              out.push({ type: ev.type, at, allDay, record: r, event: ev, overdue: isEventPast(at, allDay, now) && !closed });
            }
          }
        }
        const overdueList = out.filter(e => e.overdue).sort((a, b) => a.at - b.at);
        const futureList = out.filter(e => !e.overdue).sort((a, b) => a.at - b.at);
        return [...overdueList, ...futureList].slice(0, Number(limit) > 0 ? limit : 6);
      }
      // ICS 文本转义（RFC 5545）：反斜杠/分号/逗号/换行
