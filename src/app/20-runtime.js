
      // syncNow 读到邮件文件后调用：存原始建议 + meta，再按本机 mailState 过滤（缺失/损坏已在调用方静默处理）
      function applyMailPayload(fileJson) {
        const data = fileJson && typeof fileJson === 'object' ? fileJson : null;
        mailMeta = data && data.meta && typeof data.meta === 'object' ? data.meta : null;
        mailRawSuggestions = data && Array.isArray(data.suggestions) ? data.suggestions : [];
        mailState.lastReadAt = new Date().toISOString();
        saveMailState();
        refilterMail();
      }

      // 用当前 mailState 重新过滤原始建议并刷新视图（mailState 跨设备合并后需重跑）
      function refilterMail() {
        mailSuggestions = filterMailSuggestions(mailRawSuggestions, mailState.appliedIds, mailState.dismissedIds);
        renderMailView();
        updateMailBadge();
      }

      function updateMailBadge() {
        const badge = $('#mailNavBadge');
        if (!badge) return;
        const n = mailSuggestions.length;
        if (n > 0) { badge.textContent = n > 99 ? '99+' : String(n); badge.hidden = false; }
        else { badge.textContent = ''; badge.hidden = true; }
      }

      // 就地编辑的草稿：会话级 Map（mailId → { 字段路径: 值 }）。
      // 为什么必须有它：refilterMail() 会调 renderMailView()，而它的上游 applyMailPayload()
      // 由**云端同步**与「重新读取」触发 —— 也就是说你正在改日期时，一次云同步就会把整张卡片
      // 重画、输入框全部回到 AI 原值，而且没有任何提示（改动静默丢失是最让人不信任的那类 bug）。
      // 刻意**不**持久化到 localStorage：重载后还留着上次的草稿更容易 confusing，
      // 而"这次会话里改的"才是用户的心智模型。apply / dismiss 后清掉对应条目。
      const mailDrafts = new Map();

      // 阶段下拉的选项：预设 + 当前值。自定义阶段不在 STAGE_PRESETS 里也必须保留，
      // 否则一编辑就被冲成预设里的某一项（静默改数据）。
      function mailStageOptions(current) {
        const cur = String(current || '');
        const list = (!cur || STAGE_PRESETS.includes(cur)) ? STAGE_PRESETS : [cur, ...STAGE_PRESETS];
        return list.map(x => `<option value="${escapeHtml(x)}"${x === cur ? ' selected' : ''}>${escapeHtml(x)}</option>`).join('');
      }

      function mailCardHtml(s) {
        const conf = Number(s.confidence) || 0;
        const lowConf = conf < 0.6;
        const checked = conf >= 0.6; // 高置信默认勾选，低置信需手动勾选
        const matches = matchRecordsByCompany(s.company, s.position, records);
        // 同公司多岗位：按最近更新倒序，让 select 默认预选「最近活跃」的那条（下拉首项即选中项）
        const orderedMatches = matches.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        const p = s.proposed && typeof s.proposed === 'object' ? s.proposed : {};
        const mile = p.milestone && typeof p.milestone === 'object' ? p.milestone : {};

        let matchHtml;
        if (matches.length === 1) {
          const r = matches[0];
          matchHtml = `<div class="mail-match single" data-target-id="${escapeHtml(r.id)}">匹配到台账：<strong>${escapeHtml(r.company)}</strong> · ${escapeHtml(r.position)}（当前阶段：${escapeHtml(r.stage)}）</div>`;
        } else if (matches.length > 1) {
          // 多选（v4.15.0）：一封邮件常常覆盖同公司的**多个**岗位——比如一次测评 / AI面通知
          // 是发给该公司所有投递的，之后的流程才各自独立、各自有邮件。旧版是单选下拉：
          // 7 个岗位要点 7 次，而第一次应用后这封邮件就被 markMailApplied 标记、卡片消失，
          // 剩下 6 个岗位再也关联不上（UID 水位已推过去，「重新读取」也找不回来）。
          // 默认勾选策略：候选全部同属一个 companyGroupKey（确实是同公司多岗位）→ 全勾；
          // 跨公司（说明匹配可疑）→ 全不勾 + 显式警告，强制逐条确认。
          // 这条策略把匹配可靠性编码进交互：pure.js 的首字闸门万一漏掉一个误匹配，
          // 它会以"跨公司候选"的形态在这里被拦下来，而不是被一键批量写进 N 条时间线。
          const sameGroup = orderedMatches.every(r => companyGroupKey(r) === companyGroupKey(orderedMatches[0]));
          const boxOn = sameGroup ? ' checked' : '';
          matchHtml = `<div class="mail-match multi"><div class="mail-match-head"><span>匹配到 ${orderedMatches.length} 条台账（同公司多岗位），<strong>可多选</strong>：</span><button class="text-button" type="button" data-mail-action="toggle-all" data-mail-id="${escapeHtml(s.id)}">全选 / 全不选</button></div><div class="mail-target-list">${orderedMatches.map(r => `<label class="mail-target-item"><input type="checkbox" class="mail-target-check" value="${escapeHtml(r.id)}"${boxOn}><span>${escapeHtml(r.company)} · ${escapeHtml(positionWithUnit(r.position, r.orgUnit, true))} · ${escapeHtml(r.stage)}</span></label>`).join('')}</div>${sameGroup ? '' : '<div class="mail-match-warn">候选跨了不同公司，已默认全不勾——请逐条确认再应用。</div>'}</div>`;
        } else {
          matchHtml = '<div class="mail-match none">未匹配到台账记录——可「新建记录」并预填邮件信息（走人工补全），或忽略。</div>';
        }

        // 字段值可**就地编辑**（v4.16.0）。此前只有「要 / 不要」两个选择，
        // 想改一个日期必须先应用、再去台账里找到那条记录手动改一遍——而应用会把值
        // 永久写进时间线，等于"先写错再回去修"。
        // 结构上刻意**不把输入框嵌进 <label>**：嵌进去的话点击日期框会连带切换勾选状态
        //（label 的默认行为就是把点击转发给它内部的表单控件），这是这类改造最容易踩的坑。
        // 所以每行是 .mail-field 容器 → 里面并列一个 <label class="mail-field-check">（只包 checkbox）
        // 与一个 .mail-field-edit（只包输入框）。
        const draft = mailDrafts.get(String(s.id)) || {};
        const ed = (key, ai) => String(draft[key] != null ? draft[key] : (ai == null ? '' : ai));
        const fields = [];
        // note 走 mileNoteText 兜底：历史数据里的「邮件·其它」改用同一条建议的 summary 展示
        if (mile.stage) {
          // 日期来源标注。atSource 是 v4.16.0 才有的字段，Gist 里的历史建议都没有——
          // 最初我给它们一律显示「来源未知」，但那是个**没有信息量的第三态**：
          // 18 条历史建议会齐刷刷挂着一个说不清道不明的灰标签，用户只会问"这是什么"。
          // 实际上老数据是**可以推断**的，因为旧代码只有两个来源：
          //     const at = n.scheduleDate || receivedDate(mail);
          // 于是：at ≠ 收信日 → 必然来自邮件（**确定**，不是猜）；
          //       at = 收信日 → 可能是兜底、也可能邮件真写了当天，两者无法区分 → 倾向警示。
          // 取收信日的方式必须与 Action 侧 receivedDate() 逐字一致（取 ISO 串的日期段，
          // 即 UTC 日期而非本地日期），否则差一个时区就会把"来自邮件"误判成"疑似收信日"。
          const recvDate = (String(s.receivedAt || '').match(/(\d{4}-\d{2}-\d{2})/) || [, ''])[1];
          const legacy = !mile.atSource;
          let src;
          if (mile.atSource === 'received' || (legacy && recvDate && mile.at === recvDate)) {
            src = {
              cls: 'is-fallback',
              text: mile.atSource === 'received' ? '收信日兜底' : '疑似收信日',
              tip: mile.atSource === 'received'
                ? '邮件里没有明确时间，这个日期是收信日兜底值——请按实际情况改掉（它会永久写进时间线）'
                : '这条建议产生于 v4.16.0 之前、没有记录来源。日期恰好等于收信日，可能是当时代码用收信日顶替的结果，请核对后再应用'
            };
          } else if (mile.atSource === 'email' || (legacy && recvDate && mile.at && mile.at !== recvDate)) {
            src = {
              cls: 'is-email',
              text: '来自邮件',
              tip: legacy
                ? '这条建议产生于 v4.16.0 之前、没有记录来源，但日期不等于收信日，可确定来自邮件原文'
                : '这个时间是从邮件原文里读出来的'
            };
          } else {
            // 只剩一种情况：连收信日都拿不到（老 payload 缺 receivedAt），无从推断
            src = { cls: 'is-unknown', text: '来源未知', tip: '这条建议没有来源信息，也拿不到收信日用来推断，请核对后再应用' };
          }
          const noteText = mileNoteText(mile.note, s.summary);
          fields.push({ key: 'milestone', label: '推进里程碑', editor: `<select class="control mail-ed" data-mail-edit="milestone.stage">${mailStageOptions(ed('milestone.stage', mile.stage))}</select><input class="control mail-ed" type="date" data-mail-edit="milestone.at" value="${escapeHtml(ed('milestone.at', mile.at))}"><span class="mail-ed-src ${src.cls}" title="${escapeHtml(src.tip)}">${src.text}</span><input class="control mail-ed mail-ed-wide" type="text" maxlength="48" data-mail-edit="milestone.note" value="${escapeHtml(ed('milestone.note', noteText))}" placeholder="里程碑备注（永久写进时间线）">` });
        }
        if (p.scheduleAt) fields.push({ key: 'scheduleAt', label: '安排时间', editor: `<input class="control mail-ed" type="datetime-local" data-mail-edit="scheduleAt" value="${escapeHtml(ed('scheduleAt', p.scheduleAt))}">` });
        // 截止时间：台账一直有 deadline 字段（「签约截止」列 + deadlineInfo 倒计时 + 按截止日排序），
        // 但 v4.16.0 之前 AI 契约与 proposed 里都没有它，所以笔试/测评邮件里最有用的那个时间
        // （"链接 X 日失效"、"请在 X 日前完成"）被整条链路丢弃。
        if (p.deadline) fields.push({ key: 'deadline', label: '截止时间', editor: `<input class="control mail-ed" type="date" data-mail-edit="deadline" value="${escapeHtml(ed('deadline', p.deadline))}"><span class="mail-ed-hint">写入台账「签约截止」，参与倒计时与排序</span>` });
        if (p.recentSchedule) fields.push({ key: 'recentSchedule', label: '最近安排', editor: `<input class="control mail-ed mail-ed-wide" type="text" maxlength="100" data-mail-edit="recentSchedule" value="${escapeHtml(ed('recentSchedule', p.recentSchedule))}">` });
        if (p.nextAction) fields.push({ key: 'nextAction', label: '下一步行动', editor: `<input class="control mail-ed mail-ed-wide" type="text" maxlength="100" data-mail-edit="nextAction" value="${escapeHtml(ed('nextAction', p.nextAction))}">` });
        const fieldsHtml = fields.length
          ? `<div class="mail-fields">${fields.map(f => `<div class="mail-field" data-field="${f.key}"><label class="mail-field-check"><input type="checkbox" data-mail-field="${f.key}" ${checked ? 'checked' : ''}><span>${escapeHtml(f.label)}</span></label><div class="mail-field-edit">${f.editor}</div></div>`).join('')}<div class="mail-fields-foot"><span class="mail-fields-note">改动会写入<strong>已勾选的全部目标台账</strong>；只在本次会话内保留。</span><button class="text-button" type="button" data-mail-action="reset-fields" data-mail-id="${escapeHtml(s.id)}">还原 AI 原值</button></div></div>`
          : '<div class="mail-fields mail-fields-empty">这封邮件没有可直接应用的字段。</div>';

        const primaryBtn = matches.length === 0
          ? `<button class="btn btn-small btn-primary" data-mail-action="new" data-mail-id="${escapeHtml(s.id)}" type="button">新建记录</button>`
          : `<button class="btn btn-small btn-primary" data-mail-action="apply" data-mail-id="${escapeHtml(s.id)}" type="button">应用所选</button>`;

        return `<article class="mail-card${lowConf ? ' low-conf' : ''}" data-mail-id="${escapeHtml(s.id)}">
          <div class="mail-card-top">
            <span class="mail-type" data-type="${escapeHtml(s.emailType || '其它')}">${escapeHtml(s.emailType || '其它')}</span>
            <span class="mail-company">${escapeHtml(s.company || '（未识别公司）')}</span>
            ${s.position ? `<span class="mail-position">${escapeHtml(s.position)}</span>` : ''}
            ${s.stage ? `<span class="badge" data-stage="${escapeHtml(s.stage)}">${escapeHtml(s.stage)}</span>` : ''}
            <span class="mail-conf${lowConf ? ' low' : ''}" title="${lowConf ? '低置信，请仔细核对后再应用' : 'AI 判定置信度'}">置信度 ${Math.round(conf * 100)}%</span>
          </div>
          ${s.subject ? `<div class="mail-subject">${escapeHtml(s.subject)}</div>` : ''}
          ${s.summary ? `<div class="mail-summary">${escapeHtml(s.summary)}</div>` : ''}
          <div class="mail-meta">${escapeHtml(s.from || '')}${s.receivedAt ? ` · ${escapeHtml(formatClock(s.receivedAt) || '')}` : ''}</div>
          ${matchHtml}
          ${fieldsHtml}
          <div class="mail-actions">${primaryBtn}<button class="btn btn-small" data-mail-action="dismiss" data-mail-id="${escapeHtml(s.id)}" type="button">忽略</button></div>
        </article>`;
      }

      // 丢弃明细 HTML（状态栏 ok 分支用）。from / subject 一律走 escapeHtml：
      // 邮件主题可以含任意 HTML，直接拼接等于给外部发件人一个注入本页面的入口。
      // 复用 error 分支已有的 .mail-help 折叠样式，不新增交互范式。
      function mailDroppedHtml(stats) {
        if (!stats) return '';
        const pairs = [
          ['noise-from', stats.noiseFrom],
          ['noise-subject', stats.noiseSubject],
          ['no-keyword', stats.noKeyword],
          ['ai-not-recruit', stats.aiNotRecruit],
          ['low-conf', stats.lowConf],
          ['ai-error', stats.aiError]
        ].filter(pair => Number(pair[1]) > 0);
        const countsHtml = pairs.length
          ? `<div class="drop-counts">${pairs.map(pair => `<span>${escapeHtml(describeDropReason(pair[0]))} <b>${Number(pair[1])}</b></span>`).join('')}</div>`
          : '';
        const listHtml = stats.recent.length
          ? `<ul class="drop-list">${stats.recent.map(item => `<li>
              <div class="drop-mail"><b>${escapeHtml(String(item.from || '（无发件人）'))}</b>${escapeHtml(String(item.subject || '（无主题）'))}</div>
              <div class="drop-meta">#${escapeHtml(String(item.uid || '0'))} · ${escapeHtml(describeDropReason(item.reason))}</div>
            </li>`).join('')}</ul>`
          : '';
        return `<details class="mail-help"><summary>本次丢弃 ${stats.total} 封，怀疑漏了可以展开看</summary>${countsHtml}${listHtml}<div class="drop-note">丢弃只发生在自动预筛与 AI 判定阶段，被丢的邮件不会进建议队列，也不影响你已投递的记录。若发现某封招聘邮件被误丢：在 autumn-mail-sync 仓库手动运行 mail-sync、填 <code>UID_FROM</code>（回溯起点，见下方邮件编号）重新扫描即可捞回——常规增量运行不会回头看已被水位越过的邮件。</div></details>`;
      }

      function renderMailView() {
        const list = $('#mailList');
        const bar = $('#mailStatusBar');
        if (!list || !bar) return;

        if (!syncConfig.token) {
          bar.className = 'mail-statusbar warning';
          bar.innerHTML = '<strong>需先开启云同步</strong>邮件建议随云同步从你的私有 Gist 读取。请到「工具 → 云同步」开启后再回到这里。';
          list.innerHTML = '';
          return;
        }
        if (mailNeedKey) {
          bar.className = 'mail-statusbar warning';
          bar.innerHTML = '<strong>邮件建议已加密</strong>本机未填写「邮件解密密钥」或密钥不正确，无法读取。点右上「设置」填入与 Action 的 MAIL_ENC_KEY 完全相同的密钥，保存后会自动重新读取。';
          list.innerHTML = '';
          return;
        }
        if (mailMeta && mailMeta.lastStatus === 'error') {
          bar.className = 'mail-statusbar error';
          bar.innerHTML = `<strong>上次邮件同步失败</strong>${escapeHtml(mailMeta.lastError || '未知错误')}<details class="mail-help"><summary>怎么修复？</summary><ol><li>最常见：改过 QQ 密码后 <strong>16 位授权码失效</strong> → 到 QQ 邮箱重新生成，更新私有仓库 autumn-mail-sync 的 QQ_AUTHCODE Secret。</li><li>AI 超额/密钥无效 → 检查 AI_API_KEY / AI_BASE_URL / AI_MODEL。</li><li>被 QQ 风控（Unsafe Login）→ 需把定时任务迁到国内宿主。</li><li>修复后在仓库手动重跑 mail-sync，再回本页点「重新读取」。</li></ol></details>`;
        } else if (mailMeta) {
          bar.className = 'mail-statusbar ok';
          // 丢弃统计（v4.6.1）：老 Gist 文件没有 lastDropped、或本次一封没丢时 normalizeDropStats 返回 null，
          // 这一段就不出现，状态栏与 v4.6.0 完全一致。
          const drops = normalizeDropStats(mailMeta.lastDropped);
          bar.innerHTML = `<strong>已读取邮件建议</strong>上次运行 ${escapeHtml(formatClock(mailMeta.lastRunAt) || '—')} · 本次新增 ${Number(mailMeta.newCount) || 0} 封 · 云端候选 ${Number(mailMeta.pendingCount) || 0} 条 · 待你复核 ${mailSuggestions.length} 条${drops ? ` · 丢弃 ${drops.total} 封` : ''}${mailDroppedHtml(drops)}`;
        } else {
          bar.className = 'mail-statusbar';
          bar.innerHTML = '<strong>暂无邮件建议</strong>定时任务可能还没运行，或你的 Gist 里还没有 mail-suggestions.json。确认 autumn-mail-sync 的 mail-sync 已跑通后，点「重新读取」。';
        }

        if (!mailSuggestions.length) {
          list.innerHTML = '<div class="mail-empty">没有待复核的邮件建议。已应用 / 已忽略的不会再出现在本机。</div>';
          return;
        }
        list.innerHTML = mailSuggestions.map(mailCardHtml).join('');
      }

      function markMailApplied(id) {
        const sid = String(id);
        if (!mailState.appliedIds.includes(sid)) mailState.appliedIds.push(sid);
        mailSuggestions = mailSuggestions.filter(s => String(s.id) !== sid);
        saveMailState();
        scheduleSyncPush(); // 跨设备：把已应用状态推上云，其它设备同步后不再重复显示
      }
      function markMailDismissed(id) {
        const sid = String(id);
        if (!mailState.dismissedIds.includes(sid)) mailState.dismissedIds.push(sid);
        mailSuggestions = mailSuggestions.filter(s => String(s.id) !== sid);
        saveMailState();
        scheduleSyncPush(); // 跨设备：把已忽略状态推上云
      }

      // 应用所选字段到匹配记录：里程碑走 setTimeline，其余字段直接赋值 → saveRecords（触发快照+云同步）
      function applyMailSuggestion(id) {
        const s = mailSuggestions.find(x => String(x.id) === String(id));
        if (!s) return;
        const card = document.querySelector(`.mail-card[data-mail-id="${CSS.escape(String(id))}"]`);
        if (!card) return;
        // 目标可以是多条（多选）。单命中那一支仍走 .mail-match.single 的 data-target-id。
        const targetIds = [...card.querySelectorAll('.mail-target-check:checked')].map(i => i.value);
        if (!targetIds.length) {
          const single = card.querySelector('.mail-match.single');
          if (single && single.dataset.targetId) targetIds.push(single.dataset.targetId);
        }
        const targets = targetIds.map(tid => records.find(r => r.id === tid)).filter(Boolean);
        if (!targets.length) { showToast('请先勾选至少一条目标台账，或改用「新建记录」'); return; }

        const checked = new Set([...card.querySelectorAll('input[data-mail-field]:checked')].map(i => i.dataset.mailField));
        if (!checked.size) { showToast('请至少勾选一个要应用的字段'); return; }

        const p = s.proposed && typeof s.proposed === 'object' ? s.proposed : {};
        const mile = p.milestone && typeof p.milestone === 'object' ? p.milestone : {};
        // 一律以**输入框当前值**为准（用户可能已经就地改过），不再直接读 s.proposed。
        const readEd = key => {
          const el = card.querySelector(`[data-mail-edit="${key}"]`);
          return el ? String(el.value || '').trim() : '';
        };
        const edStage = checked.has('milestone') ? (readEd('milestone.stage') || mile.stage) : '';
        const edAt = checked.has('milestone') ? readEd('milestone.at') : '';
        // 写前校验：里程碑进了时间线就是永久的，而时间线是按日期排序的真相源，
        // 空日期会打乱排序、空阶段会让这条里程碑被 sanitizeTimeline 直接丢掉。
        // 拦在循环之前，避免"改了一半才发现不合法"（前几条已写入、后面没写）。
        if (checked.has('milestone')) {
          if (!edStage) { showToast('里程碑需要选一个阶段'); return; }
          if (!edAt) { showToast('里程碑需要一个日期——邮件没给时间时这里是收信日兜底值，请按实际情况填'); return; }
        }
        let milestoneApplied = false;
        let offerHit = false;
        for (const rec of targets) {
          if (checked.has('milestone') && edStage) {
            // 此前这里是 `mile.at || localDateInput(new Date())` —— 与 Action 侧的
            // `n.scheduleDate || receivedDate(mail)` 构成**两处**静默兜底，
            // 只修 Action 那一处的话，网页端会继续用"今天"顶替。现在不猜：
            // 缺日期已被上面的校验拦下。
            setTimeline(rec, [...(rec.timeline || []), { stage: edStage, at: edAt, note: readEd('milestone.note') || mile.note || '邮件' }]);
            milestoneApplied = true;
          }
          if (checked.has('scheduleAt') && readEd('scheduleAt')) rec.scheduleAt = readEd('scheduleAt');
          if (checked.has('deadline') && readEd('deadline')) rec.deadline = readEd('deadline');
          if (checked.has('recentSchedule') && readEd('recentSchedule')) rec.recentSchedule = readEd('recentSchedule');
          if (checked.has('nextAction') && readEd('nextAction')) rec.nextAction = readEd('nextAction');
          rec.updatedAt = Date.now();
          if (edStage === 'Offer' || rec.stage === 'Offer') offerHit = true;
        }

        // 只存一次：循环里逐条 saveRecords 会触发 N 次 localStorage 写入 + N 次
        // scheduleSyncPush（云同步推送判定），既浪费又可能与自己的上一次推送竞争。
        saveRecords(targets.length > 1
          ? `已按邮件更新 ${targets.length} 条台账：${targets[0].company}`
          : `已按邮件更新：${targets[0].company}`);
        markMailApplied(id);
        mailDrafts.delete(String(id));   // 已应用，草稿作废（否则下次这封邮件再出现会带着旧改动）
        render();
        for (const rec of targets) flashRow(rec.id);
        renderMailView();
        updateMailBadge();
        if (milestoneApplied && offerHit) playOfferStamp();
      }

      function dismissMailSuggestion(id) {
        markMailDismissed(id);
        mailDrafts.delete(String(id));
        renderMailView();
        updateMailBadge();
        showToast('已忽略这封邮件建议（仅本机不再显示）');
      }

      // 0 命中：预填邮件信息走现有「新增投递」弹窗人工补全；保存成功后（submitForm）才标记该建议为已应用
      function openMailSeedDialog(id) {
        const s = mailSuggestions.find(x => String(x.id) === String(id));
        if (!s) return;
        const p = s.proposed && typeof s.proposed === 'object' ? s.proposed : {};
        const mile = p.milestone && typeof p.milestone === 'object' ? p.milestone : {};
        const today = localDateInput(new Date());
        const seed = normalizeRecord({
          company: s.company || '',
          position: s.position || '',
          city: '',
          applicationDate: mile.at || today,
          scheduleAt: p.scheduleAt || '',
          recentSchedule: p.recentSchedule || '',
          nextAction: p.nextAction || '',
          stage: mile.stage || '已投递',
          timeline: mile.stage ? [{ stage: mile.stage, at: mile.at || today, note: mile.note || '邮件' }] : undefined
        });
        pendingMailSeedId = String(id);
        openDialog(null, seed);
        showToast('已预填邮件信息，请补全城市/岗位等后保存');
      }

      // ---- 邮件设置面板：读写 Gist 的 mail-config.json（非密钥项）+ 本机解密密钥（C）----
      function currentMailConfig() {
        const c = mailConfig && typeof mailConfig === 'object' ? mailConfig : {};
        const num = (v, fb) => (String(v == null ? '' : v).trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : fb);
        return {
          keywords: (typeof c.keywords === 'string' && c.keywords.trim()) ? c.keywords : MAIL_CFG_DEFAULTS.keywords,
          minConfidence: num(c.minConfidence, MAIL_CFG_DEFAULTS.minConfidence),
          sinceDays: num(c.sinceDays, MAIL_CFG_DEFAULTS.sinceDays),
          maxPerRun: num(c.maxPerRun, MAIL_CFG_DEFAULTS.maxPerRun),
          minIntervalHours: num(c.minIntervalHours, MAIL_CFG_DEFAULTS.minIntervalHours),
          enabled: c.enabled === false ? false : true,
          promptExtra: typeof c.promptExtra === 'string' ? c.promptExtra : MAIL_CFG_DEFAULTS.promptExtra,
          // 整体替换提示词（v4.7.0）：只接受字符串，其它类型（Gist 被手改成数字/null）一律回落空串=用内置
          promptOverride: typeof c.promptOverride === 'string' ? c.promptOverride.slice(0, 4000) : MAIL_CFG_DEFAULTS.promptOverride
        };
      }

      // 展示 Action 上次运行时写入云端的、**真正生效**的完整提示词（meta.promptSnapshot）。
      // 为什么不在前端硬编码一份提示词文本：那样 Action 侧改了提示词后，这里展示的就是过期的副本，
      // 而这种漂移无法被任何测试发现（前端副本与 Action 源码之间没有约束关系）。
      // 让 Action 把它实际发出去的那一份写进 meta，展示就永远等于生效值——
      // test/integration.js 有一条断言钉死这个等价关系（快照必须与 AI 请求体里的 system prompt 逐字相同）。
      function renderPromptSnapshot() {
        const wrap = $('#mailPromptSnapshotWrap'), body = $('#mailPromptSnapshot'), note = $('#mailPromptSnapshotNote');
        if (!wrap || !body) return;
        const snap = String((mailMeta && mailMeta.promptSnapshot) || '').trim();
        if (!snap) {
          // 旧版 Action（<0.4.0）写的 meta 里没有这个字段：整块隐藏，不给用户看一个空框
          wrap.hidden = true;
          body.textContent = '';
          if (note) note.textContent = '';
          return;
        }
        wrap.hidden = false;
        // 必须用 textContent：提示词里含 < > 「」 等字符，用 innerHTML 会把它们当标签解析
        body.textContent = snap;
        if (note) {
          const at = mailMeta && mailMeta.lastRunAt ? (formatClock(mailMeta.lastRunAt) || '') : '';
          note.textContent = `这是 Action 上次运行${at ? `（${at}）` : ''}实际发给 AI 的完整内容，由 Action 自己写入云端，因此与真正生效的版本永远一致。末尾「输出契约 · 不可覆盖」那一段无法被上面的替换框删掉。修改后需等 Action 下次运行，这里才会更新。`;
        }
      }

      function openMailSettings() {
        if (!syncConfig.token) { openSyncDialog(); showToast('请先开启云同步，再配置邮件提醒'); return; }
        const c = currentMailConfig();
        $('#mailCfgKeywords').value = c.keywords;
        $('#mailCfgMinConf').value = c.minConfidence;
        $('#mailCfgSinceDays').value = c.sinceDays;
        $('#mailCfgMaxPerRun').value = c.maxPerRun;
        $('#mailCfgInterval').value = c.minIntervalHours;
        $('#mailCfgEnabled').checked = c.enabled;
        $('#mailCfgPrompt').value = c.promptExtra;
        $('#mailCfgPromptOverride').value = c.promptOverride;
        renderPromptSnapshot();
        $('#mailCfgEncKey').value = mailState.encKey || '';
        const st = $('#mailCfgStatus');
        st.className = 'capture-status';
        st.textContent = mailConfig ? '已加载云端配置（mail-config.json）。' : '尚未保存过配置，当前为默认值。';
        $('#mailSettingsDialog').showModal();
      }

      function generateMailEncKey() {
        const bytes = crypto.getRandomValues(new Uint8Array(24));
        $('#mailCfgEncKey').value = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
        const st = $('#mailCfgStatus');
        st.className = 'capture-status';
        st.textContent = '已生成密钥。保存后请把这串密钥同样填进 autumn-mail-sync 仓库的 MAIL_ENC_KEY Secret（两端必须完全一致才能解密）。';
      }

      async function saveMailSettings() {
        if (!syncConfig.token) { showToast('请先开启云同步'); return; }
        const st = $('#mailCfgStatus');
        const clampNum = (v, min, max, fb) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fb; };
        const cfgObj = {
          keywords: String($('#mailCfgKeywords').value || '').trim().slice(0, 2000) || MAIL_CFG_DEFAULTS.keywords,
          minConfidence: clampNum($('#mailCfgMinConf').value, 0, 1, MAIL_CFG_DEFAULTS.minConfidence),
          sinceDays: Math.round(clampNum($('#mailCfgSinceDays').value, 1, 365, MAIL_CFG_DEFAULTS.sinceDays)),
          maxPerRun: Math.round(clampNum($('#mailCfgMaxPerRun').value, 1, 200, MAIL_CFG_DEFAULTS.maxPerRun)),
          minIntervalHours: Math.round(clampNum($('#mailCfgInterval').value, 0, 168, MAIL_CFG_DEFAULTS.minIntervalHours)),
          enabled: $('#mailCfgEnabled').checked,
          promptExtra: String($('#mailCfgPrompt').value || '').trim().slice(0, 2000),
          // 清空即恢复内置提示词：Action 侧 applyMailConfigOverrides 见到空串会回落到 DEFAULT_PROMPT_BODY
          promptOverride: String($('#mailCfgPromptOverride').value || '').trim().slice(0, 4000),
          updatedAt: new Date().toISOString()
        };
        // 解密密钥只存本机 localStorage，绝不写进 mail-config.json（它明文存在 Gist）
        const newEncKey = String($('#mailCfgEncKey').value || '').trim();
        const encKeyChanged = newEncKey !== (mailState.encKey || '');
        st.className = 'capture-status';
        st.textContent = '正在保存到你的私有 Gist…';
        try {
          await resolveSyncGist();
          // 只 PATCH mail-config.json 一个文件，不碰 vault / mail-suggestions（按文件互不覆盖）
          await gistRequest(`/gists/${syncConfig.gistId}`, {
            method: 'PATCH',
            body: JSON.stringify({ files: { [MAIL_CONFIG_FILENAME]: { content: JSON.stringify(cfgObj, null, 2) } } })
          });
          mailConfig = cfgObj;
          mailState.encKey = newEncKey;
          saveMailState();
          st.className = 'capture-status success';
          st.textContent = '已保存。Action 下次运行按新配置执行。';
          showToast('邮件设置已保存');
          $('#mailSettingsDialog').close();
          if (encKeyChanged) await syncNow('manual'); // 密钥变化影响能否解密邮件建议：立即重拉一次
        } catch (error) {
          st.className = 'capture-status error';
          st.textContent = `保存失败：${error.message || error}`;
        }
      }

      // ================= 视图路由：#/view 形式，旧锚点 #view 自动重定向 =================
      const VIEW_META = {
        overview: { kicker: 'DASHBOARD', title: '投递总览', subtitle: '统计、洞察与未来安排——从银十到金九，每一步都在这里' },
        records: { kicker: 'PIPELINE', title: '投递记录', subtitle: '表格与看板双视图——搜索、筛选、排序、拖拽推进都在这里' },
        resume: { kicker: 'PROFILE', title: '我的简历', subtitle: '字段名即填表匹配名——用常用名命中率最高' },
        tools: { kicker: 'TOOLBOX', title: '工具', subtitle: '截图识别、数据安全与云同步集中在此' },
        mail: { kicker: 'INBOX', title: '邮件提醒', subtitle: '招聘邮件解析结果，逐项复核后并入台账' }
      };
      // records 恢复为独立视图（更早版本本就是，v4.4.0 曾并入总览并重定向，v4.8.0 拆回）；
      // upcoming（未来安排）仍留在总览，旧书签重定向兼容。
      const ROUTE_ALIASES = { overview: 'overview', records: 'records', resume: 'resume', tools: 'tools', mail: 'mail', upcoming: 'overview' };

      // ================= 工具页卡片状态：云同步连接情况与快照数量 =================
      async function renderToolCards() {
        const icsBadge = $('#toolIcsBadge');
        if (icsBadge) {
          const count = collectScheduleEvents(records, new Date(), 500).length;
          icsBadge.textContent = count ? `${count} 项可导出` : '暂无日程';
          icsBadge.className = count ? 'tool-status ok' : 'tool-status';
        }
        const syncBadge = $('#toolSyncBadge');
        if (syncBadge) {
          if (!syncConfig.token) {
            syncBadge.textContent = '未开启';
            syncBadge.className = 'tool-status warning';
          } else if (syncConfig.gistId) {
            syncBadge.textContent = syncConfig.lastSyncAt ? `已连接 · 上次同步 ${formatClock(syncConfig.lastSyncAt)}` : '已连接 · 待首次同步';
            syncBadge.className = 'tool-status ok';
          } else {
            syncBadge.textContent = '令牌已填写';
            syncBadge.className = 'tool-status';
          }
        }
        const safetyBadge = $('#toolSafetyBadge');
        if (safetyBadge) {
          const count = cachedSnapshotCount == null ? await refreshSnapshotCount() : cachedSnapshotCount;
          if (count == null) {
            safetyBadge.textContent = '当前不可用';
            safetyBadge.className = 'tool-status warning';
          } else {
            safetyBadge.textContent = `${count} 个快照`;
            safetyBadge.className = count ? 'tool-status ok' : 'tool-status';
          }
        }
      }

      function parseRoute() {
        // 兼容 #/view 路由形式与旧 #view 锚点形式（井号后斜杠可选）
        const raw = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
        return ROUTE_ALIASES[raw] || 'overview';
      }

      // is-entering 的摘除定时器。声明在 switchView 外面：连续快速切视图时
      // 必须先 clearTimeout 上一次的，否则旧定时器会在新视图入场途中把类摘掉、动画被截断。
      let enteringTimer = 0;

      function switchView(name) {
        const route = VIEW_META[name] ? name : 'overview';
        clearTimeout(enteringTimer);
        document.querySelectorAll('.view[data-view]').forEach(view => {
          const active = view.dataset.view === route;
          view.hidden = !active;
          view.classList.remove('is-entering');
          if (active) {
            void view.offsetWidth; // 重置动画
            view.classList.add('is-entering');
          }
        });
        // is-entering 是**瞬时**状态，入场动画放完就摘掉（此前加上就永不摘，名不副实）。
        // 摘掉之后，后续的数据重渲染（新建记录、云同步刷新统计卡与看板列）不会再触发一次入场——
        // 否则每改一条记录，整个统计区/看板/简历区块都要重新淡入一遍，比没有动画更吵。
        // 1000ms = 视图自身 .4s + 最末一个错峰元素 8×60ms 起步 + 自身 .4s，留足余量。
        // 摘类不会造成视觉跳变：fade-up / view-in 都是 both 填充，终态与自然态一致。
        enteringTimer = setTimeout(() => {
          document.querySelectorAll('.view.is-entering').forEach(view => view.classList.remove('is-entering'));
        }, 1000);
        document.querySelectorAll('.nav-item[data-route]').forEach(item => {
          item.classList.toggle('is-active', item.dataset.route === route);
        });
        const meta = VIEW_META[route];
        if (meta) {
          const kicker = $('#viewKicker'), title = $('#viewTitle'), subtitle = $('#viewSubtitle');
          if (kicker) kicker.textContent = meta.kicker;
          if (title) title.textContent = meta.title;
          if (subtitle) subtitle.textContent = meta.subtitle;
          document.title = `${meta.title} · 秋招投递管理`;
        }
        if (location.hash !== `#/${route}`) {
          history.replaceState(null, '', `#/${route}`);
        }
        if (route === 'tools') renderToolCards();
        if (route === 'mail') renderMailView();
        // 从别的视图切回投递记录时重渲台账/看板：数据可能在别处变更过（如邮件应用、抽屉推进），
        // 隐藏视图多渲染一次无副作用，换取各视图始终一致。
        if (route === 'records') renderRecordsView();
        window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
      }

      function initializeRouter() {
        // 旧锚点（#records 等，含插件桥接 location.hash 赋值场景）重定向到路由形式
        const legacy = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
        if (legacy && !location.hash.startsWith('#/') && ROUTE_ALIASES[legacy]) {
          history.replaceState(null, '', `#/${ROUTE_ALIASES[legacy]}`);
        }
        window.addEventListener('hashchange', () => switchView(parseRoute()));
        switchView(parseRoute());
      }

      function populateSelects() {
        // 阶段组合框预设候选（时间线编辑器与推进自定义共用）
        $('#stagePresets').innerHTML = STAGE_PRESETS.map(s => `<option value="${escapeHtml(s)}"></option>`).join('');
        // 企业性质（v4.6.0）：选项由 COMPANY_TYPES 生成，HTML 里只留「未设置」，避免两处枚举漂移
        const companyTypeSelect = $('#companyType');
        if (companyTypeSelect) {
          companyTypeSelect.innerHTML = `<option value="">${escapeHtml(COMPANY_TYPE_UNSET)}</option>`
            + COMPANY_TYPES.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
        }
        refreshStageFilter();
      }
      // 筛选下拉 = 预设 ∪ 记录中实际出现的自定义阶段（保留当前选择）
      function refreshStageFilter() {
        const current = els.filter.value;
        const opts = [...STAGE_PRESETS];
        records.forEach(r => { if (r.stage && !opts.includes(r.stage)) opts.push(r.stage); });
        els.filter.innerHTML = '<option value="all">全部阶段</option>' + opts.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
        if ([...els.filter.options].some(o => o.value === current)) els.filter.value = current;
      }

      // ================= 阶段时间线编辑器（记录弹窗内）=================
      function timelineRowHtml(m) {
        return `<div class="tl-row">
          <input class="control tl-stage" list="stagePresets" maxlength="20" placeholder="阶段" value="${escapeHtml(m && m.stage || '')}">
          <input class="control tl-date" type="date" value="${escapeHtml(m && m.at || '')}" aria-label="阶段日期">
          <input class="control tl-note" maxlength="60" placeholder="备注（可选）" value="${escapeHtml(m && m.note || '')}">
          <button class="tl-del" type="button" title="删除该阶段" aria-label="删除该阶段">✕</button>
        </div>`;
      }
      function renderTimelineEditor(source) {
        const appDate = $('#applicationDate').value || localDateInput(new Date());
        // 新增（无 source）时默认「已投递」而不是「待投递」：点「新增投递」的场景几乎总是
        // 「我刚投了 / 我要记一条已经投出去的」，默认待投递等于每次都要多改一次；
        // 更要紧的是 isActive 把「待投递」排除在外，照默认值存下来的记录不会进「在流程中」，
        // 也不会被停滞提醒和卡点清单抓到——等于这条投递在洞察里隐身。
        // 「待投递」仍然是合法阶段（在 STAGE_PRESETS 里），想记候选岗位请走岗位库。
        // 注意：这里只改新增表单的默认值；normalizeRecord / deriveStage 里的 '待投递' 兜底
        // 是「既无 timeline 又无 stage」的防御与老数据迁移路径，语义不同，保持不动。
        const tl = Array.isArray(source && source.timeline) && source.timeline.length
          ? source.timeline
          : (source && source.stage ? [{ stage: source.stage, at: source.applicationDate || appDate, note: '' }]
            : [{ stage: '已投递', at: appDate, note: '' }]);
        $('#timelineEditor').innerHTML = tl.map(timelineRowHtml).join('');
      }
      function collectTimeline() {
        return [...document.querySelectorAll('#timelineEditor .tl-row')].map(row => ({
          stage: row.querySelector('.tl-stage').value.trim(),
          at: row.querySelector('.tl-date').value,
          note: row.querySelector('.tl-note').value.trim()
        })).filter(m => m.stage);
      }
      function addTimelineRow() {
        const ed = $('#timelineEditor');
        ed.insertAdjacentHTML('beforeend', timelineRowHtml({ stage: '', at: $('#applicationDate').value || localDateInput(new Date()), note: '' }));
        const last = ed.querySelector('.tl-row:last-child .tl-stage');
        if (last) last.focus();
      }

      // 公司名 → 企业 + 机构 的拆分**建议**（v4.11.0）。三条精度纪律，都是实测出来的：
      //
      // 1. 企业名用**贪婪**匹配。机构名短（杭州分行）、企业名长（招商银行），贪婪才会在正确的
      //    位置切开；惰性（.{2,}?）会把最常见的「招商银行杭州分行」拆成「招商」+「银行杭州分行」，
      //    「中国银行杭州分行」拆成「中国」+「银行杭州分行」—— 第一版就是这么写的，实测全错。
      // 2. 整串含法人后缀（有限公司 / 股份 / 集团）时**不给建议**。此时企业名的结尾无法可靠定位：
      //    「中国银行股份有限公司杭州分行」贪婪会切成 中国银行 + 股份有限公司杭州分行，
      //    后缀跑到了机构那一段。宁可不建议，让用户自己填 —— 与插件识别「宁空勿错」同一条原则。
      //    注意这里**不能**把裸「公司」列进排除词，否则「杭州分公司」这种最需要拆的形态会被误伤。
      // 3. 后缀只收「分行 / 支行 / 分公司 / 分部 / 办事处 / 分中心」这一族。事业部 / 研究院 / 子公司
      //    前面通常是短品牌名，贪婪与惰性都容易切错（「星海科技云计算事业部」→ 星海 + 科技云计算事业部），
      //    收益不抵误报，所以不给建议 —— 字段本身照样可以手填这些值。
      //
      // 仍然只给建议、点了才拆、拆完两个框都能改：建议是预览式的（按钮文本把两段都写出来），
      // 所以像「工商银行北京市分行」→ 工商银行北 + 京市分行 这种一眼看得出不对的拆分不构成静默错位。
      // 「招银网络科技」这种推断不出母企业的也不给提示（提示了也猜不出来），
      // 正确录法是自己填 company='招商银行' + orgUnit='招银网络科技'。
      const ORG_LEGAL_SUFFIX_RE = /股份有限公司|有限责任公司|有限公司|股份公司|集团/;
      const ORG_SPLIT_RE = /^(.{2,})([\u4e00-\u9fa5]{2,8}(?:分行|支行|分公司|分部|办事处|分中心))$/;
      // 提示与点击必须共用这一个函数：两边各写一份判定，就会出现「预览说能拆、点了没反应」
      // 或「预览不显示、但残留的按钮点了拆出别的东西」。
      function matchOrgSplit(name) {
        const value = String(name || '').trim();
        if (!value || ORG_LEGAL_SUFFIX_RE.test(value)) return null;
        return ORG_SPLIT_RE.exec(value);
      }
      function updateOrgSplitHint() {
        const hint = $('#orgSplitHint');
        if (!hint) return;
        const m = matchOrgSplit($('#company').value);
        // 已经填了机构就不再建议：用户显然有自己的分法，反复提示只是干扰
        if (!m || $('#orgUnit').value.trim()) { hint.hidden = true; hint.innerHTML = ''; return; }
        hint.innerHTML = `这个名字像是「企业 + 机构」：<button class="text-button" type="button" id="orgSplitBtn">拆成「${escapeHtml(m[1])}」+「${escapeHtml(m[2])}」</button>`;
        hint.hidden = false;
      }

      // 新增简历区块：名字 + 类型二选一（v4.11.0，取代原来的一行 prompt）
      // 区块类型转换（v4.11.1）。两个方向都**不丢字段**，所以不需要二次确认：
      //   键值型 → 列表型：现有键值对整体装进第一段经历（经历标签留空给你填）；空对象直接变空数组
      //   列表型 → 键值型：只有 0 或 1 段时允许（把该段字段摊平，经历标签存成「经历标签」这一项）；
      //     多段时**明确拒绝**并说清会丢几段 —— 多段经历没法摊平成一层键值对，
      //     而静默丢掉 N-1 段正是这个项目里最不能接受的那类缺陷（不报错、事后才发现数据没了）
      function convertSectionType(name) {
        if (!name) return;
        // 先收回 DOM 再改：与新增区块同一套顺序。不收回的话，用户在**别的**区块里
        // 尚未保存的编辑会被下面的整体重渲染冲掉。
        resume = collectResumeFromDom();
        if (!(name in resume)) { showToast('找不到这个区块'); return; }
        const current = resume[name];
        const toExp = !Array.isArray(current);
        if (toExp) {
          const entries = Object.entries(current || {});
          resume[name] = entries.length ? [Object.assign({ _rowName: '' }, current)] : [];
        } else {
          if (current.length > 1) {
            showToast(`「${name}」有 ${current.length} 段经历，转成键值型会丢掉 ${current.length - 1} 段。请先删到只剩一段`);
            return;
          }
          const flat = {};
          for (const [k, v] of Object.entries(current[0] || {})) flat[k === '_rowName' ? '经历标签' : k] = v;
          resume[name] = flat;
        }
        // 这里**必须**整体重渲染（与字段级删除刻意只动 DOM 相反）：类型变了，
        // 区块的 data-type、头部按钮（＋ 添加 / 自定义）与 body 的整套结构都要换，
        // 局部改 DOM 只会留下一个「按钮是列表型、body 还是键值行」的半新半旧状态。
        renderResumeEditor();
        showToast(`「${name}」已转为${toExp ? '列表' : '键值'}型，点「保存简历」后写入 JSON`);
      }

      function openSectionDialog() {
        const dialog = $('#sectionDialog');
        if (!dialog) return;
        $('#sectionForm').reset();
        // reset() 会把 radio 恢复成 HTML 里的 checked（列表型）——这是刻意的默认：
        // 用户报的诉求就是要列表型，键值型是少数场景（技能证书那种一行一项）。
        dialog.showModal();
        requestAnimationFrame(() => $('#sectionName').focus());
      }

      function submitSectionForm(event) {
        event.preventDefault();
        const name = $('#sectionName').value.trim();
        if (!name) { showToast('请填写区块名称'); return; }
        const isKv = $('#sectionForm').querySelector('input[name="sectionType"]:checked')?.value === 'kv';
        // 先收回 DOM 再判重名：不收回的话，用户在本页尚未保存的简历编辑会被下面的
        // renderResumeEditor() 整体冲掉（旧实现同样是这个顺序，保留）。
        resume = collectResumeFromDom();
        if (name in resume) { $('#sectionDialog').close(); showToast('该区块已存在'); renderResumeEditor(); return; }
        // 列表型 = []（渲染走 exp 分支 → 有「＋ 添加」，每段是可上移/下移/复制/删除的卡片）
        // 键值型 = {}（走 kv 分支 → 「自定义」加键值对行）
        resume[name] = isKv ? {} : [];
        $('#sectionDialog').close();
        renderResumeEditor();
        showToast(`已添加${isKv ? '键值' : '列表'}型区块「${name}」，点「保存简历」后写入 JSON`);
      }

      function openDialog(record = null, seed = null) {
        const source = record || seed;
        editingId = record?.id || null;
        els.dialogTitle.textContent = record ? '编辑投递' : seed ? '确认识别结果' : '新增投递';
        els.form.reset();
        $('#applicationDate').value = source ? (source.applicationDate || '') : localDateInput(new Date());
        renderTimelineEditor(source);
        // 回填字段清单：新增任何表单字段都必须同步加进这里，否则「编辑」时该字段会被静默清空。
        // 取不到元素时跳过（null 安全），便于分阶段加字段。
        for (const field of ['company', 'orgUnit', 'position', 'city', 'companyType', 'applicationUrl', 'scheduleAt', 'deadline', 'recentSchedule', 'nextAction', 'referral', 'intent', 'salary']) {
          const input = document.getElementById(field);
          if (!input) continue;
          // intent 是下拉框：0（未设）要映射成空字符串，否则 select 会落在无匹配项的状态
          const raw = source ? source[field] : '';
          input.value = field === 'intent' ? (Number(raw) > 0 ? String(Number(raw)) : '') : (raw ?? '');
        }
        // 已填过任一「更多字段」时自动展开折叠区，避免用户以为数据丢了
        // （意向度与企业性质已上移到主网格、批次与渠道已在 v4.11.0 删除，都不再参与判定。
        //   折叠区现在只剩内推人与薪资两项 —— 刻意保留折叠：这两项是低频字段，
        //   平铺会让新增弹窗的常用路径变长，而「已填过就自动展开」已经解决了"以为数据丢了"。）
        const more = $('#formMore');
        if (more) more.open = !!source && ['referral', 'salary'].some(f => String(source[f] || '').trim());
        updateSameCompanyHint(); // 打开即显示「该公司已有哪几个岗位」，录入第二个岗位时心里有数
        updateOrgSplitHint();    // 公司名带「XX分行」时给出「拆成企业 + 机构」的建议（不自动执行）
        els.dialog.showModal();
        requestAnimationFrame(() => $('#company').focus());
      }
      // 桥接消息源白名单：只有本插件（秋招求职与简历助手）一个。
      // 只接受当前插件在用的这一个 source。曾经这里还并列着第三方旧插件的标识
      // （AUTUMN_JOB_CAPTURE，注意刻意不加引号写——加了就会命中 web-check 里
      // 「已删协议不得复活」那条反向断言，守卫会被自己的解释性注释绊倒），
      // 那套握手的另一端早已不存在，留着就是永远等不到回应的死分支。
      const BRIDGE_SOURCES = ['AUTUMN_JOB_ASSISTANT'];
      async function handleCaptureMessage(event) {
        if (event.source !== window || !BRIDGE_SOURCES.includes(event.data?.source)) return;
        if (event.data.type === 'RESUME_REQUEST') {
          // 插件打开网页版时主动索要简历：立即下发，弥补定时推送可能因内容脚本注入时机而错过
          if (!isResumeEmpty(resume)) pushResumeToPlugin();
          return;
        }
        if (event.data.type === 'CAPTURE_SUBMIT') {
          // 秋招求职与简历助手插件推送的已收录岗位：走人工确认弹窗，保存后自动快照与云同步
          const submitted = event.data.record || {};
          const seed = normalizeRecord({
            company: submitted.company,
            position: submitted.position,
            city: submitted.city,
            applicationDate: submitted.applicationDate || '',
            stage: String(submitted.stage || '').trim() || '已投递',
            // 插件收录表单里选的企业性质直接透传；normalizeRecord 会做白名单校验，
            // 因此旧版插件（不传该字段）或异常值都会安全落回「未设置」
            companyType: submitted.companyType,
            // 机构同理透传。旧版插件不传 → normalizeRecord 收敛成 ''，不会报错也不会脏
            orgUnit: submitted.orgUnit,
            applicationUrl: submitted.applicationUrl,
            recentSchedule: submitted.recentSchedule || '',
            nextAction: submitted.nextAction || ''
          });
          // 统一走 resolveDuplicate。此前这条路径**没有逃生口**：一旦判为重复就强制 openDialog(既有记录)，
          // 还自动 setTimeline 追加里程碑 + 合并 city/url —— 用户想录同一家公司的第二个岗位时不仅录不进，
          // 新岗位的信息还会被静默写进旧记录。另外旧版传 ignoreBatch:true，会把「已有提前批 + 新收正式批」
          // 判成 duplicate，同样触发上述静默改写。
          // 现在：add → 新增弹窗；edit → 打开既有记录（阶段更靠后时只把里程碑**预置进时间线编辑器**，
          // 用户看得到、可改可删，保存才落库）；cancel → 什么都不做。
          const decision = await resolveDuplicate(findDuplicateRecord(records, seed), seed);
          if (decision.action === 'cancel') return;
          if (decision.action === 'edit') {
            const target = decision.target;
            const merged = { ...target };
            ['city', 'orgUnit', 'applicationDate', 'applicationUrl', 'recentSchedule', 'nextAction'].forEach(key => {
              if (seed[key] && !merged[key]) merged[key] = seed[key];
            });
            if (stageOrder(seed.stage) > stageOrder(merged.stage)) {
              // 不直接 setTimeline 落库：只把新里程碑放进弹窗的时间线编辑器，由用户确认后保存
              merged.timeline = [...(merged.timeline || []), { stage: seed.stage, at: seed.applicationDate || localDateInput(new Date()), note: '插件推送' }];
            }
            openDialog(merged);
            showToast('已打开既有记录，请核对后保存（未自动改动任何内容）');
            return;
          }
          openDialog(null, seed);
          showToast(`插件已推送岗位，请检查信息后保存${decision.hint || ''}`);
          return;
        }
        if (event.data.type === 'BRIDGE_BROKEN') {
          // 插件的 chrome.runtime 上下文失效了：通常是扩展刚被重新加载或更新，而本页仍跑着旧的内容脚本，
          // 旧脚本的 chrome.runtime 已成失效句柄。插件侧（06-bridge.js）已把这类失败收敛成一次性上报，
          // 不再往控制台抛 "Extension context invalidated."；这里负责把它变成用户看得懂、点一下就能解决的提示。
          // 插件自己不会自愈——必须刷新页面重新注入内容脚本，所以直接给一个「刷新页面」动作按钮。
          showToast(String(event.data.detail || '插件连接已断开，刷新页面即可恢复'), {
            actionLabel: '刷新页面',
            duration: 10000,
            onAction: () => window.location.reload()
          });
          return;
        }
      }
      function closeDialog() {
        els.dialog.close();
        editingId = null;
        pendingMailSeedId = null; // 取消/关闭新建：撤销邮件建议的待应用交接
      }

      async function submitForm(event) {
        event.preventDefault();
        const timeline = collectTimeline();
        if (!timeline.length) { showToast('请至少填写一个阶段（如“已投递”）'); return; }
        const data = Object.fromEntries(new FormData(els.form).entries());
        const normalized = normalizeRecord({ ...data, id: editingId || cryptoId(), updatedAt: Date.now(), timeline });
        let sameCompanyHint = '';
        if (!editingId) {
          // 手填新增：统一走 resolveDuplicate —— duplicate / variant 都给逃生口，same-company 只做非阻断提示
          const decision = await resolveDuplicate(findDuplicateRecord(records, normalized), normalized);
          if (decision.action === 'cancel') return; // Esc / 点遮罩关掉确认框：什么都不写
          if (decision.action === 'edit') { closeDialog(); openDialog(decision.target); return; }
          // 不能在这里单独 showToast：紧接着 saveRecords 的 toast 会把它顶掉（同一个 #toast 元素），
          // 用户永远看不到。改为把提示并进保存那条 toast。
          sameCompanyHint = decision.hint || '';
        }
        if (editingId) {
          records = records.map(record => record.id === editingId ? normalized : record);
          saveRecords('已更新并自动保存');
        } else {
          records.unshift(normalized);
          saveRecords(`已新增并自动保存${sameCompanyHint}`);
          // 由「邮件提醒 → 新建记录」交接而来：保存成功后才把该建议标记为已应用（取消则不标记）
          if (pendingMailSeedId) { const mid = pendingMailSeedId; pendingMailSeedId = null; markMailApplied(mid); renderMailView(); updateMailBadge(); }
        }
        closeDialog();
        render();
        flashRow(normalized.id);
      }

      let lastDeleted = null; // 仅最近一次删除可撤销

      async function handleTableAction(event) {
        // 公司分组折叠开关（只在「按公司聚合」排序时出现）
        const groupToggle = event.target.closest('button[data-group-toggle]');
        if (groupToggle) { toggleCompanyGroup(groupToggle.dataset.groupToggle); return; }
        const button = event.target.closest('button[data-action]');
        if (!button) {
          // 点公司 / 岗位单元格 → 打开详情抽屉；点链接仍走原生跳转（不打断）
          // 注意：此处不能引用下面的 record（const 尚未初始化会触发 TDZ），改从行上取 data-id
          if (event.target.closest('a')) return;
          const cell = event.target.closest('td[data-label="公司 / 岗位"]');
          const row = cell && cell.closest('tr[data-id]');
          if (row) openRecordFocus(row.dataset.id);
          return;
        }
        const record = records.find(item => item.id === button.dataset.id);
        if (!record) return;
        if (button.dataset.action === 'edit') return openDialog(record);
        if (button.dataset.action === 'delete') return requestDeleteRecord(record);
        if (button.dataset.action === 'advance') {
          openAdvanceDialog(record);
        }
      }

      // 删除记录（表格行 / 详情抽屉共用）：确认后软删（写 tombstone）+ 可撤销
      async function requestDeleteRecord(record) {
        if (!record) return;
        if (!await confirmInApp(`确定删除「${record.company} · ${record.position}」吗？`, { title: '删除投递记录', danger: true, confirmText: '删除' })) return;
        const index = records.findIndex(item => item.id === record.id);
        records = records.filter(item => item.id !== record.id);
        markDeleted([record.id]);
        saveRecords();
        render();
        lastDeleted = { record, index };
        if (drawerRecordId === record.id) closeRecordDrawer();
        showToast(`已删除「${record.company} · ${record.position}」`, { actionLabel: '撤销', duration: 6000, onAction: undoDelete });
      }

      // ================= 推进阶段：弹出选择，追加为时间线里程碑（不再盲目 index+1）=================
      let advancingId = null;
      function openAdvanceDialog(record, options = {}) {
        advancingId = record.id;
        $('#advanceTitle').textContent = `推进阶段 · ${record.company || ''}`.trim();
        const curOrder = stageOrder(record.stage);
        let candidates = STAGE_PRESETS.filter(s => stageOrder(s) > curOrder && s !== '待投递');
        if (!candidates.length) candidates = STAGE_PRESETS.filter(s => s !== '待投递' && s !== record.stage);
        $('#advanceStageGrid').innerHTML = candidates.map(s =>
          `<button class="btn btn-small advance-pick" type="button" data-stage="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('');
        $('#advanceCustom').value = '';
        // 备注（v4.8.0）：拖到「已结束」列时预填结束原因引导，其余入口留空由用户自由填写
        const noteEl = $('#advanceNote');
        if (noteEl) noteEl.value = String(options.note || '');
        $('#advanceDate').value = (record.scheduleAt ? String(record.scheduleAt).slice(0, 10) : '') || localDateInput(new Date());
        $('#advanceDialog').showModal();
      }
      function applyAdvance(stage) {
        const record = records.find(r => r.id === advancingId);
        const s = String(stage || '').trim();
        if (!record || !s) { showToast('请选择或填写一个阶段'); return; }
        const at = $('#advanceDate').value || localDateInput(new Date());
        // 备注写进里程碑（上限 60 字，与输入框 maxlength 一致）；留空时保持 ''，不写 "undefined"
        const noteEl = $('#advanceNote');
        const note = noteEl ? String(noteEl.value || '').trim().slice(0, 60) : '';
        setTimeline(record, [...(record.timeline || []), { stage: s, at, note }]);
        saveRecords(s === 'Offer' ? '已盖章：Offer' : `已推进到「${s}」并自动保存`);
        closeAdvanceDialog();
        render();
        flashRow(record.id);
        // 抽屉里点「推进阶段」走的也是这条路径：推进后必须重渲抽屉，
        // 否则步骤条仍显示旧里程碑，要关掉重开才能看到（浏览器实证发现的缺陷）
        if (drawerRecordId === record.id) renderDrawer();
        if (s === 'Offer') playOfferStamp();
      }
      function closeAdvanceDialog() {
        advancingId = null;
        const dlg = $('#advanceDialog');
        if (dlg && dlg.open) dlg.close();
      }

      // 撤销最近一次删除：撤回墓碑 + 按原位置插回 + 重渲染高亮
      function undoDelete() {
        if (!lastDeleted) return;
        const { record, index } = lastDeleted;
        lastDeleted = null;
        unmarkDeleted([record.id]);
        records.splice(Math.max(0, Math.min(index, records.length)), 0, record);
        saveRecords();
        render();
        flashRow(record.id);
        showToast('已撤销删除，记录已恢复');
      }

      // 变更行高亮：推进/编辑/撤销后给对应行一次性高亮，让“改了哪行”一目了然
      function flashRow(id) {
        const row = els.body.querySelector(`tr[data-id="${CSS.escape(String(id))}"]`);
        if (!row) return;
        row.classList.remove('row-flash');
        void row.offsetWidth;
        row.classList.add('row-flash');
        setTimeout(() => row.classList.remove('row-flash'), 1000);
      }

      function exportData() {
        const date = localDateInput(new Date());
        downloadPayload(createEnvelope(records), `秋招投递记录-${date}.json`);
        showToast(`已导出 ${records.length} 条记录，原数据未改变`);
      }

      // 通用文本文件下载（.ics 等非 JSON 产物）；downloadPayload 仅用于 JSON
      function downloadText(text, filename, mime) {
        const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      // 导出日程到系统日历：把「安排时间 + 截止日期」写成 .ics（纯本机生成，不联网）
      function exportIcs(recordId) {
        const source = recordId ? records.filter(r => r.id === recordId) : records;
        const events = collectScheduleEvents(source, new Date(), 500);
        if (!events.length) {
          showToast(recordId ? '这条记录还没有安排时间或截止日期' : '还没有可导出的安排或截止日期');
          return;
        }
        const name = recordId
          ? `${(source[0] && source[0].company) || '投递'}-日程.ics`
          : `秋招日程-${localDateInput(new Date())}.ics`;
        downloadText(buildIcs(events), name, 'text/calendar;charset=utf-8');
        showToast(`已导出 ${events.length} 项日程，双击 .ics 文件即可加入系统日历`);
      }

      // 导出简历 JSON（顶栏「导出简历」与简历页「导出 JSON」共用）
      function exportResume() {
        downloadPayload({ appVersion: APP_VERSION, exportedAt: new Date().toISOString(), resume: JSON.parse(JSON.stringify(resume)) }, `我的简历-${localDateInput(new Date())}.json`);
        showToast('简历 JSON 已导出');
      }

      // 盖章动效：Offer 到手，印章砸落（prefers-reduced-motion 下由 CSS 直接跳过）
      function playOfferStamp() {
        const overlay = document.createElement('div');
        overlay.className = 'stamp-overlay';
        overlay.innerHTML = '<div class="stamp-seal">OFFER</div>';
        document.body.appendChild(overlay);
        setTimeout(() => overlay.remove(), 1200);
      }

      function showToast(message, options = {}) {
        clearTimeout(toastTimer);
        els.toast.textContent = '';
        els.toast.classList.toggle('has-action', !!options.actionLabel);
        const span = document.createElement('span');
        span.textContent = message;
        els.toast.appendChild(span);
        if (options.actionLabel) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'toast-action';
          btn.textContent = options.actionLabel;
          btn.addEventListener('click', () => {
            els.toast.classList.remove('show', 'has-action');
            if (options.onAction) options.onAction();
          });
          els.toast.appendChild(btn);
        }
        els.toast.classList.add('show');
        const duration = options.duration || 2400;
        toastTimer = setTimeout(() => els.toast.classList.remove('show', 'has-action'), duration);
      }

      // 应用内确认框：替代原生 confirm()，风格统一、可 danger 样式化；Esc/点遮罩/取消均为 false
      let confirmResolve = null;
      let confirmResult = false;
      // 'ok' | 'cancel' | 'dismiss'：布尔返回值无法区分「点了取消按钮」与「Esc / 点遮罩关掉」，
      // 而查重场景里 Esc 应当中止整次操作，不该被当成任何一个按钮（否则按 Esc 会静默新增一条重复记录）。
      let confirmOutcome = 'cancel';
      function lastConfirmOutcome() { return confirmOutcome; }
      function confirmInApp(message, options = {}) {
        const dialog = $('#confirmDialog');
        if (!dialog || typeof dialog.showModal !== 'function') {
          const fallback = window.confirm(message);
          confirmOutcome = fallback ? 'ok' : 'cancel';
          return Promise.resolve(fallback);
        }
        // 重入保护：确认框已开着时再调用，showModal() 按规范会抛 InvalidStateError 并留下悬挂的 Promise。
        // 先把上一次按「取消」结算掉，再复用同一个弹窗。
        if (dialog.open) { confirmResult = false; confirmOutcome = 'dismiss'; settleConfirm(); }
        $('#confirmMessage').textContent = message;
        $('#confirmTitle').textContent = options.title || '请确认';
        const okBtn = $('#confirmOkBtn');
        okBtn.textContent = options.confirmText || '确定';
        okBtn.classList.toggle('danger', !!options.danger);
        const cancelBtn = $('#confirmCancelBtn');
        if (cancelBtn) cancelBtn.textContent = options.cancelText || '取消';
        confirmResult = false;
        confirmOutcome = 'cancel';
        return new Promise(resolve => {
          confirmResolve = resolve;
          dialog.showModal();
        });
      }

      let deferredInstallPrompt = null;

      function isStandaloneApp() {
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
      }

      function openInstallDialog() {
        $('#installDialog').showModal();
      }

      async function requestAppInstall() {
        if (!deferredInstallPrompt) return openInstallDialog();
        deferredInstallPrompt.prompt();
        const result = await deferredInstallPrompt.userChoice.catch(() => null);
        deferredInstallPrompt = null;
        if (result?.outcome === 'accepted') {
          $('#installAppBtn').hidden = true;
          showToast('已开始安装，稍后可从手机桌面打开');
        }
      }

      function initializeMobileApp() {
        const installButton = $('#installAppBtn');
        const canInstallFromWeb = location.protocol === 'https:' && !isStandaloneApp();
        installButton.hidden = !canInstallFromWeb;
        window.addEventListener('beforeinstallprompt', event => {
          event.preventDefault();
          deferredInstallPrompt = event;
          installButton.hidden = false;
        });
        window.addEventListener('appinstalled', () => {
          deferredInstallPrompt = null;
          installButton.hidden = true;
          showToast('秋招投递管理器已安装到桌面');
        });
        if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
          window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}), { once: true });
        }
      }
      initializeRouter();
      populateSelects();
      render();
      renderResumeEditor();

      // ================= 我的简历：事件绑定（事件委托处理动态按钮） =================
      document.addEventListener('click', (event) => {
        const target = event.target.closest('[data-action]');
        if (!target) return;
        const action = target.getAttribute('data-action');
        const sec = target.getAttribute('data-section') || target.closest('.exp-item-card')?.getAttribute('data-section');
        const card = target.closest('.exp-item-card');
        if (action === 'add-kv') {
          event.preventDefault();
          addKvField(sec);
        } else if (action === 'add-exp') {
          event.preventDefault();
          addExperienceRow(sec);
        } else if (action === 'open-lib') {
          event.preventDefault();
          let libCard = card;
          if (!libCard && sec) {
            const block = target.closest('.resume-section-block');
            if (block && block.getAttribute('data-type') === 'exp') libCard = block.querySelector('.exp-item-card:last-of-type');
          }
          openFieldLibrary(sec, libCard);
        } else if (action === 'toggle-exp') {
          card?.classList.toggle('is-collapsed');
        } else if (action === 'move-exp-up' || action === 'move-exp-down') {
          event.preventDefault();
          if (!card?.parentElement) return;
          const siblings = [...card.parentElement.querySelectorAll('.exp-item-card')];
          const at = siblings.indexOf(card);
          const swapWith = action === 'move-exp-up' ? at - 1 : at + 1;
          if (swapWith < 0 || swapWith >= siblings.length) return;
          card.parentElement.insertBefore(card, action === 'move-exp-up' ? siblings[swapWith] : siblings[swapWith].nextSibling);
          renumberExpCards(card.parentElement);
        } else if (action === 'dup-exp') {
          event.preventDefault();
          if (!card?.parentElement) return;
          const clone = card.cloneNode(true);
          clone.classList.remove('is-collapsed');
          card.parentElement.insertBefore(clone, card.nextSibling);
          renumberExpCards(card.parentElement);
          showToast('已复制此段经历，记得修改内容后保存');
        } else if (action === 'del-exp-field') {
          event.preventDefault();
          // 与 del-kv / del-exp 同款：**只动 DOM，不碰 resume**。简历是「DOM 为草稿、
          // 点保存时才 collectResumeFromDom 收回」的模型；若在这里直接改 resume 再
          // renderResumeEditor()，用户在同一页其他字段里尚未保存的输入会被整体重渲染冲掉。
          // 同理不调 updateResumeCompletion()——它统计的是内存里的 resume（不是 DOM），
          // 此刻调用只会显示过期数字；计数在保存时随 renderResumeEditor 一起刷新。
          const wrap = target.closest('.exp-field-wrap');
          const name = target.getAttribute('data-key') || '该字段';
          wrap?.remove();
          showToast(`已删除字段「${name}」，点「保存简历」后生效`);
        } else if (action === 'del-kv') {
          event.preventDefault();
          const row = target.closest('.kv-row');
          const container = row?.parentElement;
          row?.remove();
          if (container && !container.querySelector('.kv-row')) {
            container.innerHTML = '<div class="resume-empty-hint">从字段库添加常用字段，或直接自定义输入</div>';
          }
        } else if (action === 'del-exp') {
          event.preventDefault();
          const parent = card?.parentElement;
          card?.remove();
          if (parent) {
            renumberExpCards(parent);
            if (!parent.querySelector('.exp-item-card')) {
              parent.innerHTML = '<div class="resume-empty-hint">还没有经历，点「＋ 添加」开始</div>';
            }
          }
        } else if (action === 'convert-section') {
          event.preventDefault();
          const block = target.closest('.resume-section-block');
          if (block) convertSectionType(block.getAttribute('data-section'));
        } else if (action === 'del-section') {
          event.preventDefault();
          const block = target.closest('.resume-section-block');
          if (!block) return;
          const name = block.getAttribute('data-section');
          confirmInApp(`确定删除区块「${name}」吗？保存后该段将从简历 JSON 中移除。`, { title: '删除区块', danger: true, confirmText: '删除' }).then(ok => {
            if (!ok) return;
            block.remove();
            updateResumeCompletion();
            showToast(`已删除区块「${name}」，点「保存简历」后生效`);
          });
        } else if (action === 'add-section') {
          event.preventDefault();
          openSectionDialog();
        }
      });
      // 字段库弹层
      $('#fieldLibraryGrid').addEventListener('click', (event) => {
        const item = event.target.closest('.field-library-item[data-field]');
        if (!item || item.classList.contains('is-added')) return;
        const name = item.getAttribute('data-field');
        const type = item.querySelector('.field-library-type')?.textContent || '';
        applyFieldFromLibrary(name, type);
      });
      $('#fieldLibraryCustomBtn').addEventListener('click', () => {
        if (!fieldLibraryContext) return;
        const name = prompt('自定义字段名称（保存后即成为插件填表匹配名）：');
        if (!name || !name.trim()) return;
        const trimmed = name.trim();
        $('#fieldLibraryDialog').close();
        applyFieldFromLibrary(trimmed, inferFieldType(trimmed));
      });
      $('#closeFieldLibraryDialog').addEventListener('click', () => $('#fieldLibraryDialog').close());
      $('#doneFieldLibraryDialog').addEventListener('click', () => $('#fieldLibraryDialog').close());
      $('#fieldLibraryDialog').addEventListener('click', event => { if (event.target === $('#fieldLibraryDialog')) $('#fieldLibraryDialog').close(); });
      $('#saveResumeBtn').addEventListener('click', collectAndSaveResume);
      $('#resumeExportBtn').addEventListener('click', exportResume);
      $('#resumeImportBtn').addEventListener('click', () => $('#resumeFileInput').click());
      $('#resumeFileInput').addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        try {
          const parsed = JSON.parse(await file.text());
          const incoming = parsed?.resume && typeof parsed.resume === 'object' ? parsed.resume : parsed;
          if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new Error('格式无效');
          resume = incoming;
          persistResume();
          renderResumeEditor();
          showToast('简历导入成功，已下发插件并纳入云同步');
        } catch (error) {
          alert(`导入失败：${error.message || '不是有效的简历 JSON 文件。'}`);
        }
      });
      $('#resumeResetBtn').addEventListener('click', async () => {
        if (!await confirmInApp('确定要清空简历全部内容并恢复默认结构吗？', { title: '重置简历', danger: true, confirmText: '清空并重置' })) return;
        resume = JSON.parse(JSON.stringify(DEFAULT_RESUME));
        persistResume();
        renderResumeEditor();
        showToast('简历已重置为默认结构');
      });

      $('#addBtn').addEventListener('click', () => openDialog());
      $('#installAppBtn').addEventListener('click', requestAppInstall);
      $('#toolSafetyBtn').addEventListener('click', openSafetyDialog);
      $('#toolIcsBtn').addEventListener('click', () => exportIcs());
      $('#exportRecordsBtn').addEventListener('click', exportData);
      $('#exportResumeBtn').addEventListener('click', exportResume);
      $('#exportIcsBtn').addEventListener('click', () => exportIcs());
      // 洞察面板：漏斗口径切换（记录 / 公司去重）+ 卡点清单点击直达记录
      $('#funnelScopeBtn').addEventListener('click', () => {
        funnelScope = funnelScope === 'company' ? 'record' : 'company';
        renderInsights();
      });
      // 洞察精简 / 完整切换（偏好存本机 ui.v1）
      $('#insightsCompactBtn').addEventListener('click', toggleInsightsCompact);
      // 悬浮明细：事件委托。mouseenter/mouseleave 不冒泡，所以用 mouseover/mouseout + relatedTarget 判定，
      // 否则在触发元素内部子节点之间移动时会反复闪烁。
      const insightsHost = $('#insightsBody');
      insightsHost.addEventListener('mouseover', event => {
        const target = event.target.closest('[data-tip-kind]');
        if (!target || target === tipTarget) return;
        showTipFor(target);
      });
      insightsHost.addEventListener('mouseout', event => {
        const target = event.target.closest('[data-tip-kind]');
        if (!target) return;
        if (event.relatedTarget && target.contains && target.contains(event.relatedTarget)) return;
        hideTip();
      });
      // 键盘用户同样能读到明细：城市行 / 指标卡 / 比例条分段都带 tabindex="0"
      insightsHost.addEventListener('focusin', event => {
        const target = event.target.closest('[data-tip-kind]');
        if (target) showTipFor(target);
      });
      insightsHost.addEventListener('focusout', () => hideTip());
      insightsHost.addEventListener('click', event => {
        if (!isCoarsePointer()) return; // 有 hover 的设备交给 mouseover，点击留给「打开抽屉」等原有动作
        const target = event.target.closest('[data-tip-kind]');
        if (!target) return;
        if (target === tipTarget) { hideTip(); return; }
        showTipFor(target);
      });
      // 滚动后浮层位置就不再贴着触发元素了：直接隐藏，比跟着重算更省事也更不容易错位。
      // capture=true 才能收到面板内部滚动容器（.table-scroll 等）的 scroll 事件。
      window.addEventListener('scroll', () => { if (tipTarget) hideTip(); }, true);
      $('#alertList').addEventListener('click', event => {
        const item = event.target.closest('.alert-item[data-id]');
        if (item) openRecordFocus(item.dataset.id);
      });
      // ===== v4.4.0：表格/看板切换、看板拖拽、详情抽屉、⌘K 命令面板 =====
      $('#viewTableBtn').addEventListener('click', () => setRecordsView('table'));
      $('#viewBoardBtn').addEventListener('click', () => setRecordsView('board'));
      // 同企业收纳开关（v4.11.0）：视觉态由 renderRecordsView 统一回填，这里只翻偏好
      $('#groupToggle').addEventListener('click', () => setGroupByCompany(!uiPrefs.groupByCompany));
      // 公司名失焦时给「拆成企业 + 机构」的建议；建议按钮是动态生成的，所以走容器委托
      $('#company').addEventListener('blur', updateOrgSplitHint);
      $('#orgUnit').addEventListener('input', updateOrgSplitHint);
      $('#orgSplitHint').addEventListener('click', event => {
        if (event.target.id !== 'orgSplitBtn') return;
        const m = matchOrgSplit($('#company').value);   // 与预览同一个判定，见 matchOrgSplit 的注释
        if (!m) return;
        $('#company').value = m[1];
        $('#orgUnit').value = m[2];
        updateOrgSplitHint();
        updateSameCompanyHint();   // 公司名变了，「该公司已有 N 个岗位」提示要跟着刷新
        showToast('已拆成企业与机构，两个都还能改');
      });
      // 看板的拖拽与点击委托统一绑在 #boardView（而不是 #boardCols）：
      // v4.17.0 起 Offer 与已结束改成了 #boardCols **外面**的两条横带，
      // 绑在 #boardCols 上的话它们的卡片既拖不动、列头也点不了，而且不报错。
      const boardView = $('#boardView');
      boardView.addEventListener('dragstart', event => {
        const card = event.target.closest('.board-card[data-id]');
        if (!card) return;
        draggingRecordId = card.dataset.id;
        card.classList.add('is-dragging');
        activateBoardDropZone(); // 有卡片被拖起 → 顶部投放区变为可投放态
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', card.dataset.id);
        }
      });
      boardView.addEventListener('dragend', () => {
        draggingRecordId = null;
        // 清理范围也要跟着放宽：横带里的卡片与 .board-row.is-drop 高亮同样需要复位，
        // 只清 .board-col 的话拖完 Offer 横带会留着一圈蓝框。
        boardView.querySelectorAll('.board-card.is-dragging').forEach(node => node.classList.remove('is-dragging'));
        boardView.querySelectorAll('.board-col.is-drop, .board-row.is-drop').forEach(node => node.classList.remove('is-drop'));
        clearBoardDropZone();
      });
      boardView.addEventListener('dragover', handleBoardDragOver);
      boardView.addEventListener('drop', handleBoardDrop);
      boardView.addEventListener('click', event => {
        // 列头 / 横带头点击 → 切到表格视图并按该阶段筛选（查看该阶段全部明细）；优先级高于卡片
        const head = event.target.closest('.board-col-head[data-stage], .board-row-head[data-stage]');
        if (head) { applyBoardColFilter(head.dataset.stage); return; }
        const card = event.target.closest('.board-card[data-id]');
        if (card) openRecordFocus(card.dataset.id);
      });
      boardView.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const head = event.target.closest('.board-col-head[data-stage], .board-row-head[data-stage]');
        if (head) { event.preventDefault(); applyBoardColFilter(head.dataset.stage); return; }
        const card = event.target.closest('.board-card[data-id]');
        if (!card) return;
        event.preventDefault();
        openRecordFocus(card.dataset.id);
      });
      // 顶部整宽推进投放区：在 #boardView 内、.board-cols 外，单独绑 dragover/dragleave/drop
      const boardDropZone = $('#boardDropZone');
      boardDropZone.addEventListener('dragover', handleDropZoneOver);
      boardDropZone.addEventListener('dragleave', handleDropZoneLeave);
      boardDropZone.addEventListener('drop', handleDropZoneDrop);
      // 抽屉：关闭（按钮 / 遮罩）、笔记增删、同公司切换、底部操作
      $('#closeDrawerBtn').addEventListener('click', closeRecordDrawer);
      $('#drawerBackdrop').addEventListener('click', closeRecordDrawer);
      $('#drawerBody').addEventListener('click', event => {
        const noteDel = event.target.closest('button[data-note-del]');
        if (noteDel) { deleteDrawerNote(noteDel.dataset.noteDel); return; }
        const sibling = event.target.closest('button[data-sibling]');
        if (sibling) { openRecordDrawer(sibling.dataset.sibling); return; }
        if (event.target.closest('#drawerNoteAddBtn')) {
          const input = $('#drawerNoteInput');
          addDrawerNote(input ? input.value : '');
        }
      });
      $('#drawerBody').addEventListener('keydown', event => {
        // 笔记输入框里 ⌘/Ctrl+Enter 快速提交
        if (event.target.id !== 'drawerNoteInput') return;
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          addDrawerNote(event.target.value);
        }
      });
      $('#drawerActions').addEventListener('click', async event => {
        const button = event.target.closest('button[data-drawer]');
        if (!button) return;
        const record = records.find(item => item.id === drawerRecordId);
        if (!record) return;
        const action = button.dataset.drawer;
        if (action === 'advance') return openAdvanceDialog(record);
        if (action === 'edit') { closeRecordDrawer(); return openDialog(record); }
        if (action === 'ics') return exportIcs(record.id);
        if (action === 'delete') return requestDeleteRecord(record);
      });
      // 命令面板
      $('#cmdInput').addEventListener('input', event => {
        cmdItems = buildCmdItems(event.target.value);
        cmdActiveIndex = 0;
        renderCmdResults();
      });
      $('#cmdInput').addEventListener('keydown', event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); moveCmdActive(1); return; }
        if (event.key === 'ArrowUp') { event.preventDefault(); moveCmdActive(-1); return; }
        if (event.key === 'Enter') { event.preventDefault(); runCmdItem(cmdActiveIndex); }
      });
      $('#cmdResults').addEventListener('click', event => {
        const item = event.target.closest('.cmd-item[data-index]');
        if (item) runCmdItem(Number(item.dataset.index));
      });
      $('#cmdResults').addEventListener('mousemove', event => {
        const item = event.target.closest('.cmd-item[data-index]');
        if (!item) return;
        const index = Number(item.dataset.index);
        if (index !== cmdActiveIndex) { cmdActiveIndex = index; renderCmdResults(); }
      });
      $('#cmdPalette').addEventListener('click', event => { if (event.target === $('#cmdPalette')) closeCmdPalette(); });
      // 全局快捷键（⌘K / N / / / ? / Esc）
      document.addEventListener('keydown', handleGlobalKeydown);
      // 首启引导 / 示例数据处置
      $('#firstRunGuide').addEventListener('click', event => {
        const button = event.target.closest('button[data-guide]');
        if (!button) return;
        const action = button.dataset.guide;
        if (action === 'clear') return clearSampleData();
        if (action === 'keep') { setSampleMode(false); uiPrefs.hideGuide = true; saveUiPrefs(); return render(); }
        if (action === 'add') return openDialog(null);
        if (action === 'demo') return loadDemoRecords();
        if (action === 'hide') { uiPrefs.hideGuide = true; saveUiPrefs(); render(); }
      });
      // 台账空状态 CTA（首启 / 筛选无结果）
      els.empty.addEventListener('click', event => {
        const button = event.target.closest('button[data-empty-action]');
        if (!button) return;
        const action = button.dataset.emptyAction;
        if (action === 'add') return openDialog(null);
        if (action === 'demo') return loadDemoRecords();
        if (action === 'clear') {
          els.search.value = '';
          els.filter.value = 'all';
          renderRecordsView();
        }
      });
      // Offer 对比矩阵：点行打开详情抽屉
      $('#offerMatrix').addEventListener('click', event => {
        const row = event.target.closest('tr[data-id]');
        if (row) openRecordFocus(row.dataset.id);
      });
      // 多岗位公司清单：点某个岗位打开详情抽屉
      $('#multiCompanyList').addEventListener('click', event => {
        const item = event.target.closest('.multi-company-item[data-id]');
        if (item) openRecordFocus(item.dataset.id);
      });
      // 未来安排卡片可点击/可键盘激活（role=button + tabindex=0）
      els.upcoming.addEventListener('click', event => {
        const item = event.target.closest('.schedule-item[data-id]');
        if (item) openRecordFocus(item.dataset.id);
      });
      els.upcoming.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const item = event.target.closest('.schedule-item[data-id]');
        if (!item) return;
        event.preventDefault();
        openRecordFocus(item.dataset.id);
      });
      $('#topSyncBtn').addEventListener('click', openSyncDialog);
      // 视图路由由 initializeRouter 接管（hashchange 驱动，支持 #/view 与旧锚点重定向）
      $('#closeDialog').addEventListener('click', closeDialog);
      $('#cancelDialog').addEventListener('click', closeDialog);
      // 新增区块弹窗（v4.11.0）：与 recordDialog 同款三处绑定 —— 提交、两个关闭按钮、
      // 点遮罩关闭。少绑任何一个都会留下「点了没反应」的死按钮。
      $('#sectionForm').addEventListener('submit', submitSectionForm);
      $('#closeSectionDialog').addEventListener('click', () => $('#sectionDialog').close());
      $('#sectionCancelBtn').addEventListener('click', () => $('#sectionDialog').close());
      $('#sectionDialog').addEventListener('click', event => { if (event.target === $('#sectionDialog')) $('#sectionDialog').close(); });
      els.form.addEventListener('submit', submitForm);
      // 公司名 / 岗位名输入时实时刷新「该公司已有 N 个岗位」提示
      $('#company').addEventListener('input', scheduleSameCompanyHint);
      $('#position').addEventListener('input', scheduleSameCompanyHint);
      $('#addTimelineBtn').addEventListener('click', addTimelineRow);
      $('#timelineEditor').addEventListener('click', event => {
        const del = event.target.closest('.tl-del');
        if (!del) return;
        if (document.querySelectorAll('#timelineEditor .tl-row').length <= 1) { showToast('至少保留一个阶段'); return; }
        del.closest('.tl-row').remove();
      });
      els.body.addEventListener('click', handleTableAction);
      // 搜索 / 筛选 / 排序变化后重渲染「当前视图」（表格或看板），两者共用同一份 getVisibleRecords
      els.search.addEventListener('input', renderRecordsView);
      els.filter.addEventListener('change', renderRecordsView);
      els.sort.addEventListener('change', renderRecordsView);
      els.dialog.addEventListener('click', event => { if (event.target === els.dialog) closeDialog(); });
      // 应用内确认框（替代原生 confirm）：确定=true，取消/Esc/点遮罩=false
      // 结算只发生一次：OK/Cancel 点击时立即 resolve，close 事件仅作 Esc / 点遮罩的兜底。
      // 不能把 resolve 只押在 close 上——部分 WebView / 内嵌浏览器不派发 <dialog> 的 close 事件，
      // 那样 await 会永久挂起，表现为「删除点了没反应」且无任何提示（浏览器实证发现）。
      function settleConfirm() {
        if (!confirmResolve) return;
        const resolve = confirmResolve;
        confirmResolve = null;
        resolve(confirmResult);
      }
      $('#confirmOkBtn').addEventListener('click', () => { confirmResult = true; confirmOutcome = 'ok'; settleConfirm(); $('#confirmDialog').close(); });
      $('#confirmCancelBtn').addEventListener('click', () => { confirmResult = false; confirmOutcome = 'cancel'; settleConfirm(); $('#confirmDialog').close(); });
      $('#confirmDialog').addEventListener('close', () => { settleConfirm(); });
      // Esc 取消：modal dialog 先派发 cancel 再派发 close，而部分环境只派发其中之一，
      // 因此两条都监听，确保 await 一定能结算。
      // Esc 记为 dismiss 而非 cancel：查重场景要能区分「用户明确选了取消按钮」与「用户什么都没选就关掉」。
      $('#confirmDialog').addEventListener('cancel', () => { confirmResult = false; confirmOutcome = 'dismiss'; settleConfirm(); });
      $('#confirmDialog').addEventListener('click', event => {
        if (event.target !== $('#confirmDialog')) return;
        confirmResult = false;
        confirmOutcome = 'dismiss'; // 点遮罩关掉同样视为「未作选择」
        settleConfirm();
        $('#confirmDialog').close();
      });
      // 推进阶段弹窗：点预设阶段直接推进；自定义则填输入框后点确认
      $('#advanceStageGrid').addEventListener('click', event => {
        const btn = event.target.closest('.advance-pick');
        if (btn) applyAdvance(btn.dataset.stage);
      });
      $('#confirmAdvanceBtn').addEventListener('click', () => applyAdvance($('#advanceCustom').value));
      $('#closeAdvanceDialog').addEventListener('click', closeAdvanceDialog);
      $('#cancelAdvanceDialog').addEventListener('click', closeAdvanceDialog);
      $('#advanceDialog').addEventListener('click', event => { if (event.target === $('#advanceDialog')) closeAdvanceDialog(); });
      window.addEventListener('message', handleCaptureMessage);
      $('#closeSafetyDialog').addEventListener('click', () => $('#safetyDialog').close());
      $('#doneSafetyDialog').addEventListener('click', () => $('#safetyDialog').close());
      $('#safetyDialog').addEventListener('click', event => { if (event.target === $('#safetyDialog')) $('#safetyDialog').close(); });
      $('#setupBackupBtn').addEventListener('click', setupAutomaticBackup);
      $('#backupNowBtn').addEventListener('click', backupNow);
      $('#importBtn').addEventListener('click', () => $('#importFileInput').click());
      $('#importFileInput').addEventListener('change', importBackupFile);
      $('#restoreSnapshotBtn').addEventListener('click', restorePreviousSnapshot);
      $('#toolSyncBtn').addEventListener('click', openSyncDialog);
      $('#closeSyncDialog').addEventListener('click', () => $('#syncDialog').close());
      $('#cancelSyncDialog').addEventListener('click', () => $('#syncDialog').close());
      $('#syncDialog').addEventListener('click', event => { if (event.target === $('#syncDialog')) $('#syncDialog').close(); });
      $('#saveSyncBtn').addEventListener('click', saveSyncSettings);
      $('#disconnectSyncBtn').addEventListener('click', disconnectSync);
      // 邮件提醒（M3）：建议卡片操作事件委托 + 重新读取
      $('#mailList').addEventListener('click', event => {
        const btn = event.target.closest('button[data-mail-action]');
        if (!btn) return;
        const id = btn.dataset.mailId;
        const action = btn.dataset.mailAction;
        if (action === 'apply') applyMailSuggestion(id);
        else if (action === 'new') openMailSeedDialog(id);
        else if (action === 'dismiss') dismissMailSuggestion(id);
        else if (action === 'reset-fields') {
          // 还原 AI 原值：删掉这封邮件的草稿再重画。改错了想回去，此前只能凭记忆重填。
          mailDrafts.delete(String(id));
          renderMailView();
        }
        else if (action === 'toggle-all') {
          // 全选 / 全不选二态切换：已全勾就全取消，否则全勾。
          // 不额外维护状态，直接读 DOM——候选列表每次渲染都会重建，存状态反而会与实际不符。
          const host = btn.closest('.mail-card');
          const boxes = host ? [...host.querySelectorAll('.mail-target-check')] : [];
          const allOn = boxes.length > 0 && boxes.every(b => b.checked);
          for (const b of boxes) b.checked = !allOn;
        }
      });
      // 就地编辑的草稿写入。用 input 事件（而不是 change）：日期/文本框每次改动都记，
      // 否则用户改完直接点「应用所选」而没触发 blur/change 时，草稿是空的——
      // 不过 apply 直接读 DOM，所以草稿只影响"重渲染后能不能保住改动"。
      $('#mailList').addEventListener('input', event => {
        const el = event.target.closest('[data-mail-edit]');
        if (!el) return;
        const card = el.closest('.mail-card');
        if (!card) return;
        const key = String(card.dataset.mailId || '');
        if (!key) return;
        const d = mailDrafts.get(key) || {};
        d[el.dataset.mailEdit] = el.value;
        mailDrafts.set(key, d);
      });
      $('#mailRefreshBtn').addEventListener('click', () => {
        if (!syncConfig.token) { openSyncDialog(); return; }
        showToast('正在重新读取邮件建议…');
        syncNow('manual');
      });
      $('#mailSettingsBtn').addEventListener('click', openMailSettings);
      $('#mailGenEncKeyBtn').addEventListener('click', generateMailEncKey);
      $('#saveMailSettingsBtn').addEventListener('click', saveMailSettings);
      $('#closeMailSettingsDialog').addEventListener('click', () => $('#mailSettingsDialog').close());
      $('#cancelMailSettingsDialog').addEventListener('click', () => $('#mailSettingsDialog').close());
      $('#mailSettingsDialog').addEventListener('click', event => { if (event.target === $('#mailSettingsDialog')) $('#mailSettingsDialog').close(); });
      $('#closeInstallDialog').addEventListener('click', () => $('#installDialog').close());
      $('#doneInstallDialog').addEventListener('click', () => $('#installDialog').close());
      $('#installDialog').addEventListener('click', event => { if (event.target === $('#installDialog')) $('#installDialog').close(); });
      initializeDataSafety();
      initializeMobileApp();
      initializeCloudSync();
      // 简历下发：本地非空简历推给同页插件（content script 注入时机不确定，重试覆盖）
      if (!isResumeEmpty(resume)) {
        setTimeout(pushResumeToPlugin, 1000);
        setTimeout(pushResumeToPlugin, 3000);
      }
