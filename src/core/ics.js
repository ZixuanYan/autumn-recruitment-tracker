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
          const title = `${r.company || '投递'} · ${ev.type === 'deadline' ? `截止（${r.position || '岗位'}）` : (r.recentSchedule || r.position || '安排')}`;
          const desc = [
            `岗位：${r.position || '—'}`, `城市：${r.city || '—'}`, `当前阶段：${r.stage || '—'}`,
            ev.type === 'deadline' ? `截止日期：${r.deadline || '—'}` : `安排时间：${r.scheduleAt || '—'}`,
            r.nextAction ? `下一步：${r.nextAction}` : ''
          ].filter(Boolean).join('\n');
          lines.push(
            'BEGIN:VEVENT',
            `UID:${icsEscape(r.id || 'unknown')}-${ev.type}@autumn-recruitment-tracker`,
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

