      function icsEscape(text) {
        return String(text == null ? '' : text)
          .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
          .replace(/\r\n|\r|\n/g, '\\n');
      }
      // 本地时间 → ICS 浮动时间（不带 Z / TZID，由日历按本地时区解释，避免时区错位）
      function icsLocal(date, allDay) {
        const p = (n) => String(n).padStart(2, '0');
        const ymd = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
        return allDay ? ymd : `${ymd}T${p(date.getHours())}${p(date.getMinutes())}00`;
      }
      // DTSTAMP 按 RFC 5545 必须是 UTC
      function icsUtc(date) {
        const p = (n) => String(n).padStart(2, '0');
        return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
      }
      // 生成 .ics 日历文件内容（VCALENDAR + 每事件一个 VEVENT），CRLF 换行
      function buildIcs(events, calName = '秋招投递日程') {
        const now = new Date();
        const lines = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//autumn-recruitment-tracker//v4.4.0//CN',
          'CALSCALE:GREGORIAN',
          'METHOD:PUBLISH',
          `X-WR-CALNAME:${icsEscape(calName)}`
        ];
        for (const ev of (Array.isArray(events) ? events : [])) {
          const r = ev.record || {};
          const start = ev.at instanceof Date ? ev.at : (ev.allDay ? parseDay(ev.at) : parseLocal(ev.at));
          if (!start) continue;
          const end = new Date(start.getTime() + (ev.allDay ? 86400000 : 3600000));
          // 机构进标题（v4.11.0）：不进的话日历上会出现三个一模一样的「招商银行 · 客户经理」，
          // 分不清哪个是杭州分行、哪个是成都分行 —— 而日历正是靠标题扫读的。
          const companyBit = [r.company || '投递', r.orgUnit].filter(Boolean).join(' ');
          // v4.19.0：事件自带类型（截止 / 面试 / 笔试测评 / 其他），标题直接用它——
          // 此前所有安排都写成「最近安排」，日历上分不清哪个是笔试、哪个是面试。
          const isDeadline = ev.type === TIME_EVENT_DEADLINE;
          const title = isDeadline
            ? `${companyBit} · 截止（${r.position || '岗位'}）`
            : `${companyBit} · ${ev.type}${r.recentSchedule ? `（${r.recentSchedule}）` : ''}`;
          // v4.24.0：截止也可能带时刻（`2026-09-17T18:00`），带时刻时写成「日期 时:分」，
          // 只给日期的仍写日期——把 18:00 截掉会让日历里的截止时间凭空消失。
          const deadlineAt = String((ev.event && ev.event.at) || '—');
          const deadlineText = ev.allDay ? deadlineAt.slice(0, 10) : `${deadlineAt.slice(0, 10)} ${deadlineAt.slice(11, 16)}`.trim();
          const desc = [
            `岗位：${r.position || '—'}`, `机构：${r.orgUnit || '—'}`, `城市：${r.city || '—'}`, `当前阶段：${r.stage || '—'}`,
            isDeadline ? `截止时间：${deadlineText}` : `${ev.type}时间：${formatDateTime(ev.at)}`,
            r.nextAction ? `下一步：${r.nextAction}` : ''
          ].filter(Boolean).join('\n');
          lines.push(
            'BEGIN:VEVENT',
            // UID 用事件 id 而不是类型：同一条记录可以有多个同类型事件（两次面试），
            // 用类型做后缀会生成重复 UID，严格日历会合并或丢弃其中一个。
            `UID:${icsEscape(r.id || 'unknown')}-${icsEscape((ev.event && ev.event.id) || ev.type)}@autumn-recruitment-tracker`,
            `DTSTAMP:${icsUtc(now)}`,
            ev.allDay ? `DTSTART;VALUE=DATE:${icsLocal(start, true)}` : `DTSTART:${icsLocal(start, false)}`,
            ev.allDay ? `DTEND;VALUE=DATE:${icsLocal(end, true)}` : `DTEND:${icsLocal(end, false)}`,
            `SUMMARY:${icsEscape(title)}`,
            `DESCRIPTION:${icsEscape(desc)}`,
            r.applicationUrl ? `URL:${icsEscape(r.applicationUrl)}` : null,
            'END:VEVENT'
          );
        }
        lines.push('END:VCALENDAR');
        // 过滤 null 行；按 RFC 5545 以 75 个八位组为预算折叠超长行（中文按 UTF-8 字节算，不拆多字节字符）。
        // 注意：必须用箭头函数包一层——Array.map 会把下标当第二个实参传给 foldIcsLine(line, limit)，
        // 直接 .map(foldIcsLine) 会让 limit 变成 0/1/2…，把每一行都按 1 字节切碎。
        return lines.filter(l => l != null && l !== '').map(line => foldIcsLine(line)).join('\r\n') + '\r\n';
      }
      // UTF-8 八位组长度（按码点计，代理对算 4）
      function utf8Octets(str) {
        let n = 0;
        for (const ch of String(str == null ? '' : str)) {
          const c = ch.codePointAt(0);
          if (c < 0x80) n += 1;
          else if (c < 0x800) n += 2;
          else if (c < 0x10000) n += 3;
          else n += 4;
        }
        return n;
      }
      // RFC 5545 §3.1：一行不得超过 75 个**八位组**（不含 CRLF），续行以单个空白开头且该空白计入预算。
      // 中文在 UTF-8 下是 3 字节，按「字符数」折叠会严重超限（74 个汉字 ≈ 222 字节），
      // 严格的日历解析器会拒收或乱码，因此这里按字节预算折叠，并保证不在多字节字符中间断开。
      function foldIcsLine(line, limit = 75) {
        const max = Number(limit) > 0 ? Number(limit) : 75;
        const text = String(line == null ? '' : line);
        if (utf8Octets(text) <= max) return text;
        const parts = [];
        let current = '';
        let bytes = 0;
        for (const ch of text) { // for...of 按码点迭代，天然不会拆开代理对
          const size = utf8Octets(ch);
          if (bytes + size > max) {
            parts.push(current);
            current = ` ${ch}`;       // 续行前导空格
            bytes = 1 + size;
          } else {
            current += ch;
            bytes += size;
          }
        }
        if (current) parts.push(current);
        return parts.join('\r\n');
      }

