// ----- 纯文本安全渲染（v4.26.0）-----
      // 邮件归档正文、AI 摘要都是**纯文本**，里面常写着「点击这里开始测评」的地址。此前一律
      // escapeHtml 进 <pre>，地址是死的——用户还是得回邮箱复制一遍，而这条链本就是为了不再回邮箱。
      // 这里把 http/https 地址变成可点链接。
      // 为什么单独成函数并配单测：这里是 **XSS 边界**。任何"想把用户文本拼进 HTML"的冲动都从这一处
      // 走，规则只有一条——只认 http/https，其余字符全部转义；绝不为了让地址可点而放松转义。
      const LINKIFY_URL_RE = /https?:\/\/[^\s<>"'）)】\]，。；、]+/gi;
      // 末尾的句读不属于地址（「入口：https://x.com/a。」），剥掉再链接。
      // 刻意**不写进字符类**：把 `.` 加进排除集会把地址中间的句点也切掉（a.b.com → a）。
      function trimLinkTail(url) {
        let s = String(url || '');
        while (s.length && /[.,;:!?、。，；：！？]$/.test(s)) s = s.slice(0, -1);
        return s;
      }
      function linkifyText(text) {
        const s = String(text == null ? '' : text);
        let out = '';
        let last = 0;
        LINKIFY_URL_RE.lastIndex = 0;
        let m;
        while ((m = LINKIFY_URL_RE.exec(s)) !== null) {
          const url = trimLinkTail(m[0]);
          if (!url) continue;
          out += escapeHtml(s.slice(last, m.index));
          out += `<a class="text-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
          // 只跳过地址本身：后面被剥掉的句读交给下一轮当普通文本转义输出（跳整个 m[0] 会静默吞掉它）
          last = m.index + url.length;
        }
        return out + escapeHtml(s.slice(last));
      }
      /*__CORE_PURE_END__*/
