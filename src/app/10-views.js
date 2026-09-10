
      // ================= 查重统一处置（v4.5.0）=================
      // 三条建记录入口（手填 submitForm / 岗位库「记为已投递」/ 插件推送 handleCaptureMessage）统一走这里。
      // 铁律：任何「疑似重复」都必须给人工逃生口，绝不静默拦截、绝不静默改写既有记录。
      // 修复前：岗位库路径是 `return showToast('这条岗位已经在投递记录中')` —— 直接 return，点几次都只有
      //        一句提示，看起来像按钮坏了；插件路径直接 openDialog(既有记录) 并自动 setTimeline 追加里程碑，
      //        既没有「仍然新增」选项，又会把第二个岗位的信息污染进第一个岗位。
      //        这两条硬拦截叠加「岗位归一化删括号」的误判，就是「同一家公司录不进第二个岗位」的根因。
      // 返回 { action:'add'|'edit'|'cancel', target, hint }：
      //   add    → 调用方继续新增；hint 非空时请并进保存 toast（单独 showToast 会被随后的 toast 顶掉）
      //   edit   → 调用方应打开 target 编辑，不要新增
      //   cancel → 用户按 Esc / 点遮罩关掉了确认框，既没选新增也没选编辑 → 中止本次入库，什么都不写
      async function resolveDuplicate(dup, seed) {
        if (!dup) return { action: 'add', target: null, hint: '' };
        const label = String((seed && seed.company) || '该公司');
        const countHint = `（${label} 名下现在共 ${dup.matches.length + 1} 个岗位）`;
        if (dup.mode === 'same-company') {
          // 同公司不同岗位：完全合法，只做非阻断提示，不打断录入
          return { action: 'add', target: null, hint: countHint };
        }
        const target = dup.matches[0];
        const targetLabel = `${target.company} · ${positionWithUnit(target.position, target.orgUnit, true)}`;
        if (dup.mode === 'variant') {
          // 疑似同一岗位的不同方向 / 城市 / 机构：绝大多数情况确实是两条独立投递，故主按钮是「新增」
          const isSeparate = await confirmInApp(
            `${label} 已有相似岗位「${targetLabel}」（当前阶段：${target.stage}）。\n\n这条是不同方向 / 城市 / 机构的独立投递吗？`,
            { title: '疑似同岗位不同方向', confirmText: '是独立投递，新增', cancelText: '其实是同一条，编辑已有' }
          );
          if (lastConfirmOutcome() === 'dismiss') return { action: 'cancel', target: null, hint: '' };
          return isSeparate
            ? { action: 'add', target: null, hint: countHint }
            : { action: 'edit', target, hint: '' };
        }
        // duplicate：默认倾向「编辑已有」，避免重复堆积；但始终保留「仍然新增」的逃生口
        const goEdit = await confirmInApp(
          `「${targetLabel}」已经在台账里（当前阶段：${target.stage}）。\n\n改为编辑这条已有记录，还是仍然新增一条？`,
          { title: '疑似重复投递', confirmText: '编辑已有记录', cancelText: '仍然新增' }
        );
        if (lastConfirmOutcome() === 'dismiss') return { action: 'cancel', target: null, hint: '' };
        return goEdit ? { action: 'edit', target, hint: '' } : { action: 'add', target: null, hint: '' };
      }

      // ---- 录入时前置提示：这家公司已经有哪几个岗位（v4.5.0）----
      // 让用户在**录入过程中**就知道自己是在加第二个岗位，而不是提交后被查重弹窗拦住才反应过来。
      // 判定与查重、展示分组同源（companyGroupKey + sameCompanyGroup），三处不会再给出不同结论。
      function updateSameCompanyHint() {
        const box = $('#sameCompanyHint');
        if (!box) return;
        const companyInput = $('#company'), positionInput = $('#position');
        const company = String((companyInput && companyInput.value) || '').trim();
        if (company.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
        const key = companyGroupKey({ company });
        // 编辑态排除自身：否则编辑一条记录时会把自己也算成「已有岗位」
        const siblings = records.filter(record => record.id !== editingId && sameCompanyGroup(companyGroupKey(record), key));
        if (!siblings.length) { box.hidden = true; box.innerHTML = ''; return; }
        const loose = loosePositionSlug(String((positionInput && positionInput.value) || ''));
        const items = siblings.slice(0, 4).map(record => {
          // 与当前正在填的岗位「宽松相等」→ 标黄，提示保存时会再确认一次是不是同一条
          const similar = loose.length >= 2 && loosePositionSlug(record.position) === loose;
          return `<span class="same-company-item${similar ? ' is-similar' : ''}">${escapeHtml(positionWithUnit(record.position || '未填岗位', record.orgUnit, true))} · ${escapeHtml(record.stage)}</span>`;
        }).join('');
        const more = siblings.length > 4 ? `<span class="same-company-more">等 ${siblings.length} 个</span>` : '';
        box.innerHTML = `该公司已有 ${siblings.length} 个岗位：${items}${more}`;
        box.hidden = false;
      }
      // 公司名 / 岗位名变化时刷新提示（debounce，避免逐字符重算整份台账）
      let sameCompanyHintTimer = null;
      function scheduleSameCompanyHint() {
        clearTimeout(sameCompanyHintTimer);
        sameCompanyHintTimer = setTimeout(updateSameCompanyHint, 250);
      }

      // ================= 台账视图增强（v4.4.0）：UI 偏好 / 看板 / 详情抽屉 / ⌘K 命令面板 =================
      let uiPrefs = loadUiPrefs();
      let drawerRecordId = null;   // 当前抽屉展示的记录 id
      let cmdItems = [];           // 命令面板当前结果
      let cmdActiveIndex = 0;      // 命令面板高亮项
      let draggingRecordId = null; // 看板拖拽中的记录 id

      function loadUiPrefs() {
        try {
          const parsed = JSON.parse(localStorage.getItem(UI_STORAGE_KEY) || '{}');
          return {
            recordsView: parsed.recordsView === 'board' ? 'board' : 'table',
            collapsedGroups: Array.isArray(parsed.collapsedGroups) ? parsed.collapsedGroups.map(String) : [],
            // 同企业收纳开关（v4.11.0）：纯 UI 偏好，按既有惯例只存本机 ui.v1、不进云同步 envelope
            groupByCompany: !!parsed.groupByCompany,
            hideGuide: !!parsed.hideGuide,
            // 洞察精简模式（v4.6.0）：只显示概览 / 需要关注 / 转化漏斗，明细块整体折叠
            insightsCompact: !!parsed.insightsCompact
          };
        } catch (_) {
          return { recordsView: 'table', collapsedGroups: [], groupByCompany: false, hideGuide: false, insightsCompact: false };
        }
      }
      function saveUiPrefs() {
        try { localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(uiPrefs)); } catch (_) {}
      }

      // 推进到指定阶段（看板拖拽 / 抽屉 / 命令面板共用）：永远是「追加一条里程碑」，历史不被删除。
      // 向更早阶段移动属于回退，需二次确认，避免拖拽误操作。
      async function advanceRecordTo(record, stage, options = {}) {
        const target = String(stage || '').trim();
        if (!record || !target || record.stage === target) return false;
        const backward = stageOrder(target) < stageOrder(record.stage);
        if (backward && !options.force) {
          const ok = await confirmInApp(
            `「${record.company} · ${record.position}」当前在「${record.stage}」，确定回退到「${target}」吗？\n回退同样是追加一条里程碑，历史记录不会被删除。`,
            { title: '回退阶段', danger: true, confirmText: '确认回退' }
          );
          if (!ok) return false;
        }
        const at = options.at || localDateInput(new Date());
        setTimeline(record, [...(record.timeline || []), { stage: target, at, note: String(options.note || '') }]);
        saveRecords(target === 'Offer' ? '已盖章：Offer' : `已推进到「${target}」并自动保存`);
        render();
        flashRow(record.id);
        if (drawerRecordId === record.id) renderDrawer();
        if (target === 'Offer') playOfferStamp();
        return true;
      }

      // ---- 表格 / 看板 切换 ----
      function setRecordsView(mode) {
        uiPrefs.recordsView = mode === 'board' ? 'board' : 'table';
        saveUiPrefs();
        renderRecordsView();
      }
      // 企业组折叠：折叠态存本机 ui 偏好（上限 100 个键防膨胀）
      function toggleCompanyGroup(key) {
        const value = String(key || '');
        if (!value) return;
        const set = new Set(uiPrefs.collapsedGroups);
        if (set.has(value)) set.delete(value); else set.add(value);
        uiPrefs.collapsedGroups = [...set].slice(-100);
        saveUiPrefs();
        renderRecordsView();
      }
      // 「同企业收纳」开关：与排序正交（排序决定顺序，开关决定要不要插组头）
      function setGroupByCompany(on) {
        uiPrefs.groupByCompany = !!on;
        saveUiPrefs();
        renderRecordsView();
      }
      // 列头点击联动阶段筛选（v4.8.0）：把 #stageFilter 设为该阶段并切到表格视图，查看该阶段的全部明细。
      // 看板列都来自「出现过的阶段 + Offer/已结束」，这些值一定在 refreshStageFilter 生成的选项里，不会落空。
      function applyBoardColFilter(stage) {
        const value = String(stage || '');
        if (!value) return;
        if (els.filter) els.filter.value = value;
        setRecordsView('table');
      }
      // 记录视图工具条信息（v4.8.0）：台账移出总览后，这里补上「进行中 / 停滞」两个概览数字，
      // 口径与洞察完全一致（isActive / findStalled），避免出现两套算法。
      function updateResultCaption(visibleCount) {
        if (!els.caption) return;
        const now = new Date();
        const active = records.filter(isActive).length;
        const stalled = findStalled(records, now, 14).length;
        const base = visibleCount === records.length
          ? `已投台账 · 共 ${records.length} 条记录`
          : `已投台账 · 显示 ${visibleCount} 条，共 ${records.length} 条`;
        els.caption.textContent = `${base} · 进行中 ${active} · 停滞 ${stalled}`;
      }
      // 台账渲染总入口：搜索/筛选/排序变化与 render() 都走这里，保证两种视图不会各渲染一半。
      // 切换按钮的选中态也在这里同步，避免启动时按 HTML 默认值显示成「表格」而实际是看板。
      function renderRecordsView() {
        const board = $('#boardView');
        const scroll = $('#recordsTableScroll');
        const isBoard = uiPrefs.recordsView === 'board';
        const tableBtn = $('#viewTableBtn'), boardBtn = $('#viewBoardBtn');
        if (tableBtn) { tableBtn.classList.toggle('is-active', !isBoard); tableBtn.setAttribute('aria-selected', String(!isBoard)); }
        if (boardBtn) { boardBtn.classList.toggle('is-active', isBoard); boardBtn.setAttribute('aria-selected', String(isBoard)); }
        // 收纳开关的态在这里同步（而不是在 click 处理里）：刷新后、云同步拉回数据后
        // 都要重新渲染视图，走同一条路才不会漏掉某一次的状态回填。
        const groupBtn = $('#groupToggle');
        if (groupBtn) {
          groupBtn.classList.toggle('is-active', !!uiPrefs.groupByCompany);
          groupBtn.setAttribute('aria-pressed', String(!!uiPrefs.groupByCompany));
        }
        if (board) board.hidden = !isBoard;
        if (scroll) scroll.hidden = isBoard;
        if (isBoard) renderBoard(); else renderTable();
        // 空状态只在表格视图显示（看板自带列与「拖到这里」占位）；三态渲染见 renderEmptyState
        const visibleCount = getVisibleRecords().length;
        updateResultCaption(visibleCount);
        if (isBoard) { if (els.empty) { els.empty.hidden = true; els.empty.innerHTML = ''; } } else { renderEmptyState(visibleCount); }
      }

      function intentDotsHtml(intent) {
        const n = Math.min(5, Math.max(0, Number(intent) || 0));
        if (!n) return '';
        return `<span class="intent-dots" title="意向度 ${n}/5">${Array.from({ length: 5 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
      }

      // 企业性质小徽章（v4.6.0）：未设置时返回空串，不占位。
      // data-ct 驱动配色（--ct-soe/--ct-private/--ct-foreign），与阶段色阶完全独立，避免两套语义混色。
      function companyTypeChipHtml(companyType) {
        const value = String(companyType || '').trim();
        if (!COMPANY_TYPES.includes(value)) return '';
        return `<span class="ct-chip" data-ct="${escapeHtml(value)}">${escapeHtml(value)}</span>`;
      }

      // 看板列 = 当前可见记录里出现过的阶段（按 stageOrder 排序）+ 末尾固定 Offer / 已结束（便于拖入）
      function boardColumns(visible) {
        const present = new Set(visible.map(r => String(r.stage || '待投递')));
        present.add('Offer');
        present.add('已结束');
        return [...present].sort((a, b) => stageOrder(a) - stageOrder(b) || String(a).localeCompare(String(b), 'zh-CN'));
      }

      function boardCardHtml(record, groupKeyById, stalledDays) {
        const key = (groupKeyById && groupKeyById.get(record.id)) || companyGroupKey(record);
        const dl = deadlineInfo(record.deadline);
        const dlClosed = ['Offer', '已结束'].includes(record.stage);
        const schedule = parseLocal(record.scheduleAt);
        const stalled = Number(stalledDays) > 0 ? Math.round(Number(stalledDays)) : 0;
        const chips = [];
        // 批次 chip 已随字段删除；机构不做成 chip —— 它已经跟在卡片的公司名后面
        // （boardCardHtml 的 .board-card-unit），再做一个 chip 就是同一信息出现两次。
        if (dl && !dlClosed) chips.push(`<span class="board-chip ${dl.level}">${escapeHtml(dl.text.replace('截止 · ', ''))}</span>`);
        if (schedule && !dlClosed) chips.push(`<span class="board-chip">${escapeHtml(formatDateTime(record.scheduleAt))}</span>`);
        if (stalled) chips.push(`<span class="board-chip stalled">停滞 ${stalled} 天</span>`);
        const dots = intentDotsHtml(record.intent);
        return `<button class="board-card${stalled ? ' is-stalled' : ''}" type="button" draggable="true" data-id="${escapeHtml(record.id)}" style="--company-color:${companyColor(key)}" title="${escapeHtml(record.company)} · ${escapeHtml(record.position)}">
          <div class="board-card-company">${escapeHtml(record.company)}${record.orgUnit ? `<span class="board-card-unit"> · ${escapeHtml(record.orgUnit)}</span>` : ''}</div>
          <div class="board-card-position">${escapeHtml(record.position || '—')}</div>
          <div class="board-card-meta">${dots}${companyTypeChipHtml(record.companyType)}${chips.join('')}</div>
        </button>`;
      }

      function renderBoard() {
        const host = $('#boardCols');
        if (!host) return;
        const visible = getVisibleRecords();
        const columns = boardColumns(visible);
        // 公司规范键建一次即可（不能在 map 回调里直接传 boardCardHtml，否则数组下标会被当成第二个参数）
        const groupKeyById = companyGroupIndex(records);
        // 停滞天数一次算好（复用洞察的 findStalled 口径），卡片据此加警示标记——操作面一眼看到该跟进谁
        const stalledById = new Map(findStalled(records, new Date(), 14).map(item => [item.record.id, item.days]));
        host.innerHTML = columns.map(stage => {
          const items = visible.filter(r => String(r.stage || '待投递') === stage);
          return `<section class="board-col" data-stage="${escapeHtml(stage)}" aria-label="${escapeHtml(stage)} 列">
            <div class="board-col-head" data-stage="${escapeHtml(stage)}" role="button" tabindex="0" title="点击在表格视图查看「${escapeHtml(stage)}」阶段的全部明细"><span class="badge badge-sm" data-stage="${escapeHtml(stage)}">${escapeHtml(stage)}</span><span class="board-col-count">${items.length}</span></div>
            <div class="board-col-body">${items.length ? items.map(item => boardCardHtml(item, groupKeyById, stalledById.get(item.id))).join('') : '<div class="board-empty">拖到这里</div>'}</div>
          </section>`;
        }).join('');
      }

      // 看板拖拽：dragover 时高亮当前列并清除其它列（dragleave 在子元素间频繁触发，不用它做状态管理）
      function handleBoardDragOver(event) {
        const col = event.target.closest('.board-col');
        if (!col || !draggingRecordId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.board-col.is-drop').forEach(node => { if (node !== col) node.classList.remove('is-drop'); });
        col.classList.add('is-drop');
      }
      async function handleBoardDrop(event) {
        const col = event.target.closest('.board-col');
        document.querySelectorAll('.board-col.is-drop').forEach(node => node.classList.remove('is-drop'));
        clearBoardDropZone();
        if (!col) return;
        event.preventDefault();
        const id = (event.dataTransfer && event.dataTransfer.getData('text/plain')) || draggingRecordId;
        draggingRecordId = null;
        const record = records.find(item => item.id === id);
        if (!record) return;
        // 拖到「已结束」列：改为打开推进弹窗并预填结束原因引导（拒信 / 主动放弃 / 超期未响应，对复盘有价值），
        // 而不是像其它列那样一键直达；不新增字段、不改 schema，note 仍是既有里程碑字段。
        if (col.dataset.stage === '已结束') {
          openAdvanceDialog(record, { note: '结束原因（拒信 / 主动放弃 / 超期未响应）：' });
          return;
        }
        await advanceRecordTo(record, col.dataset.stage);
      }

      // ---- 看板顶部整宽推进投放区（v4.8.0）----
      // 痛点：boardColumns 只生成「当前有记录的阶段 + Offer/已结束」，想推进到三面/交叉面这类当前无记录的
      // 阶段时根本没有列可拖。投放区常驻看板顶部（不随 .board-cols 横向滚动），拖入后复用推进弹窗自由选阶段。
      // 与「直接拖到阶段列」的快捷路径并存：投放区在 #boardView 内、.board-cols 外，单独绑事件。
      function setBoardDropText(state) {
        const text = $('#boardDropText');
        if (text) text.textContent = state === 'drop' ? '松开以选择阶段' : state === 'active' ? '拖到这里选择阶段' : '拖到这里，自由选择阶段（含没有列的阶段）';
      }
      function activateBoardDropZone() {
        const zone = $('#boardDropZone');
        if (zone) zone.classList.add('is-active');
        setBoardDropText('active');
      }
      function clearBoardDropZone() {
        const zone = $('#boardDropZone');
        if (zone) { zone.classList.remove('is-active'); zone.classList.remove('is-drop'); }
        setBoardDropText('default');
      }
      function handleDropZoneOver(event) {
        if (!draggingRecordId) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        const zone = $('#boardDropZone');
        if (zone) zone.classList.add('is-drop');
        setBoardDropText('drop');
      }
      function handleDropZoneLeave() {
        const zone = $('#boardDropZone');
        if (zone) zone.classList.remove('is-drop');
        if (draggingRecordId) setBoardDropText('active');
      }
      async function handleDropZoneDrop(event) {
        event.preventDefault();
        clearBoardDropZone();
        const id = (event.dataTransfer && event.dataTransfer.getData('text/plain')) || draggingRecordId;
        draggingRecordId = null;
        const record = records.find(item => item.id === id);
        // 复用现有推进弹窗（阶段网格已按 stageOrder 过滤出更靠后的阶段、支持自定义阶段与日期），
        // 用户选定后走既有 applyAdvance → setTimeline / saveRecords / render / flashRow / 抽屉重渲 / Offer 印章全自动继承。
        if (record) openAdvanceDialog(record);
      }

      // ---- 记录详情抽屉 ----
      function openRecordDrawer(id) {
        const record = records.find(item => item.id === id);
        if (!record) return;
        drawerRecordId = record.id;
        renderDrawer();
        const drawer = $('#recordDrawer'), backdrop = $('#drawerBackdrop');
        if (drawer) drawer.hidden = false;
        if (backdrop) backdrop.hidden = false;
        document.body.style.overflow = 'hidden';
        requestAnimationFrame(() => { const close = $('#closeDrawerBtn'); if (close) close.focus(); });
      }
      function closeRecordDrawer() {
        drawerRecordId = null;
        const drawer = $('#recordDrawer'), backdrop = $('#drawerBackdrop');
        if (drawer) drawer.hidden = true;
        if (backdrop) backdrop.hidden = true;
        document.body.style.overflow = '';
      }

      // 抽屉用的是普通 <aside> 而不是 <dialog>，浏览器不会自动困住焦点，
      // 因此手动实现 Tab 循环：并处理「焦点还留在背景里」的情况（首次 Tab 直接拉进抽屉）。
      const DRAWER_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      function trapFocusInDrawer(event) {
        const drawer = $('#recordDrawer');
        if (!drawer || drawer.hidden) return;
        const items = [...drawer.querySelectorAll(DRAWER_FOCUSABLE)].filter(node => node.offsetParent !== null || node === document.activeElement);
        if (!items.length) { event.preventDefault(); return; }
        const active = document.activeElement;
        const inside = !!(active && drawer.contains && drawer.contains(active));
        event.preventDefault();
        if (!inside) { items[0].focus(); return; }
        const index = items.indexOf(active);
        const next = event.shiftKey
          ? (index <= 0 ? items[items.length - 1] : items[index - 1])
          : (index === -1 || index >= items.length - 1 ? items[0] : items[index + 1]);
        if (next && next.focus) next.focus();
      }

      // 时间线步骤条：每个里程碑一个节点，显示日期、备注与「距上一步 N 天」
      function stepsHtml(record) {
        const timeline = Array.isArray(record.timeline) ? record.timeline : [];
        if (!timeline.length) return '<div class="insight-empty">还没有里程碑</div>';
        let prev = null;
        return `<div class="steps">${timeline.map(milestone => {
          const stage = String(milestone.stage || '');
          const date = parseDay(milestone.at);
          const gap = prev && date ? Math.round((date - prev) / 86400000) : null;
          if (date) prev = date;
          return `<div class="step" data-stage="${escapeHtml(stage)}">
            <div class="step-rail"><span class="step-dot"></span></div>
            <div class="step-main">
              <div class="step-top"><span class="badge badge-sm" data-stage="${escapeHtml(stage)}">${escapeHtml(stage)}</span><span class="step-date">${escapeHtml(milestone.at ? formatDate(String(milestone.at).slice(0, 10)) : '未填日期')}</span>${gap != null && gap >= 0 ? `<span class="step-gap">距上一步 ${gap} 天</span>` : ''}</div>
              ${milestone.note ? `<div class="step-note">${escapeHtml(milestone.note)}</div>` : ''}
            </div>
          </div>`;
        }).join('')}</div>`;
      }

      function renderDrawer() {
        const record = records.find(item => item.id === drawerRecordId);
        const body = $('#drawerBody'), actions = $('#drawerActions'), title = $('#drawerTitle'), sub = $('#drawerSub');
        if (!record) { closeRecordDrawer(); return; }
        if (title) title.textContent = `${record.company} · ${record.position || '未填岗位'}`;
        if (sub) {
          const bits = [record.city, record.orgUnit].filter(Boolean);
          // 企业性质用带色徽章紧跟阶段徽章；facts 里的 value 是 HTML，两处都能安全注入
          sub.innerHTML = `<span class="badge badge-sm" data-stage="${escapeHtml(record.stage)}">${escapeHtml(record.stage)}</span>${companyTypeChipHtml(record.companyType)} ${escapeHtml(bits.join(' · '))}`;
        }
        const dl = deadlineInfo(record.deadline);
        // facts 的 value 默认会被 escapeHtml；只有这两个是「我们自己生成的、内部已转义过的 HTML」，
        // 需要原样注入。新增可信 HTML 行时必须显式加进这个白名单，否则会被转义成字面标签文本
        // （企业性质徽章第一次加进来时就踩了：抽屉里显示成 &lt;span class="ct-chip"…）。
        const HTML_FACT_LABELS = ['投递网址', '企业性质'];
        const facts = [
          // 机构排在最前：它限定的是标题里那个公司名（「招商银行 · 杭州分行」），
          // 放在末尾会让人先读完一圈日期与阶段才知道这条到底属于哪个分行。
          { label: '机构', value: record.orgUnit || '—' },
          { label: '投递日期', value: formatDate(record.applicationDate) },
          { label: '企业性质', value: companyTypeChipHtml(record.companyType) || '<span class="muted-text">未设置</span>' },
          { label: '安排时间', value: record.scheduleAt ? formatDateTime(record.scheduleAt) : '—' },
          { label: '截止日期', value: record.deadline ? `${formatDate(record.deadline)}${dl ? `（${dl.text.replace('截止 · ', '')}）` : ''}` : '—' },
          { label: '意向度', value: record.intent ? `${record.intent} / 5` : '未设' },
          { label: '内推人', value: record.referral || '—' },
          { label: '薪资 / 待遇', value: record.salary || '—' },
          { label: '投递网址', value: record.applicationUrl ? '<a class="company-link" href="' + escapeHtml(record.applicationUrl) + '" target="_blank" rel="noopener noreferrer">打开 ↗</a>' : '—' }
        ];
        // 同公司其它投递：按「该记录所在的聚类组」取，比比较键更稳（组键是聚类后的规范键）
        const siblingGroup = groupRecordsByCompany(records)
          .find(group => group.records.some(item => item.id === record.id));
        const others = siblingGroup ? siblingGroup.records.filter(item => item.id !== record.id) : [];
        const notes = Array.isArray(record.notes) ? record.notes : [];
        if (body) {
          body.innerHTML = `
            <div class="drawer-section"><h3>里程碑时间线</h3>${stepsHtml(record)}</div>
            <div class="drawer-section"><h3>关键信息</h3><dl class="drawer-facts">${facts.map(fact => `<div class="drawer-fact"><dt>${escapeHtml(fact.label)}</dt><dd>${HTML_FACT_LABELS.includes(fact.label) ? fact.value : escapeHtml(fact.value)}</dd></div>`).join('')}</dl></div>
            <div class="drawer-section"><h3>下一步行动</h3><div class="note-text">${escapeHtml(record.nextAction || '—')}</div></div>
            <div class="drawer-section">
              <h3>笔记 / 面经（${notes.length}）</h3>
              <div class="note-list">${notes.length ? notes.slice().reverse().map(note => `
                <div class="note-item">
                  <div class="note-item-head"><span>${escapeHtml(formatDateTime(new Date(Number(note.at) || Date.now())))}</span><button class="text-button danger" type="button" data-note-del="${escapeHtml(note.id)}">删除</button></div>
                  <div class="note-text">${escapeHtml(note.text)}</div>
                </div>`).join('') : '<div class="insight-empty">还没有笔记，可以记面试题目、HR 说法、跟进结果</div>'}</div>
              <div class="note-add" style="margin-top:9px">
                <textarea class="control" id="drawerNoteInput" rows="2" maxlength="1000" placeholder="例如：一面问了项目难点与复盘，面试官是业务负责人"></textarea>
                <div><button class="btn btn-small btn-primary" type="button" id="drawerNoteAddBtn">添加笔记</button></div>
              </div>
            </div>
            ${others.length ? `<div class="drawer-section"><h3>同公司其它投递（${others.length}）</h3><div class="sibling-list">${others.map(item => `
              <button class="sibling-item" type="button" data-sibling="${escapeHtml(item.id)}"><span>${escapeHtml(positionWithUnit(item.position || '未填岗位', item.orgUnit))}</span><span class="badge badge-sm" data-stage="${escapeHtml(item.stage)}">${escapeHtml(item.stage)}</span></button>`).join('')}</div></div>` : ''}`;
        }
        if (actions) {
          actions.innerHTML = `
            <button class="btn btn-small btn-primary" type="button" data-drawer="advance">推进阶段</button>
            <button class="btn btn-small" type="button" data-drawer="edit">编辑</button>
            <button class="btn btn-small" type="button" data-drawer="ics">导出到日历</button>
            <span class="spacer"></span>
            <button class="btn btn-small btn-danger" type="button" data-drawer="delete">删除</button>`;
        }
      }

      function addDrawerNote(text) {
        const record = records.find(item => item.id === drawerRecordId);
        const value = String(text || '').trim();
        if (!record || !value) { showToast('请先输入笔记内容'); return; }
        record.notes = [...(Array.isArray(record.notes) ? record.notes : []), { id: cryptoId(), at: Date.now(), text: value }];
        record.updatedAt = Date.now();
        saveRecords('已添加笔记');
        render();
        renderDrawer();
      }
      // 笔记（面经）是有价值且不可再生的内容：删除给 6 秒撤销，防护等级与删除整条记录对齐
      let lastDeletedNote = null; // { recordId, note, index }
      function deleteDrawerNote(noteId) {
        const record = records.find(item => item.id === drawerRecordId);
        if (!record) return;
        const list = Array.isArray(record.notes) ? record.notes : [];
        const index = list.findIndex(note => note.id === noteId);
        if (index === -1) return;
        lastDeletedNote = { recordId: record.id, note: list[index], index };
        record.notes = list.filter(note => note.id !== noteId);
        record.updatedAt = Date.now();
        saveRecords(); // 不传 message：由下面带「撤销」的 toast 统一提示，避免两条 toast 互相顶掉
        render();
        renderDrawer();
        showToast('已删除笔记', { actionLabel: '撤销', duration: 6000, onAction: undoDeleteNote });
      }
      function undoDeleteNote() {
        const pending = lastDeletedNote;
        lastDeletedNote = null;
        if (!pending) return;
        const record = records.find(item => item.id === pending.recordId);
        if (!record) { showToast('这条记录已不存在，无法恢复笔记'); return; }
        const list = Array.isArray(record.notes) ? record.notes.slice() : [];
        list.splice(Math.min(Math.max(pending.index, 0), list.length), 0, pending.note);
        record.notes = list;
        record.updatedAt = Date.now();
        saveRecords('已恢复笔记');
        render();
        if (drawerRecordId === record.id) renderDrawer();
      }

      // ---- ⌘K 命令面板 ----
      function isTypingTarget(node) {
        if (!node) return false;
        const tag = String(node.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable === true;
      }
      // 命令面板候选：记录 / 视图 / 动作。query 为空时给默认清单（最近记录 + 全部视图与动作）
      function buildCmdItems(query) {
        const q = String(query || '').trim().toLowerCase();
        const items = [];
        const matched = q
          ? records.filter(record => `${record.company} ${record.orgUnit || ''} ${record.position} ${record.city}`.toLowerCase().includes(q))
          : records.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5);
        for (const record of matched.slice(0, 8)) {
          items.push({
            group: '记录', label: `${record.company} · ${record.position || '未填岗位'}`,
            sub: record.stage, run: () => openRecordFocus(record.id)
          });
        }
        const views = [
          { label: '总览', hash: '#/overview' }, { label: '投递记录', hash: '#/records' }, { label: '邮件提醒', hash: '#/mail' },
          { label: '我的简历', hash: '#/resume' }, { label: '工具', hash: '#/tools' }
        ];
        for (const view of views) {
          if (q && !view.label.toLowerCase().includes(q) && !view.hash.includes(q)) continue;
          items.push({ group: '跳转', label: view.label, sub: view.hash, run: () => { location.hash = view.hash; } });
        }
        const actions = [
          { label: '新增投递', sub: 'N', run: () => openDialog(null) },
          { label: uiPrefs.recordsView === 'board' ? '切换为表格视图' : '切换为看板视图', sub: '台账', run: () => setRecordsView(uiPrefs.recordsView === 'board' ? 'table' : 'board') },
          { label: '立即云同步', sub: '同步', run: () => { if (!syncConfig.token) { openSyncDialog(); return; } syncNow('manual'); } },
          { label: '导出投递记录 JSON', sub: '备份', run: () => exportData() },
          { label: '导出日程到日历 .ics', sub: '日程', run: () => exportIcs() },
          { label: '导出简历 JSON', sub: '简历', run: () => exportResume() },
          { label: '打开截图识别', sub: '工具', run: () => { location.hash = '#/tools'; openScreenshotDialog(); } },
          { label: '打开数据安全', sub: '工具', run: () => { location.hash = '#/tools'; openSafetyDialog(); } },
          { label: '打开云同步设置', sub: '工具', run: () => openSyncDialog() },
          { label: '打开邮件提醒设置', sub: '邮件', run: () => { location.hash = '#/mail'; openMailSettings(); } },
          { label: '搜索台账', sub: '/', run: () => { location.hash = '#/records'; if (els.search) els.search.focus(); } }
        ];
        for (const action of actions) {
          if (q && !`${action.label} ${action.sub}`.toLowerCase().includes(q)) continue;
          items.push({ group: '动作', label: action.label, sub: action.sub, run: action.run });
        }
        return items;
      }
      function renderCmdResults() {
        const host = $('#cmdResults');
        if (!host) return;
        if (!cmdItems.length) {
          host.innerHTML = '<div class="cmd-empty">没有匹配的记录、视图或动作</div>';
          return;
        }
        let lastGroup = null;
        host.innerHTML = cmdItems.map((item, index) => {
          const head = item.group !== lastGroup ? `<div class="cmd-group">${escapeHtml(item.group)}</div>` : '';
          lastGroup = item.group;
          return `${head}<button class="cmd-item${index === cmdActiveIndex ? ' is-active' : ''}" type="button" role="option" data-index="${index}" aria-selected="${index === cmdActiveIndex}">
            <span class="cmd-item-main">${escapeHtml(item.label)}</span><span class="cmd-item-sub">${escapeHtml(item.sub || '')}</span>
          </button>`;
        }).join('');
        const active = host.querySelector('.cmd-item.is-active');
        if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
      }
      function openCmdPalette() {
        const dialog = $('#cmdPalette');
        if (!dialog) return;
        cmdItems = buildCmdItems('');
        cmdActiveIndex = 0;
        const input = $('#cmdInput');
        if (input) input.value = '';
        dialog.showModal();
        renderCmdResults();
        requestAnimationFrame(() => { if (input) input.focus(); });
      }
      function closeCmdPalette() {
        const dialog = $('#cmdPalette');
        if (dialog && dialog.open) dialog.close();
      }
      function moveCmdActive(delta) {
        if (!cmdItems.length) return;
        cmdActiveIndex = (cmdActiveIndex + delta + cmdItems.length) % cmdItems.length;
        renderCmdResults();
      }
      function runCmdItem(index) {
        const item = cmdItems[index];
        if (!item) return;
        closeCmdPalette();
        // 等 dialog 关闭后再执行，避免动作里再开弹窗时被 close 事件连带关掉
        setTimeout(() => { try { item.run(); } catch (error) { showToast(`执行失败：${error.message}`); } }, 0);
      }

      // 全局快捷键：⌘K/Ctrl+K 命令面板、N 新增、/ 搜索台账、Esc 关抽屉
      function handleGlobalKeydown(event) {
        if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 'k') {
          event.preventDefault();
          const dialog = $('#cmdPalette');
          if (dialog && dialog.open) closeCmdPalette(); else openCmdPalette();
          return;
        }
        if (event.key === 'Escape') {
          // 悬浮明细优先关：它是当前最表层的临时 UI，先关它才不会连带把抽屉也关掉
          if (tipTarget) { hideTip(); return; }
          if (drawerRecordId) { closeRecordDrawer(); return; }
          return; // 其余 Esc 交给原生 dialog
        }
        // 抽屉打开期间 Tab 一律走焦点陷阱（含焦点还在背景里的情况）
        if (event.key === 'Tab' && drawerRecordId) { trapFocusInDrawer(event); return; }
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (isTypingTarget(event.target)) return;
        const dialogOpen = document.querySelector('dialog[open]');
        if (dialogOpen) return; // 弹窗打开时不抢按键
        if (String(event.key).toLowerCase() === 'n') { event.preventDefault(); openDialog(null); return; }
        // 键盘可达的推进路径（v4.8.0）：HTML5 拖拽对键盘用户完全不可用，看板卡片聚焦时按 A 直接打开推进弹窗。
        // 统一走这个单入口，输入框内（isTypingTarget）与弹窗打开时都已在上面提前 return，不会误拦。
        if (String(event.key).toLowerCase() === 'a') {
          const card = event.target && event.target.closest && event.target.closest('.board-card[data-id]');
          const record = card && records.find(item => item.id === card.dataset.id);
          if (record) { event.preventDefault(); openAdvanceDialog(record); }
          return;
        }
        if (event.key === '/') {
          event.preventDefault();
          if (parseRoute() !== 'records') location.hash = '#/records';
          if (els.search) els.search.focus();
          return;
        }
        if (event.key === '?') { event.preventDefault(); openCmdPalette(); }
      }

      // ================= 邮件提醒（M3）：本地状态、模糊匹配、复核视图、应用/忽略 =================
      function loadMailState() {
        try {
          const parsed = JSON.parse(localStorage.getItem(MAIL_STORAGE_KEY) || '{}');
          return {
            appliedIds: Array.isArray(parsed.appliedIds) ? parsed.appliedIds.map(String) : [],
            dismissedIds: Array.isArray(parsed.dismissedIds) ? parsed.dismissedIds.map(String) : [],
            lastReadAt: String(parsed.lastReadAt || ''),
            encKey: String(parsed.encKey || '') // 邮件解密密钥：仅本机，绝不进 envelope/不上传
          };
        } catch (_) {
          return { appliedIds: [], dismissedIds: [], lastReadAt: '', encKey: '' };
        }
      }
      function saveMailState() {
        try { localStorage.setItem(MAIL_STORAGE_KEY, JSON.stringify(mailState)); } catch (_) {}
      }

/*__MODULE:mail__*/
