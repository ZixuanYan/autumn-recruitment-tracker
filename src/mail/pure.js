      /*__MAIL_PURE_START__*/
      // 公司名归一化：全角→半角、去标点空格、latin 小写、循环剥离常见后缀/修饰词
      // ⚠️ 激进版：连「科技/网络/智能/数据」这类行业词也会剥掉，因此**只用于邮件建议的模糊匹配**
      // （那里宁可多命中，反正有人工逐条复核兜底）。查重与展示分组请一律用 companyGroupKey +
      // sameCompanyGroup —— 用本函数做查重会把「星海科技」与「星海互娱」当成同一家公司。
      function normalizeCompanySlug(name) {
        let s = String(name || '');
        s = s.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, ' ');
        s = s.toLowerCase();
        s = s.replace(/[\s()\（\）\[\]{}\·,\.、\-_—~&'"/]/g, '');
        const suffixes = ['有限责任公司', '股份有限公司', '有限公司', '股份公司', '分公司', '子公司', '集团', '公司', '科技', '网络', '信息', '技术', '文化', '传媒', '数字', '智能', '数据', '咨询', '中国'];
        let changed = true;
        while (changed && s.length > 2) {
          changed = false;
          for (const suf of suffixes) {
            if (s.length > suf.length && s.endsWith(suf)) { s = s.slice(0, -suf.length); changed = true; }
          }
        }
        return s;
      }
      // Sørensen–Dice 二元组相似度（多重集交集）
      function diceCoefficient(a, b) {
        const s1 = String(a || ''), s2 = String(b || '');
        if (!s1 || !s2) return 0;
        if (s1 === s2) return 1;
        if (s1.length < 2 || s2.length < 2) return 0;
        const grams = new Map();
        for (let i = 0; i < s1.length - 1; i += 1) { const g = s1.slice(i, i + 2); grams.set(g, (grams.get(g) || 0) + 1); }
        let inter = 0;
        for (let i = 0; i < s2.length - 1; i += 1) {
          const g = s2.slice(i, i + 2); const c = grams.get(g) || 0;
          if (c > 0) { inter += 1; grams.set(g, c - 1); }
        }
        return (2 * inter) / ((s1.length - 1) + (s2.length - 1));
      }
      // 归一化后完全相等→1；互相包含→0.9；否则 Dice
      function companyMatchScore(a, b) {
        const na = normalizeCompanySlug(a), nb = normalizeCompanySlug(b);
        if (!na || !nb) return 0;
        if (na === nb) return 1;
        if (na.includes(nb) || nb.includes(na)) return 0.9;
        return diceCoefficient(na, nb);
      }
      // 公司名模糊匹配台账：阈值 ≥0.6，按分数（再按岗位命中）降序；返回 0/1/多 候选
      function matchRecordsByCompany(company, position, list) {
        const arr = Array.isArray(list) ? list : [];
        if (!normalizeCompanySlug(company)) return [];
        const pos = String(position || '').trim().toLowerCase();
        const posHit = rec => (pos && String(rec.position || '').toLowerCase().includes(pos)) ? 1 : 0;
        return arr
          .map(rec => ({ rec, score: companyMatchScore(company, rec.company) }))
          .filter(x => x.score >= 0.6)
          .sort((a, b) => (b.score - a.score) || (posHit(b.rec) - posHit(a.rec)))
          .map(x => x.rec);
      }
      // 过滤掉本机已应用/已忽略的建议（按 id）
      function filterMailSuggestions(suggestions, appliedIds, dismissedIds) {
        const applied = new Set((appliedIds || []).map(String)), dismissed = new Set((dismissedIds || []).map(String));
        return (Array.isArray(suggestions) ? suggestions : []).filter(s => s && s.id && !applied.has(String(s.id)) && !dismissed.has(String(s.id)));
      }
      // ID 列表并集去重，cap 最近 500 条防膨胀（applied/dismissed 只增不减，membership 语义，顺序无关）
      function unionIdList(a, b, cap) {
        const limit = Number(cap) > 0 ? Number(cap) : 500;
        const seen = new Set(); const out = [];
        for (const id of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
          const s = String(id);
          if (s && !seen.has(s)) { seen.add(s); out.push(s); }
        }
        return out.length > limit ? out.slice(out.length - limit) : out;
      }
      // 跨设备合并 mailState：applied/dismissed 各取并集（任一端处理过 → 全端隐藏），无冲突
      function unionMailState(local, remote) {
        const r = remote && typeof remote === 'object' ? remote : null;
        const l = local && typeof local === 'object' ? local : null;
        return {
          appliedIds: unionIdList(l && l.appliedIds, r && r.appliedIds),
          dismissedIds: unionIdList(l && l.dismissedIds, r && r.dismissedIds)
        };
      }

      // ===== 邮件丢弃诊断（v4.6.1）=====
      // reason 字面量与 Action 侧 autumn-mail-sync/src/config.js 的 DROP_REASONS 一一对应，两处必须同步。
      // 为什么要把丢弃情况搬到网页上：修复前预筛是静默 continue，实测某次「抓取 17 封 → 候选 3」，
      // 那 14 封为什么被丢、发件人是谁，只能去 GitHub Actions 翻日志。而旧噪声规则把 noreply 类
      // 发件人（Moka/北森/牛客等招聘系统的常态地址）当营销噪声，21 个真实地址误杀 18 个，
      // 且水位推过就永不回看——用户唯一的线索就是"感觉没拉到"。现在每封被丢的都有原因可查。
      const DROP_REASON_LABELS = {
        'noise-from': '发件人是邮件系统 / 订阅地址',
        'noise-subject': '主题像营销或金融推销',
        'no-keyword': '主题与正文都没命中预筛关键词',
        'ai-not-recruit': 'AI 判定为非招聘邮件',
        'low-conf': 'AI 置信度低于阈值',
        'ai-error': 'AI 调用失败'
      };
      function describeDropReason(reason) {
        const key = String(reason == null ? '' : reason).trim();
        if (!key) return '未知原因';
        return DROP_REASON_LABELS[key] || key; // 未知 reason 回退原文，便于发现两端枚举漂移
      }

      // 归一化 meta.lastDropped：老 Gist 文件没有该字段、或结构非法时返回 null（状态栏不显示该段）。
      // total 为 0 时也返回 null——本次一封没丢却显示「丢弃 0 封」只是噪声。
      function normalizeDropStats(dropped) {
        if (!dropped || typeof dropped !== 'object') return null;
        const num = value => (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0);
        const recent = (Array.isArray(dropped.recent) ? dropped.recent : [])
          .filter(item => item && typeof item === 'object')
          .slice(0, 20);
        const counts = {
          noiseFrom: num(dropped.noiseFrom),
          noiseSubject: num(dropped.noiseSubject),
          noKeyword: num(dropped.noKeyword),
          aiNotRecruit: num(dropped.aiNotRecruit),
          lowConf: num(dropped.lowConf),
          aiError: num(dropped.aiError)
        };
        const summed = Object.keys(counts).reduce((sum, key) => sum + counts[key], 0);
        // total 优先取 Action 给的值；缺失或为 0 时退回分类求和，最后退回明细条数
        const total = num(dropped.total) || summed || recent.length;
        if (!total) return null;
        return { total, ...counts, recent };
      }

      // 里程碑备注的展示兜底（v4.7.0）。
      // 旧版 Action 生成的 note 是「邮件·其它」——emailType 的内部分类术语，对用户零信息量，
      // 而这条备注勾选后会**永久写进台账时间线**。实测 6 封新建议里 5 封都是「邮件·其它」
      // （滴滴/字节的投递成功通知、光大的投递感谢、中信的邮箱认证、蚂蚁的宣讲预告），
      // 而同一封邮件的 summary 写的是「简历成功投递滴滴校招，等待后续流程推进」这种有用内容。
      // 新版 Action 已在生成 proposed 时就用 summary，这里只是给**已入库的历史数据**兜底，
      // 让它们不必重扫就立刻变好。
      function mileNoteText(note, summary) {
        const n = String(note == null ? '' : note).trim();
        if (!n) return '';
        if (/^邮件\s*[·・]\s*(其它|其他)$/.test(n)) {
          const s = String(summary == null ? '' : summary).trim();
          if (s) return `邮件·${s}`.slice(0, 48); // 与 Action 侧 milestoneNote 同款长度上限
        }
        return n;
      }
      /*__MAIL_PURE_END__*/
