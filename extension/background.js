/**
 * 秋招求职与简历助手 - Background Service Worker（classic worker，用 importScripts 共享公共模块）
 * 职责：暂存箱队列、简历存取、与网页版管理器的标签页定位与中继
 */
'use strict';

importScripts('common/constants.js', 'common/default-resume.js', 'common/company-key.js');

const RECORDS_STORAGE_KEY = AJA.RECORDS_STORAGE_KEY;
const RESUME_STORAGE_KEY = AJA.RESUME_STORAGE_KEY;
const PENDING_KEY = AJA.PENDING_KEY;
const MSG = AJA.MSG;

// ================= 初始化时检查并写入默认简历（如果尚无配置）=================
// 默认简历定义见 common/default-resume.js（全端唯一，不预置个人信息）
chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    const data = await chrome.storage.local.get([RESUME_STORAGE_KEY]);
    if (!data[RESUME_STORAGE_KEY]) {
      await chrome.storage.local.set({ [RESUME_STORAGE_KEY]: AJA.DEFAULT_RESUME });
    }
  } catch (err) {
    console.error('初始化简历默认数据失败', err);
  }
});

// 暂存箱去重：与网页端 index.html 的 findDuplicateRecord 同源（都基于 common/company-key.js 的归一化键）。
// 此前这里是「公司名与岗位名原文精确相等」，导致「腾讯」与「腾讯 」（尾空格）、
// 「腾讯」与「腾讯科技（深圳）有限公司」在暂存箱里堆成两条，推给网页端时要逐条弹窗确认。
// 返回 { record, mode: 'duplicate' | 'variant' } 或 null：
//   duplicate → 同链接，或同公司 + 岗位归一化严格相等 → 合并进已有暂存项
//   variant   → 同公司 + 岗位宽松相等（括号里的城市/方向/批次不同）→ **不合并**，
//               那是同一家公司的另一个岗位，入队并标 variantOf 供侧栏提示
function findDuplicateRecord(records, incoming) {
  const list = Array.isArray(records) ? records : [];
  const url = String((incoming && incoming.applicationUrl) || '').trim();
  if (url) {
    const byUrl = list.find(r => String(r.applicationUrl || '').trim() === url);
    if (byUrl) return { record: byUrl, mode: 'duplicate' };
  }
  const company = String((incoming && incoming.company) || '').trim();
  const position = String((incoming && incoming.position) || '').trim();
  if (!company || !position) return null;
  const posKey = AJA.positionKey(position);
  const looseKey = AJA.loosePositionKey(position);
  let variant = null;
  for (const r of list) {
    if (!AJA.sameCompany(company, r.company)) continue;
    if (AJA.positionKey(r.position) === posKey) return { record: r, mode: 'duplicate' };
    if (!variant && looseKey.length >= 2 && AJA.loosePositionKey(r.position) === looseKey) variant = r;
  }
  return variant ? { record: variant, mode: 'variant' } : null;
}

async function getPendingQueue() {
  const res = await chrome.storage.local.get([PENDING_KEY]);
  return Array.isArray(res[PENDING_KEY]) ? res[PENDING_KEY] : [];
}

// ================= 在当前活动标签页唤起侧边栏（图标点击与浏览器快捷键共用）=================
async function toggleSidebarOnActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && typeof tab.id === 'number') {
      await chrome.tabs.sendMessage(tab.id, { type: MSG.TOGGLE_SIDEBAR });
    }
  } catch (_) {
    // 当前页面没有注入 content script（edge:// 内部页、商店页等），忽略
  }
}

// 点击扩展图标 -> 在当前页唤起/收起侧边栏
chrome.action.onClicked.addListener(() => {
  toggleSidebarOnActiveTab();
});

// 浏览器级快捷键（chrome.commands）：比页面内监听可靠，不受焦点/iframe/保留键影响
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-sidebar') toggleSidebarOnActiveTab();
});

