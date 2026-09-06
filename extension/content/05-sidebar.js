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

// 统计简历中已填写的字段数（自包含，不依赖任何填充引擎）：数组段累加各 item 的非空非下划线键，对象段统计非空值
function countResumeFilledFields(resume) {
  let n = 0;
  try {
    for (const sec of Object.values(resume || {})) {
      if (Array.isArray(sec)) {
        for (const item of sec) {
          if (item && typeof item === 'object') {
            for (const [k, v] of Object.entries(item)) {
              if (!k.startsWith('_') && v != null && String(v).trim() !== '') n++;
            }
          }
        }
      } else if (sec && typeof sec === 'object') {
        for (const v of Object.values(sec)) { if (v != null && String(v).trim() !== '') n++; }
      }
    }
  } catch (_) { n = 0; }
  return n;
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
          <span class="ver-badge" title="当前运行的插件版本；若与仓库最新不符，请在 edge://extensions 重新加载">v${AJA.VERSION}</span>
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

          <div class="capture-form hidden" id="aja-capture-form">
            <div class="title-hint" id="cap-title-hint" title="点击复制网页标题">
              <div class="title-hint-label">📄 网页标题（参考）</div>
              <div id="cap-title-text"></div>
            </div>
            <div class="detect-hint" id="cap-detect-hint" hidden></div>
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

        <!-- 简历资料库：左键点击填入聚焦框，右键复制字段内容 -->
        <div class="resume-source-hint" id="aja-resume-status">简历在网页版管理器中编辑，保存后自动同步到这里</div>
        <div class="resume-help">① 先点网页里的输入框 → ② 再点下方字段即可填入；<b>右键字段 = 复制内容</b></div>
        <input id="aja-resume-search" class="resume-search" type="text" placeholder="🔍 搜索字段名或内容…" autocomplete="off">
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
  const captureForm = shadow.getElementById('aja-capture-form');
  const capCompany = shadow.getElementById('cap-company');
  const capPosition = shadow.getElementById('cap-position');
  const capCity = shadow.getElementById('cap-city');
  const capStage = shadow.getElementById('cap-stage');
  // 阶段选项由 AJA.STAGES 统一生成（消除硬编码，与网页版预设单一事实源）
  capStage.innerHTML = AJA.STAGES.map(s => `<option value="${s}">${s}</option>`).join('');
  const capDate = shadow.getElementById('cap-date');
  const capDetectHint = shadow.getElementById('cap-detect-hint');
  const capSaveBtn = shadow.getElementById('cap-save-btn');
  const capCancelBtn = shadow.getElementById('cap-cancel-btn');
  const capTitleHint = shadow.getElementById('cap-title-hint');
  const capTitleText = shadow.getElementById('cap-title-text');
  const resumeListEl = shadow.getElementById('aja-resume-list');
  const resumeSearchEl = shadow.getElementById('aja-resume-search');
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
            ${item.variantOf ? `<div class="pending-item-variant" title="这不是重复堆积：同一家公司的岗位名相近（括号里通常是城市/方向/批次），已作为独立一条暂存">≈ 与「${escapeHtml(item.variantOf)}」是同公司的相近岗位</div>` : ''}
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

  // 左键点击字段 chip → 填入当前聚焦框（无有效目标/写入失败时才回退到复制）；右键复制见下方 contextmenu
  resumeListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.field-btn');
    if (!btn) return;

    const rawVal = btn.getAttribute('data-val');
    if (!rawVal) return;
    const value = decodeURIComponent(rawVal);

    const copyFallback = (msg) => {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(value).catch(() => {});
      showToast(msg || '未聚焦输入框，已复制到剪贴板，请粘贴');
    };
    const okToast = () => showToast(`已填入：${value.slice(0, 12)}${value.length > 12 ? '…' : ''}`);

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

          okToast();
        } else if (targetEl.isContentEditable) {
          targetEl.focus();
          document.execCommand('insertText', false, value);
          okToast();
        } else {
          copyFallback();
        }
      } catch (err) {
        console.warn('插入文本异常', err);
        copyFallback('写入失败，已复制到剪贴板，请粘贴');
      }
    } else {
      copyFallback();
    }
  });

  // 右键字段 chip → 复制该字段内容到剪贴板
  resumeListEl.addEventListener('contextmenu', (e) => {
    const btn = e.target.closest('.field-btn');
    if (!btn) return;
    e.preventDefault();
    const rawVal = btn.getAttribute('data-val');
    if (!rawVal) return;
    const value = decodeURIComponent(rawVal);
    const keyEl = btn.querySelector('.field-key');
    const key = btn.getAttribute('data-key') || (keyEl ? keyEl.textContent.trim() : '');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value)
        .then(() => showToast(`已复制：${key}${key ? ' → ' : ''}${value.slice(0, 20)}${value.length > 20 ? '…' : ''}`))
        .catch(() => showToast('复制失败，请手动选择文本'));
    } else {
      showToast('当前环境不支持剪贴板');
    }
  });

  // 简历字段搜索过滤：按 字段名/内容 过滤 chip；命中段自动展开；空查询恢复全部
  function applyResumeFilter() {
    if (!resumeListEl) return;
    const q = String(AJA.resumeSearchQuery || '').trim().toLowerCase();
    resumeListEl.querySelectorAll('.resume-section').forEach(sec => {
      let secVisible = 0;
      sec.querySelectorAll('.field-btn').forEach(chip => {
        const txt = (chip.textContent || '').toLowerCase();
        const key = (chip.getAttribute('data-key') || '').toLowerCase();
        const hit = !q || txt.includes(q) || key.includes(q);
        chip.style.display = hit ? '' : 'none';
        if (hit) secVisible++;
      });
      sec.querySelectorAll('.exp-row').forEach(row => {
        const anyVisible = Array.from(row.querySelectorAll('.field-btn')).some(c => c.style.display !== 'none');
        row.style.display = anyVisible ? '' : 'none';
      });
      if (q) {
        if (secVisible > 0) { sec.style.display = ''; sec.classList.remove('collapsed'); }
        else sec.style.display = 'none';
      } else {
        sec.style.display = '';
      }
    });
  }
  AJA.applyResumeFilter = applyResumeFilter;
  if (resumeSearchEl) {
    resumeSearchEl.addEventListener('input', () => { AJA.resumeSearchQuery = resumeSearchEl.value; applyResumeFilter(); });
  }

  // 采集来源的中文标签：让用户知道每个字段是从页面哪里认出来的，便于判断该不该信
  const DETECT_SOURCE_LABELS = {
    jsonld: '结构化数据', domain: '官方域名', logo: '页面 Logo', selector: '页面元素',
    breadcrumb: '面包屑', h1: '页面主标题', generic: '页面元素', og: 'OpenGraph',
    title: '网页标题', 'document.title': '网页标题', subdomain: '子域名', detected: '页面内容'
  };
  function detectSourceLabel(source) {
    const s = String(source || '');
    if (!s) return '';
    if (s.indexOf('ats:') === 0) return `${s.slice(4)} 解析器`;
    return DETECT_SOURCE_LABELS[s] || s;
  }

  // 渲染采集置信提示：解析器「宁空勿错」，识别不出的字段会留空，这里明确告知需要人工补填
  function renderDetectHint(detected) {
    if (!capDetectHint) return;
    const missing = [];
    if (!detected.company) missing.push('公司名称');
    if (!detected.position) missing.push('投递岗位');
    if (!detected.city) missing.push('目标城市');
    const sources = detected._sources || {};
    const srcText = ['company', 'position', 'city']
      .filter(k => detected[k] && sources[k])
      .map(k => `${k === 'company' ? '公司' : k === 'position' ? '岗位' : '城市'}来自${detectSourceLabel(sources[k])}`)
      .join(' · ');
    if (missing.length) {
      capDetectHint.className = 'detect-hint warn';
      capDetectHint.innerHTML = `⚠️ 未能从页面识别出：<b>${missing.map(escapeHtml).join('、')}</b>，请手动补填后再保存。`
        + (srcText ? `<div class="detect-hint-src">${escapeHtml(srcText)}</div>` : '');
      capDetectHint.hidden = false;
    } else {
      capDetectHint.className = 'detect-hint';
      capDetectHint.innerHTML = `已自动识别，请核对后保存。${srcText ? `<div class="detect-hint-src">${escapeHtml(srcText)}</div>` : ''}`;
      capDetectHint.hidden = false;
    }
  }

  // 一键提取岗位并展示微调表单
  scanBtn.addEventListener('click', () => {
    const detected = extractPageJobData();
    capCompany.value = detected.company;
    capPosition.value = detected.position;
    capCity.value = detected.city;
    capStage.value = detected.stage;
    capDate.value = detected.applicationDate;
    if (detected._sources) console.debug('[秋招助手] 采集来源', detected._sources);

    // 显示网页标题作为参考，帮助用户快速修正
    const pageTitle = document.title || '';
    capTitleText.textContent = pageTitle;
    capTitleHint.title = `点击复制: ${pageTitle}`;
    renderDetectHint(detected);

    captureForm.classList.remove('hidden');

    // 自动聚焦到第一个没识别出来的字段（都识别出来则聚焦公司名），方便快速修正
    const firstEmpty = !detected.company ? capCompany : (!detected.position ? capPosition : (!detected.city ? capCity : capCompany));
    setTimeout(() => firstEmpty.focus(), 50);
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

  // 底部入口：打开网页版管理器（数据中枢）
  openTrackerBtn.addEventListener('click', () => {
    window.open(AJA.TRACKER_URL, '_blank');
  });

  // 注：整页自动填充 + AI 辅助填写已于 v4.0.0 移除；改为「点击字段填入聚焦框 + 右键复制 + 搜索」（见下方简历速填逻辑）

  // 简历同步状态：统计已填写字段数（自包含，不依赖填充引擎），空则提示去网页版配置
  function refreshResumeStatus() {
    const el = shadow && shadow.getElementById('aja-resume-status');
    if (!el) return;
    const n = countResumeFilledFields(currentResumeData);
    if (n > 0) {
      el.textContent = `简历：已同步（已填 ${n} 项）`;
      el.style.color = '';
      el.style.cursor = 'default';
      el.onclick = null;
    } else {
      el.textContent = '简历：未同步 · 点此去网页版配置';
      el.style.color = '#c2410c';
      el.style.cursor = 'pointer';
      el.onclick = () => window.open(AJA.TRACKER_URL, '_blank');
    }
  }
  AJA.refreshResumeStatus = refreshResumeStatus;

  // ================= 导出惰性 UI 引用（供 02 简历渲染 / 04 填充引擎运行时访问）=================
  AJA.ui = { drawer, toggleBtn, resumeListEl, resumeSearchEl, captureForm, capCompany, capPosition, capCity, capStage, capDate, capSaveBtn, capCancelBtn };
  // 注意：toggleDrawer 是本函数内部的局部函数，必须在函数内导出到 AJA，
  // 顶层包装器无法引用它（作用域不可达，曾导致点击胶囊后 ReferenceError 静默失败）
  AJA.toggleDrawer = toggleDrawer;
  loadResumeData();
  refreshResumeStatus();
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
