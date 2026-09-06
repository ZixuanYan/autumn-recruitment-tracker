/**
 * 秋招求职与简历助手 - Content Script 06/06 与网页版管理器的桥接
 * 在网页版管理器页面（zixuanyan.github.io/autumn-recruitment-tracker）承担两个职责：
 * 1. 消息中继：background 定位到本标签页后，把招聘页收录的记录转发给页面
 *    （CAPTURE_SUBMIT），由页面弹窗人工确认后入库并自动云同步；
 *    打开页面时驱动暂存箱逐条弹出确认（每条等用户处理完再弹下一条）。
 * 2. 简历接收：网页版保存简历时下发（RESUME_PUSH），转交 background 写入
 *    chrome.storage.local，侧边栏经既有 storage.onChanged 链路实时刷新。
 * IS_TRACKER_PAGE / MSG / AJA 由先序注入的 common 与 01-core 提供。
 */
'use strict';

if (IS_TRACKER_PAGE) {
  // ================= 实时推送中继 =================
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.type === MSG.RELAY_TO_TRACKER && request.record) {
      window.postMessage({
        source: AJA.BRIDGE_SOURCE,
        type: 'CAPTURE_SUBMIT',
        record: request.record
      }, '*');
      sendResponse({ ok: true });
    }
  });

  // ================= 暂存箱驱动：打开页面时逐条弹出确认（弹窗关闭后才出队，避免误删）=================
  let pendingDrive = [];
  let awaitingId = null;       // 当前已推送、等待用户在弹窗中处理的记录 id
  let driveAborted = false;    // 页面迟迟未就绪时停止驱动，保留队列原样，避免静默丢数据
  let openCheckTimer = null;
  let openRetries = 0;

  // ================= 与 background 的通信：一律走安全封装 =================
  // 为什么不能直接调 chrome.runtime.sendMessage：扩展被重新加载（手动重载 / 更新 / 浏览器停用后恢复）后，
  // 页面上旧的内容脚本还活着，但它的 chrome.runtime 已成失效句柄，任何直接调用都会**同步抛出**
  // "Uncaught Error: Extension context invalidated." 冒到网页控制台 —— 用户看到报错却不知该做什么。
  // safeSendMessage 由先注入的 05-sidebar.js 提供（同一 isolated world，顶层函数跨文件可见），
  // 它先用 chrome.runtime.id 探测上下文是否还在，再 try/catch 兜底，失败走回调而不是抛异常。
  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      safeSendMessage(message, resolve, reason => reject(reason));
    });
  }

  // 桥接失效只上报一次：网页版会在 1s/3s 定时推送简历，失效后会连续触发，不能刷屏
  let bridgeBrokenNotified = false;
  function notifyBridgeBroken(reason, what) {
    const text = typeof reason === 'string' ? reason : (reason && reason.message) || String(reason || '');
    console.warn(`[秋招求职与简历助手] ${what}失败：${text}`);
    if (bridgeBrokenNotified) return;
    bridgeBrokenNotified = true;
    // 插件在管理器页面无法直接调用页面的 toast（isolated world + 侧边栏未挂载时 showToast 会静默失效），
    // 因此经既有的 postMessage 桥接把提示交给网页版，由它弹一次「刷新页面即可恢复」。
    try {
      window.postMessage({
        source: AJA.BRIDGE_SOURCE,
        type: 'BRIDGE_BROKEN',
        detail: `${what}失败（${text}）。通常是扩展刚被重新加载或更新，刷新本页面即可恢复。`
      }, '*');
    } catch (_) {}
  }

  function removePendingRecord(id) {
    // 出队失败不影响数据安全：暂存项仍在队列里，下次打开页面会重试。
    // 这里刻意不弹提示——桥接失效时上面的驱动流程会先报，重复提示只会吵。
    sendRuntimeMessage({ type: MSG.REMOVE_PENDING_RECORD, id }).catch(() => {});
  }

  // 推送首条（只 peek 不删除）：等弹窗确实打开→用户处理→弹窗关闭后，才由 observer 出队
  function pushNextPending() {
    if (driveAborted || awaitingId || !pendingDrive.length) return;
    const record = pendingDrive[0];
    awaitingId = record.id;
    openRetries = 0;
    window.postMessage({
      source: AJA.BRIDGE_SOURCE,
      type: 'CAPTURE_SUBMIT',
      record
    }, '*');
    verifyDialogOpened();
  }

  // 校验确认弹窗是否真的打开；未打开则重发，多次仍失败则停止驱动（不删除任何暂存）
  function verifyDialogOpened() {
    clearTimeout(openCheckTimer);
    openCheckTimer = setTimeout(() => {
      if (driveAborted || !awaitingId) return;
      const dialog = document.querySelector('#recordDialog');
      if (dialog && dialog.open) return; // 已打开，等 observer 在关闭时出队
      if (openRetries < 3) {
        openRetries += 1;
        const record = pendingDrive[0];
        if (record) {
          window.postMessage({ source: AJA.BRIDGE_SOURCE, type: 'CAPTURE_SUBMIT', record }, '*');
          verifyDialogOpened();
        }
        return;
      }
      // 页面脚本可能未就绪：停止驱动，保留暂存队列，用户可刷新后重试，绝不丢数据
      driveAborted = true;
      awaitingId = null;
      console.warn('[秋招求职与简历助手] 确认弹窗迟迟未打开，已暂停暂存箱驱动（数据保留，刷新页面可重试）');
    }, 1200);
  }

  (async () => {
    try {
      const res = await sendRuntimeMessage({ type: MSG.GET_PENDING_RECORDS });
      pendingDrive = (res && res.ok && Array.isArray(res.records)) ? res.records : [];
      if (!pendingDrive.length) return;

      // 等页面脚本就绪后再弹第一条
      setTimeout(pushNextPending, 800);

      // 观察确认弹窗（#recordDialog）开合：关闭即代表用户已处理该条 → 出队并驱动下一条
      const startObserver = () => {
        const dialog = document.querySelector('#recordDialog');
        if (!dialog) {
          setTimeout(startObserver, 500);
          return;
        }
        const observer = new MutationObserver(() => {
          if (dialog.open) return;                 // 打开事件：不处理
          if (driveAborted || !awaitingId) return;
          // 弹窗由开→关：用户已保存或取消该条，此时才真正出队（取消=丢弃，但确保弹窗确实展示过）
          removePendingRecord(awaitingId);
          pendingDrive.shift();
          awaitingId = null;
          clearTimeout(openCheckTimer);
          if (pendingDrive.length) setTimeout(pushNextPending, 300);
        });
        observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
      };
      startObserver();
    } catch (err) {
      // 暂存队列保持原样（一条都没删），刷新页面即可重试；同时把可操作的提示交给网页版
      notifyBridgeBroken(err, '读取暂存箱');
    }
  })();

  // ================= 简历下发接收（网页版保存简历 → 插件本地存储）=================
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.source === 'AUTUMN_TRACKER' && event.data.type === 'RESUME_PUSH' && event.data.resume) {
      // 这一行原先是裸调 chrome.runtime.sendMessage（全插件唯一没有任何防护的调用点）：
      // 扩展重载后它会同步抛 "Extension context invalidated." 冒到网页控制台。
      // 数据本身没丢（简历在网页端与本机 localStorage 都完好），只是插件这次没收到更新，
      // 因此失败时给一次可操作的提示，而不是让用户对着红色报错猜。
      sendRuntimeMessage({ type: MSG.SAVE_RESUME, resume: event.data.resume })
        .catch(reason => notifyBridgeBroken(reason, '简历下发到插件'));
    }
  });

  // ================= 主动索要简历：打开网页版即把简历拉进插件本地存储 =================
  // 网页版的定时推送(1s/3s)可能因内容脚本注入晚/刚重载而错过；此处握手拉取 + 重试兜底，确保简历可靠送达。
  function requestResumeFromTracker() {
    try { window.postMessage({ source: AJA.BRIDGE_SOURCE, type: 'RESUME_REQUEST' }, '*'); } catch (_) {}
  }
  requestResumeFromTracker();
  setTimeout(requestResumeFromTracker, 800);
  setTimeout(requestResumeFromTracker, 2500);

  console.log('[秋招求职与简历助手] 桥接中继已就绪');
}
