/**
 * 秋招求职与简历助手 - Content Script 05/06 迷你收录卡片（惰性挂载）
 *
 * v5.0.0 之前这里是 551 行的「侧边栏 UI」：一个 350px 宽、从 top:20px 撑到 bottom:20px 的
 * 全高抽屉，里面塞了收录表单、暂存箱与整个简历字段库。它浮在页面上，正在填的网申表单被挡住一半，
 * 而且位置写死不能移动（.drawer-header 有 cursor:move、DOM 有 #aja-drag-handle、JS 也取了这个
 * 元素，却一行事件都没绑——是个骗光标的半成品）。
 *
 * 现在职责收窄为「只做收录」：点胶囊弹出一张紧凑卡片，位置跟随胶囊，用户把胶囊拖到页面空白处，
 * 卡片就落在空白处。暂存箱与简历字段速填迁到 Chrome 原生 Side Panel（浏览器会压缩页面宽度，
 * 完全不遮挡，还能一边看表单一边点字段）。
 *
 * 表单模板、下拉选项、置信提示与保存链路全部来自 common/capture-form.js，与 Side Panel 共用一份，
 * 避免两端各写一遍导致「面板存进去的少了企业性质」这类漂移。
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

function ensureCaptureUI() {
  if (AJA.ui) return AJA.ui;
  if (!shadow) return null; // 桥接模式（网页版页面）不注入 UI

  // ================= 构建 DOM =================
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div id="aja-capture-pop" hidden>
      <div class="pop-header">
        <span class="pop-title">${AJA.svg('plus', 14)}<span>收录当前岗位</span></span>
        <span class="pop-actions">
          <button class="pop-close" id="aja-pop-rescan" type="button" title="重新识别当前页面">${AJA.svg('refresh', 14)}</button>
          <button class="pop-close" id="aja-pop-close" type="button" title="关闭（Esc）">${AJA.svg('close', 14)}</button>
        </span>
      </div>
      ${AJA.CaptureForm.html()}
    </div>
  `;
  shadow.appendChild(wrapper);

  const pop = shadow.getElementById('aja-capture-pop');
  const closeBtn = shadow.getElementById('aja-pop-close');
  const rescanBtn = shadow.getElementById('aja-pop-rescan');
  const f = AJA.CaptureForm.els(shadow);
  AJA.CaptureForm.fillOptions(f.stage, f.companyType);

  function closePop() {
    pop.hidden = true;
  }

  // ================= 解析当前页并回填 =================
  // 解析引擎 extractPageJobData 在 03-parsers.js，v4.1.0 的 7 项修正均由真实数据实证，零改动复用
  function rescan() {
    let detected = null;
    try {
      detected = extractPageJobData();
    } catch (err) {
      console.warn('[秋招助手] 岗位解析异常', err);
      detected = { company: '', position: '', city: '', stage: '已投递', applicationDate: new Date().toISOString().slice(0, 10) };
      showToast('当前页面结构未能识别，请手动填写');
    }
    detected.pageTitle = document.title || '';
    AJA.CaptureForm.fillForm(f, detected);
    if (detected._sources) console.debug('[秋招助手] 采集来源', detected._sources);
    // 自动聚焦到第一个没识别出来的字段（都识别出来则聚焦公司名），方便快速修正
    const target = AJA.CaptureForm.firstEmptyField(f, detected);
    if (target) setTimeout(() => { try { target.focus(); } catch (_) {} }, 50);
    return detected;
  }

  // ================= 事件绑定 =================
  closeBtn.addEventListener('click', closePop);
  f.cancelBtn.addEventListener('click', closePop);
  rescanBtn.addEventListener('click', () => rescan());

  // 点击标题参考栏 -> 复制到剪贴板（用户常需要把网页标题粘到别处核对）
  f.titleHint.addEventListener('click', () => {
    const title = f.titleText.textContent || '';
    if (!title || !navigator.clipboard) return;
    navigator.clipboard.writeText(title)
      .then(() => showToast('网页标题已复制到剪贴板'))
      .catch(() => {});
  });

  // 保存：优先推送网页版管理器（人工确认入库 + 云同步），未打开时回落暂存箱
  f.saveBtn.addEventListener('click', () => {
    // applicationUrl 用当前页地址——迷你卡片就跑在目标页里，location.href 天然正确。
    // Side Panel 那边不能这么写，它必须用 SCAN_CURRENT_PAGE 回传的 url。
    const record = AJA.CaptureForm.collect(f, location.href);
    AJA.CaptureForm.save(record, {
      send: safeSendMessage,
      toast: showToast,
      onDone: (saved) => { if (saved) closePop(); }
    });
  });

  // 每次打开都重新解析：用户可能已经导航到另一家公司的岗位页，
  // 沿用上一次的解析结果会把 A 公司的岗位存成 B 公司的链接。
  AJA.onCaptureOpen = () => rescan();

  AJA.ui = { pop, toggleBtn, form: f };
  console.log(`[秋招求职与简历助手] v${AJA.VERSION} 收录胶囊已挂载。点胶囊收录当前岗位；暂存箱与简历速填在浏览器工具栏的侧边面板里。`);
  return AJA.ui;
}

AJA.ensureCaptureUI = ensureCaptureUI;