// ================= 监听各页面消息 =================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // 推送记录到网页版管理器：定位其标签页 → 激活 → 中继给页面弹窗人工确认
  if (request.type === MSG.PUSH_TO_TRACKER) {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ url: AJA.TRACKER_URL_PATTERN });
        const trackerTab = tabs.find(tab => typeof tab.id === 'number');
        if (!trackerTab) {
          sendResponse({ ok: false, reason: 'tracker-not-open' });
          return;
        }
        // 激活标签页与窗口，确保用户能看到确认弹窗
        if (trackerTab.windowId) {
          await chrome.windows.update(trackerTab.windowId, { focused: true }).catch(() => {});
        }
        await chrome.tabs.update(trackerTab.id, { active: true }).catch(() => {});
        const relay = await chrome.tabs.sendMessage(trackerTab.id, { type: MSG.RELAY_TO_TRACKER, record: request.record });
        sendResponse({ ok: !!(relay && relay.ok) });
      } catch (err) {
        // 页面尚未注入 content script（刚打开、正在刷新等）
        console.warn('推送网页版管理器失败', err);
        sendResponse({ ok: false, reason: 'tracker-not-ready', message: err.message });
      }
    })();
    return true;
  }

  // 存入暂存箱：网页版管理器未打开时的回落路径，打开网页版后逐条确认
  if (request.type === MSG.SAVE_JOB_RECORD) {
    (async () => {
      try {
        const queue = await getPendingQueue();
        const staged = {
          id: (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          company: String(request.record.company || '').trim() || '待确认公司',
          position: String(request.record.position || '').trim() || '待确认岗位',
          city: String(request.record.city || '').trim(),
          applicationDate: String(request.record.applicationDate || new Date().toISOString().slice(0, 10)),
          stage: String(request.record.stage || '已投递'),
          applicationUrl: String(request.record.applicationUrl || ''),
          scheduleAt: String(request.record.scheduleAt || ''),
          recentSchedule: String(request.record.recentSchedule || ''),
          nextAction: String(request.record.nextAction || ''),
          updatedAt: Date.now(),
          pendingAt: Date.now()
        };

        // 查重：duplicate（同链接或同公司同岗位）→ 更新暂存项；variant（同公司的另一个岗位）→ 入队
        const hit = findDuplicateRecord(queue, staged);
        if (hit && hit.mode === 'duplicate') {
          const existing = hit.record;
          Object.assign(existing, {
            company: staged.company,
            position: staged.position,
            city: staged.city || existing.city,
            applicationDate: staged.applicationDate || existing.applicationDate,
            stage: staged.stage || existing.stage,
            applicationUrl: staged.applicationUrl || existing.applicationUrl,
            recentSchedule: staged.recentSchedule || existing.recentSchedule,
            nextAction: staged.nextAction || existing.nextAction,
            updatedAt: staged.updatedAt,
            pendingAt: staged.pendingAt
          });
          await chrome.storage.local.set({ [PENDING_KEY]: queue });
          sendResponse({ ok: true, record: existing, total: queue.length, updated: true });
        } else {
          // 同一家公司的另一个岗位（括号里是不同城市/方向/批次）：不合并，
          // 但标出 variantOf 让侧栏说明「这不是重复堆积」，避免用户以为暂存箱出了问题
          if (hit && hit.mode === 'variant') staged.variantOf = `${hit.record.company} · ${hit.record.position}`;
          queue.unshift(staged);
          await chrome.storage.local.set({ [PENDING_KEY]: queue });
          sendResponse({ ok: true, record: staged, total: queue.length, updated: false });
        }
      } catch (err) {
        console.error('暂存投递记录失败', err);
        sendResponse({ ok: false, message: err.message });
      }
    })();
    return true;
  }

  // 取暂存队列（网页版管理器打开时由 bridge 调用）；顺带做一次性旧数据迁移
  if (request.type === MSG.GET_PENDING_RECORDS) {
    (async () => {
      try {
        let queue = await getPendingQueue();
        // 一次性兜底：旧版本地 records 并入暂存确认流后清空
        const legacyRes = await chrome.storage.local.get([RECORDS_STORAGE_KEY]);
        const legacy = Array.isArray(legacyRes[RECORDS_STORAGE_KEY]) ? legacyRes[RECORDS_STORAGE_KEY] : [];
        if (legacy.length) {
          legacy.forEach(old => {
            // 只有 duplicate 才跳过；variant 是同一家公司的另一个岗位，必须保留入队
            const hit = findDuplicateRecord(queue, old);
            if (!hit || hit.mode !== 'duplicate') {
              queue.push({ ...old, id: old.id || ((self.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`), pendingAt: Number(old.updatedAt) || Date.now() });
            }
          });
          await chrome.storage.local.set({ [PENDING_KEY]: queue, [RECORDS_STORAGE_KEY]: [] });
        }
        sendResponse({ ok: true, records: queue });
      } catch (err) {
        sendResponse({ ok: false, records: [], message: err.message });
      }
    })();
    return true;
  }

  // 暂存出队（丢弃语义：确认弹窗已展示即出队）
  if (request.type === MSG.REMOVE_PENDING_RECORD) {
    (async () => {
      try {
        const queue = (await getPendingQueue()).filter(item => item.id !== request.id);
        await chrome.storage.local.set({ [PENDING_KEY]: queue });
        sendResponse({ ok: true, total: queue.length });
      } catch (err) {
        sendResponse({ ok: false, message: err.message });
      }
    })();
    return true;
  }

  // 接收网页版管理器下发的简历（B3 桥接）
  if (request.type === MSG.SAVE_RESUME) {
    (async () => {
      try {
        if (request.resume && typeof request.resume === 'object') {
          await chrome.storage.local.set({ [RESUME_STORAGE_KEY]: request.resume });
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false, message: '无效简历数据' });
        }
      } catch (err) {
        sendResponse({ ok: false, message: err.message });
      }
    })();
    return true;
  }

  if (request.type === MSG.GET_RESUME_DATA) {
    (async () => {
      try {
        const res = await chrome.storage.local.get([RESUME_STORAGE_KEY]);
        const resume = res[RESUME_STORAGE_KEY] || AJA.DEFAULT_RESUME;
        sendResponse({ ok: true, data: resume });
      } catch (err) {
        sendResponse({ ok: false, data: AJA.DEFAULT_RESUME });
      }
    })();
    return true;
  }
});

// 注：AI 辅助填写 / 表单理解引擎已于 v4.0.0 移除——插件回归"纯离线采集端 + 简历字段点击速填"，background 不再发起任何网络请求。
