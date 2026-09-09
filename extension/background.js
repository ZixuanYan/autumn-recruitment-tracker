/**
 * 秋招求职与简历助手 - Background Service Worker（classic worker，用 importScripts 共享公共模块）
 * 职责：暂存箱队列、简历存取、与网页版管理器的标签页定位与中继
 */
'use strict';

// 加载顺序有依赖：shared 四件必须**先于** common/constants.js —— constants 里的
// AJA.STAGES 是对 AJA.STAGE_PRESETS 的别名转发，顺序反了会转发到 undefined 且**不报错**
// （表现为收录表单的阶段下拉空空如也）。extension/shared/ 是仓库根 shared/ 的生成拷贝
// （Chrome 扩展只能加载扩展目录内的文件），由 scripts/pack-extension.js 同步、同源守卫防漂移。
importScripts(
  'shared/stages.js',
  'shared/company-types.js',
  'shared/company-key.js',
  'shared/default-resume.js',
  'common/constants.js'
);

const RECORDS_STORAGE_KEY = AJA.RECORDS_STORAGE_KEY;
const RESUME_STORAGE_KEY = AJA.RESUME_STORAGE_KEY;
const PENDING_KEY = AJA.PENDING_KEY;
const MSG = AJA.MSG;

// ================= 初始化时检查并写入默认简历（如果尚无配置）=================
// 默认简历定义见 shared/default-resume.js（全端唯一，不预置个人信息）
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

// 暂存箱去重：与网页端 index.html 的 findDuplicateRecord 同源（都基于 shared/company-key.js 的归一化键）。
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
  // v5.3.0：机构（orgUnit）参与判重，与网页端 src/core/dedupe.js 的三要素保持一致。
  // 不加的话暂存箱会把「招商银行/杭州分行/客户经理」与「招商银行/成都分行/客户经理」判成同一条，
  // 命中下面的 duplicate 合并分支 → Object.assign 让第二条**覆盖**第一条，一次真实投递静默消失。
  // 机构不同、岗位相同时会落到 variant（looseKey 相等），与网页端同款语义：提示但不合并。
  const unit = String((incoming && incoming.orgUnit) || '').trim();
  let variant = null;
  for (const r of list) {
    if (!AJA.sameCompany(company, r.company)) continue;
    if (AJA.positionKey(r.position) === posKey && String(r.orgUnit || '').trim() === unit) return { record: r, mode: 'duplicate' };
    if (!variant && looseKey.length >= 2 && AJA.loosePositionKey(r.position) === looseKey) variant = r;
  }
  return variant ? { record: variant, mode: 'variant' } : null;
}

async function getPendingQueue() {
  const res = await chrome.storage.local.get([PENDING_KEY]);
  return Array.isArray(res[PENDING_KEY]) ? res[PENDING_KEY] : [];
}

// ================= Side Panel 入口（v5.0.0）=================
// 点工具栏图标直接打开侧边面板。注意：一旦设置 openPanelOnActionClick，
// chrome.action.onClicked 就**不再触发**（两者互斥），所以旧版那个 onClicked 监听必须删掉，
// 留着就是永远不执行的死代码，还会让人误以为图标点击走的是它。
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

// 浏览器级快捷键（chrome.commands）：比页面内监听可靠，不受焦点/iframe/保留键影响。
// commands 的触发算 user gesture，所以这里可以调 sidePanel.open()；而 content script 里点胶囊
// 再转发过来就丢了手势、open() 会失败——这正是胶囊不承担「打开面板」职责、只做收录的原因。
// command id 仍叫 toggle-sidebar（改 id 会让用户已自定义的快捷键绑定失效），但语义已变为「打开面板」：
// Side Panel 没有提供关闭 API，关闭走面板右上角浏览器自带的 X。
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-sidebar') return;
  if (!chrome.sidePanel || !chrome.sidePanel.open) return;
  try {
    const win = await chrome.windows.getCurrent();
    if (win && typeof win.id === 'number') await chrome.sidePanel.open({ windowId: win.id });
  } catch (_) {
    // 浏览器版本过低（Side Panel 需 Chrome/Edge 114+）或窗口不可用：静默忽略。
    // 胶囊与迷你收录卡片不依赖 Side Panel，收录功能仍然完整。
  }
});

// 取当前活动标签页 id（panel 没带 tabId 时的兜底）
async function getActiveTabId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab && typeof tab.id === 'number' ? tab.id : null;
  } catch (_) {
    return null;
  }
}

// ================= 监听各页面消息 =================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // Side Panel → 目标标签页的 content script：解析当前页 / 把值填入宿主页面聚焦框。
  // Side Panel 是扩展页面（chrome-extension:// 源），拿不到宿主页 DOM，只能经这里中转。
  // 失败一律收敛成 reason 字符串，让面板能翻成人话（见 panel.js 的 reasonText），
  // 否则用户只会看到「点了没反应」——这是 Side Panel 形态最容易出的体验问题。
  if (request.type === MSG.SCAN_CURRENT_PAGE || request.type === MSG.FILL_FOCUSED_FIELD) {
    (async () => {
      const requested = Number(request.tabId);
      const tabId = Number.isInteger(requested) ? requested : await getActiveTabId();
      if (!Number.isInteger(tabId)) {
        sendResponse({ ok: false, reason: 'no-tab' });
        return;
      }
      try {
        const res = await chrome.tabs.sendMessage(tabId, request);
        sendResponse(res || { ok: false, reason: 'no-response' });
      } catch (err) {
        // 当前页没有注入 content script：edge:// 内部页、扩展商店页、页面刚打开还没注入完
        sendResponse({ ok: false, reason: 'no-content-script', message: err && err.message ? err.message : String(err) });
      }
    })();
    return true;
  }

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
          // 企业性质（v4.2.0）：只做透传与类型收敛，不做白名单校验——
          // 网页端 normalizeRecord 才是唯一真相源，插件侧再维护一份枚举只会增加漂移面。
          companyType: String(request.record.companyType || ''),
          // 机构（v5.3.0）：同样只透传与类型收敛，不做任何校验或推断 ——
          // 网页端 normalizeRecord 才是唯一真相源，插件侧再维护一份规则只会增加漂移面。
          orgUnit: String(request.record.orgUnit || '').trim().slice(0, 60),
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
            // 已选过的企业性质不能被「这次没选」冲掉（与 city 同款语义），否则重复收录同一岗位会丢字段
            companyType: staged.companyType || existing.companyType || '',
            // 已填过的机构不能被「这次没填」冲掉（与 city / companyType 同款语义）
            orgUnit: staged.orgUnit || existing.orgUnit || '',
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
