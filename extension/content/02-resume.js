/**
 * 秋招求职与简历助手 - Content Script 02/06 简历模块
 * 简历分类渲染、storage 加载与实时同步
 */
'use strict';

  // ================= 渲染简历模块 =================
  function renderResumeSections(resume) {
    if (!resume || typeof resume !== 'object') return;
    let html = '';

    for (const [sectionName, sectionData] of Object.entries(resume)) {
      if (!sectionData) continue;
      const isDefaultOpen = sectionName === '优先信息';
      const collapsedClass = isDefaultOpen ? '' : 'collapsed';

      html += `
        <div class="resume-section ${collapsedClass}">
          <div class="section-header">
            <span>${escapeHtml(sectionName)}</span>
            <span class="section-arrow">▼</span>
          </div>
          <div class="section-content">
      `;

      if (Array.isArray(sectionData)) {
        // 多段经历（如教育经历、实习、项目经历）
        sectionData.forEach(item => {
          html += `<div class="exp-row">`;
          if (item._rowName) {
            html += `<div class="exp-row-title">👉 ${escapeHtml(item._rowName)}</div>`;
          }
          for (const [k, v] of Object.entries(item)) {
            if (k.startsWith('_') || v === undefined || v === null || v === '') continue;
            const strVal = String(v);
            html += `
              <button class="field-btn" data-key="${escapeHtml(k)}" data-val="${encodeURIComponent(strVal)}" title="${escapeHtml(k)}: ${escapeHtml(strVal)}">
                <span class="field-key">${escapeHtml(k)}</span>
                <span class="field-val">${escapeHtml(strVal)}</span>
              </button>
            `;
          }
          html += `</div>`;
        });
      } else if (typeof sectionData === 'object') {
        // 普通对象模块（如基本信息、优先信息）
        html += `<div class="exp-row">`;
        for (const [k, v] of Object.entries(sectionData)) {
          if (v === undefined || v === null || v === '') continue;
          const strVal = String(v);
          html += `
            <button class="field-btn" data-key="${escapeHtml(k)}" data-val="${encodeURIComponent(strVal)}" title="${escapeHtml(k)}: ${escapeHtml(strVal)}">
              <span class="field-key">${escapeHtml(k)}</span>
              <span class="field-val">${escapeHtml(strVal)}</span>
            </button>
          `;
        }
        html += `</div>`;
      }

      html += `</div></div>`;
    }

    const resumeListEl = AJA.ui && AJA.ui.resumeListEl;
    if (!resumeListEl) return;
    resumeListEl.innerHTML = html;
    if (AJA.applyResumeFilter) AJA.applyResumeFilter(); // 重渲染后恢复搜索过滤
  }

  // ================= 从 storage 加载最新简历 =================
  async function loadResumeData() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const res = await chrome.storage.local.get([RESUME_STORAGE_KEY]);
        if (res[RESUME_STORAGE_KEY]) {
          currentResumeData = res[RESUME_STORAGE_KEY];
        }
      }
    } catch (e) {
      console.warn('读取扩展存储失败，使用默认简历', e);
    }
    renderResumeSections(currentResumeData);
    if (AJA.refreshResumeStatus) AJA.refreshResumeStatus();
  }

  // 监听 storage 变化（当用户在看板页面修改了简历，网页端实时刷新）
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes[RESUME_STORAGE_KEY]) {
        currentResumeData = changes[RESUME_STORAGE_KEY].newValue || AJA.DEFAULT_RESUME;
        renderResumeSections(currentResumeData);
        if (AJA.refreshResumeStatus) AJA.refreshResumeStatus();
      }
    });
  }
