/**
 * 秋招求职与简历助手 - Content Script 05/06 侧边栏 UI（惰性挂载）
 * 抽屉 DOM、交互事件、收录抽屉保存回调、底部中枢入口
 * 完整 UI 在首次唤起（胶囊点击 / Ctrl/⌘+Shift+F）时才构建，日常浏览零开销
 */
'use strict';

// chrome.runtime.sendMessage 安全封装：扩展重载/上下文失效时不再静默卡死或刷 "Unchecked runtime.lastError"
function safeSendMessage(message, onResult, onError) {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
    if (onError) onError('扩展连接不可用，请刷新页面后重试');
    return;
  }
  try {
    chrome.runtime.sendMessage(message, (res) => {
      if (chrome.runtime.lastError) {
        if (onError) onError(chrome.runtime.lastError.message || '扩展通信失败');
        return;
      }
      if (onResult) onResult(res);
    });
  } catch (err) {
    if (onError) onError(err && err.message ? err.message : '扩展通信异常');
  }
}

function ensureSidebarUI() {
  if (AJA.ui) return AJA.ui;

  // ================= 构建 DOM 结构 =================
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div id="aja-drawer" class="collapsed">
      <div class="drawer-header" id="aja-drag-handle">
        <div class="brand-area">
          <div class="brand-icon">🚀</div>
          <div class="brand-title">秋招求职助手</div>
          <span class="shortcut-badge">Ctrl/⌘+Shift+F</span>
        </div>
        <button class="close-btn" id="aja-close-btn" title="收起面板">✕</button>
      </div>

      <div class="drawer-body">
        <!-- 一键收录岗位卡片 -->
        <div class="capture-card">
          <button class="capture-btn" id="aja-scan-btn">
            <span>📌</span>
            <span>一键收录当前岗位</span>
          </button>
          <button class="autofill-btn" id="aja-autofill-btn" title="自动匹配并填充页面空白表单项">
            <span>⚡</span>
            <span>一键填充当前页面</span>
          </button>
          <div class="autofill-warning-tip">功能不完善，请逐条核对</div>
          
          <div class="capture-form hidden" id="aja-capture-form">
            <div class="title-hint" id="cap-title-hint" title="点击复制网页标题">
              <div class="title-hint-label">📄 网页标题（参考）</div>
              <div id="cap-title-text"></div>
            </div>
            <div class="form-group">
              <label>公司名称</label>
              <input type="text" id="cap-company" placeholder="例如：字节跳动">
            </div>
            <div class="form-group">
              <label>投递岗位</label>
              <input type="text" id="cap-position" placeholder="例如：AI产品经理">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>目标城市</label>
                <input type="text" id="cap-city" placeholder="例如：北京">
              </div>
              <div class="form-group">
                <label>投递阶段</label>
                <select id="cap-stage"></select>
              </div>
            </div>
            <div class="form-group">
              <label>投递日期</label>
              <input type="date" id="cap-date">
            </div>
            <div class="form-actions">
              <button class="btn-save-record" id="cap-save-btn">✓ 确认存入看板</button>
              <button class="btn-cancel-capture" id="cap-cancel-btn">收起</button>
            </div>
          </div>
        </div>

        <!-- 暂存箱：网页版未打开时收录的岗位在此排队，打开网页版后逐条确认入库 -->
        <div class="pending-box hidden" id="aja-pending-box">
          <button class="pending-toggle" id="aja-pending-toggle" type="button">
            <span>📥</span><span>暂存箱</span><span class="pending-count" id="aja-pending-count">0</span>
          </button>
          <div class="pending-list hidden" id="aja-pending-list"></div>
        </div>

        <!-- 简历资料库分类展示 -->
        <div class="resume-source-hint">简历在网页版管理器中编辑，保存后自动同步到这里</div>
        <div id="aja-resume-list"></div>
      </div>

      <!-- 底部中枢入口 -->
      <div class="drawer-footer">
        <button class="footer-btn" id="aja-open-tracker-btn">
          <span>🌐</span>
          <span>打开网页版管理器</span>
        </button>
      </div>
    </div>
  `;
  shadow.appendChild(wrapper);

  // ================= 获取 DOM 元素 =================
  const drawer = shadow.getElementById('aja-drawer');
  const closeBtn = shadow.getElementById('aja-close-btn');
  const dragHandle = shadow.getElementById('aja-drag-handle');
  const scanBtn = shadow.getElementById('aja-scan-btn');
  const autofillBtn = shadow.getElementById('aja-autofill-btn');
  const captureForm = shadow.getElementById('aja-capture-form');
  const capCompany = shadow.getElementById('cap-company');
  const capPosition = shadow.getElementById('cap-position');
  const capCity = shadow.getElementById('cap-city');
  const capStage = shadow.getElementById('cap-stage');
  // 阶段选项由 AJA.STAGES 统一生成（消除硬编码，与网页版预设单一事实源）
  capStage.innerHTML = AJA.STAGES.map(s => `<option value="${s}">${s}</option>`).join('');
  const capDate = shadow.getElementById('cap-date');
  const capSaveBtn = shadow.getElementById('cap-save-btn');
  const capCancelBtn = shadow.getElementById('cap-cancel-btn');
  const capTitleHint = shadow.getElementById('cap-title-hint');
  const capTitleText = shadow.getElementById('cap-title-text');
  const resumeListEl = shadow.getElementById('aja-resume-list');
  const openTrackerBtn = shadow.getElementById('aja-open-tracker-btn');
  const pendingBox = shadow.getElementById('aja-pending-box');
  const pendingToggle = shadow.getElementById('aja-pending-toggle');
  const pendingCountEl = shadow.getElementById('aja-pending-count');
  const pendingListEl = shadow.getElementById('aja-pending-list');

  // ================= 暂存箱：刷新计数与列表 =================
  let pendingExpanded = false;

  function renderPendingList(queue) {
    pendingCountEl.textContent = queue.length;
    pendingBox.classList.toggle('hidden', queue.length === 0);
    if (queue.length === 0) pendingExpanded = false;
    pendingListEl.classList.toggle('hidden', !pendingExpanded || queue.length === 0);
    if (pendingExpanded && queue.length) {
      pendingListEl.innerHTML = queue.map(item => `
        <div class="pending-item" data-id="${escapeHtml(item.id)}">
          <div class="pending-item-main" data-fill="${escapeHtml(item.id)}" title="点击回填收录表单，可修改后重新保存">
            <div class="pending-item-title">${escapeHtml(item.company)} · ${escapeHtml(item.position)}</div>
            <div class="pending-item-meta">${escapeHtml(item.applicationDate || '')} · ${escapeHtml(item.stage || '已投递')}</div>
          </div>
          <button class="pending-item-discard" data-discard="${escapeHtml(item.id)}" title="丢弃这条暂存">✕</button>
        </div>
      `).join('');
    }
  }

  function refreshPending() {
    safeSendMessage({ type: MSG.GET_PENDING_RECORDS }, (res) => {
      if (res && res.ok) renderPendingList(res.records || []);
    });
  }

  pendingToggle.addEventListener('click', () => {
    pendingExpanded = !pendingExpanded;
    refreshPending();
  });

  pendingListEl.addEventListener('click', (event) => {
    const discardId = event.target.getAttribute && event.target.getAttribute('data-discard');
    if (discardId) {
      safeSendMessage({ type: MSG.REMOVE_PENDING_RECORD, id: discardId }, () => refreshPending(), () => refreshPending());
      return;
    }
    const fillId = event.target.getAttribute && event.target.closest && event.target.closest('[data-fill]')?.getAttribute('data-fill');
    if (fillId) {
      safeSendMessage({ type: MSG.GET_PENDING_RECORDS }, (res) => {
        const item = (res?.records || []).find(r => r.id === fillId);
        if (!item) return;
        capCompany.value = item.company || '';
        capPosition.value = item.position || '';
        capCity.value = item.city || '';
        capStage.value = item.stage || '已投递';
        capDate.value = item.applicationDate || '';
        captureForm.classList.remove('hidden');
        showToast('已回填收录表单，可修改后重新保存');
      });
    }
  });


  // ================= 交互事件绑定 =================
  let isCollapsed = true;
  function toggleDrawer(open) {
    isCollapsed = typeof open === 'boolean' ? !open : !isCollapsed;
    if (isCollapsed) {
      drawer.classList.add('collapsed');
      toggleBtn.classList.remove('hidden');
    } else {
      drawer.classList.remove('collapsed');
      toggleBtn.classList.add('hidden');
    }
  }

  closeBtn.addEventListener('click', () => toggleDrawer(false));

  // 快捷键 Ctrl/⌘+Shift+F 由 01-core.js 顶层常驻监听统一处理（含 metaKey/⌘ 与 chrome.commands 转发），
  // 此处不再重复注册，避免首次构建后同一按键触发两次 toggleDrawer 相互抵消（面板纹丝不动）。

  // 手风琴折叠交互
  resumeListEl.addEventListener('click', (e) => {
    const headerEl = e.target.closest('.section-header');
    if (headerEl) {
      const sec = headerEl.closest('.resume-section');
      sec.classList.toggle('collapsed');
    }
  });

  // 点击字段按钮 -> 光标处插入/追加 + 剪贴板兜底
  resumeListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.field-btn');
    if (!btn) return;

    const rawVal = btn.getAttribute('data-val');
    if (!rawVal) return;
    const value = decodeURIComponent(rawVal);

    // 剪贴板兜底
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).catch(err => console.warn('剪贴板写入异常', err));
    }

    const targetEl = lastFocusedEl;
    if (targetEl && document.contains(targetEl)) {
      try {
        if (targetEl instanceof HTMLInputElement || targetEl instanceof HTMLTextAreaElement) {
          const prevVal = targetEl.value || '';
          
          // 获取当前光标位置（如选区存在则替换选区，如无选区则直接在光标处插入）
          let start = (typeof targetEl.selectionStart === 'number' && targetEl.selectionStart >= 0)
            ? targetEl.selectionStart
            : ((typeof lastSelectionStart === 'number' && lastSelectionStart >= 0) ? lastSelectionStart : prevVal.length);
            
          let end = (typeof targetEl.selectionEnd === 'number' && targetEl.selectionEnd >= 0)
            ? targetEl.selectionEnd
            : ((typeof lastSelectionEnd === 'number' && lastSelectionEnd >= 0) ? lastSelectionEnd : start);

          if (start > prevVal.length) start = prevVal.length;
          if (end > prevVal.length) end = prevVal.length;

          // 拼接新值
          const newVal = prevVal.slice(0, start) + value + prevVal.slice(end);

          const proto = (targetEl instanceof HTMLTextAreaElement) ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) {
            setter.call(targetEl, newVal);
          } else {
            targetEl.value = newVal;
          }

          // 触发 input 与 change 事件通知网页端框架 (Vue/React/Angular)
          targetEl.dispatchEvent(new Event('input', { bubbles: true }));
          targetEl.dispatchEvent(new Event('change', { bubbles: true }));

          // 将光标定位在新插入内容的末尾并聚焦
          targetEl.focus();
          const nextCursorPos = start + value.length;
          try {
            targetEl.setSelectionRange(nextCursorPos, nextCursorPos);
            lastSelectionStart = nextCursorPos;
            lastSelectionEnd = nextCursorPos;
          } catch (_) {}

          showToast(`已插入: ${value.slice(0, 12)}${value.length > 12 ? '...' : ''}`);
        } else if (targetEl.isContentEditable) {
          targetEl.focus();
          document.execCommand('insertText', false, value);
          showToast(`已插入: ${value.slice(0, 12)}${value.length > 12 ? '...' : ''}`);
        } else {
          showToast(`已复制到剪贴板，请在表单中粘贴`);
        }
      } catch (err) {
        console.warn('插入文本异常', err);
        showToast(`已复制到剪贴板，请手动粘贴`);
      }
    } else {
      showToast(`已复制到剪贴板，请在表单中粘贴`);
    }
  });

  // 一键提取岗位并展示微调表单
  scanBtn.addEventListener('click', () => {
    const detected = extractPageJobData();
    capCompany.value = detected.company;
    capPosition.value = detected.position;
    capCity.value = detected.city;
    capStage.value = detected.stage;
    capDate.value = detected.applicationDate;

    // 显示网页标题作为参考，帮助用户快速修正
    const pageTitle = document.title || '';
    capTitleText.textContent = pageTitle;
    capTitleHint.title = `点击复制: ${pageTitle}`;

    captureForm.classList.remove('hidden');

    // 自动聚焦公司名称输入框，方便快速修正
    setTimeout(() => capCompany.focus(), 50);
  });

  // 点击标题参考栏 -> 复制到剪贴板
  capTitleHint.addEventListener('click', () => {
    const title = capTitleText.textContent || '';
    if (title && navigator.clipboard) {
      navigator.clipboard.writeText(title).then(() => {
        showToast('📋 网页标题已复制到剪贴板');
      }).catch(() => {});
    }
  });

  capCancelBtn.addEventListener('click', () => {
    captureForm.classList.add('hidden');
  });

  // 保存投递记录：优先推送到网页版管理器（人工确认入库+云同步），未打开时存入暂存箱
  function saveToPending(record, onDone) {
    safeSendMessage({ type: MSG.SAVE_JOB_RECORD, record }, (res) => {
      if (res && res.ok) {
        showToast(res.updated
          ? `♻️ 已更新暂存箱: ${record.company} - ${record.position}（共 ${res.total} 条）`
          : `已存入暂存箱（共 ${res.total} 条）: ${record.company} - ${record.position}`);
        refreshPending();
        onDone(true);
      } else {
        showToast(`保存失败: ${res?.message || '未知错误'}`);
        onDone(false);
      }
    }, (errMsg) => {
      showToast(`保存失败: ${errMsg}`);
      onDone(false);
    });
  }

  capSaveBtn.addEventListener('click', async () => {
    const record = {
      company: capCompany.value.trim() || '待确认公司',
      position: capPosition.value.trim() || '待确认岗位',
      city: capCity.value.trim(),
      stage: capStage.value,
      applicationDate: capDate.value || new Date().toISOString().slice(0, 10),
      applicationUrl: location.href,
      recentSchedule: '已完成网申投递',
      nextAction: '关注招聘动态与邮件通知'
    };

    // 优先推送到网页版管理器：background 定位其标签页 → 中继 → 页面弹窗人工确认
    safeSendMessage({ type: MSG.PUSH_TO_TRACKER, record }, (res) => {
      if (res && res.ok) {
        showToast(`🎉 已推送到网页版管理器，请确认: ${record.company} - ${record.position}`);
        captureForm.classList.add('hidden');
        return;
      }
      // 管理器未打开或页面未就绪 → 存入暂存箱，打开网页版后逐条确认
      if (res && (res.reason === 'tracker-not-open' || res.reason === 'tracker-not-ready')) {
        saveToPending(record, (saved) => { if (saved) captureForm.classList.add('hidden'); });
        return;
      }
      showToast(`保存失败: ${res?.message || '未知错误'}`);
    }, () => {
      // 扩展上下文失效（如刚重载）：走暂存箱回落，saveToPending 内部会给出成功/失败提示
      saveToPending(record, (saved) => { if (saved) captureForm.classList.add('hidden'); });
    });
  });

  // 绑定一键自动填充按钮
  autofillBtn.addEventListener('click', autoFillPageForm);

  // 底部入口：打开网页版管理器（数据中枢）
  openTrackerBtn.addEventListener('click', () => {
    window.open(AJA.TRACKER_URL, '_blank');
  });

  // ================= 导出惰性 UI 引用（供 02 简历渲染 / 04 填充引擎运行时访问）=================
  AJA.ui = { drawer, toggleBtn, resumeListEl, autofillBtn, captureForm, capCompany, capPosition, capCity, capStage, capDate, capSaveBtn, capCancelBtn };
  // 注意：toggleDrawer 是本函数内部的局部函数，必须在函数内导出到 AJA，
  // 顶层包装器无法引用它（作用域不可达，曾导致点击胶囊后 ReferenceError 静默失败）
  AJA.toggleDrawer = toggleDrawer;
  loadResumeData();
  refreshPending();
  console.log('🚀 [秋招求职与简历助手] Shadow DOM 侧边栏已挂载。按 Ctrl/⌘+Shift+F 唤起。');
  return AJA.ui;
}

AJA.ensureSidebarUI = ensureSidebarUI;
// 兼容首次构建前的调用：01-core 的调用序为先 ensureSidebarUI 再 toggleDrawer，
// 此处仅作“尚未构建”时的安全空操作；真实实现由 ensureSidebarUI 内部覆盖
if (!AJA.toggleDrawer) {
  AJA.toggleDrawer = () => {};
}
