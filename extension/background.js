/**
 * 秋招求职与简历助手 - Background Service Worker（classic worker，用 importScripts 共享公共模块）
 * 职责：暂存箱队列、简历存取、与网页版管理器的标签页定位与中继
 */
'use strict';

importScripts('common/constants.js', 'common/default-resume.js', 'common/ai-helpers.js');

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

// 收录查重：同链接或同公司同岗位视为同一条记录
function findDuplicateRecord(records, incoming) {
  const url = String(incoming.applicationUrl || '').trim();
  const company = String(incoming.company || '').trim();
  const position = String(incoming.position || '').trim();
  return records.find(r => {
    if (url && String(r.applicationUrl || '').trim() === url) return true;
    return company && position && r.company === company && r.position === position;
  });
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

        // 查重：同链接或同公司同岗位 → 更新暂存项，否则入队
        const existing = findDuplicateRecord(queue, staged);
        if (existing) {
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
            if (!findDuplicateRecord(queue, old)) {
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

  // AI 辅助填写：对规则未命中的字段，请求用户自配的 OpenAI 兼容接口，返回经校验的 {fieldId,value}
  if (request.type === MSG.AI_FILL) {
    handleAiFill(request)
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, success: false, error: (err && err.message) || 'AI 请求失败' }));
    return true;
  }
});

// ================= AI 辅助填写（思路移植自 MIT 项目 Resume Pro；仅对用户显式配置的接口发起请求）=================
const AI_SYSTEM_PROMPT = [
  '你是一个网页表单填写助手。根据简历字段数据，判断表单中每个输入框应该填写什么值。',
  '规则：',
  '1. 仅返回 JSON 数组，不含任何解释或 markdown 代码块',
  '2. 格式：[{"fieldId":"xxx","value":"yyy"}]',
  '3. 只填写能确定匹配的字段，不确定的跳过',
  '4. 基本信息字段优先精确匹配，不要把教育背景、经历、技能字段填进姓名、邮箱、手机号、出生日期等基础字段',
  '5. 遇到拼音、证件类型、外语类型/等级、年月分拆下拉框等复杂字段，只有在能确定时才填写',
  '6. 匹配考虑同义词：手机=电话=联系方式=mobile=phone',
  '7. 只能使用简历字段里真实存在的值，绝不编造任何内容'
].join('\n');

function normalizeAiConfig(aiConfig) {
  return {
    apiUrl: String((aiConfig && aiConfig.apiUrl) || '').trim(),
    model: String((aiConfig && aiConfig.model) || '').trim(),
    apiKey: String((aiConfig && aiConfig.apiKey) || '').trim()
  };
}

function buildAiUserPrompt(formFields, resumeFields) {
  return [
    '表单字段列表：',
    JSON.stringify(formFields, null, 2),
    '',
    '简历字段列表：',
    JSON.stringify(resumeFields, null, 2),
    '',
    '填写原则：基本信息优先匹配基本信息分组；教育背景不要填进邮箱、电话、出生日期、籍贯等基础字段；低置信度时留空。'
  ].join('\n');
}

function parseAiJsonContent(content) {
  const cleaned = String(content).trim()
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

function normalizeAiMatches(payload) {
  const source = Array.isArray(payload) ? payload : (payload && payload.matches);
  if (!Array.isArray(source)) throw new Error('结果不是 JSON 数组');
  return source.map(item => {
    if (!item || typeof item !== 'object') return null;
    const fieldId = String(item.fieldId == null ? '' : item.fieldId).trim();
    const value = String(item.value == null ? '' : item.value);
    if (!fieldId || !value) return null;
    return { fieldId, value };
  }).filter(Boolean);
}

async function handleAiFill(message) {
  const aiConfig = normalizeAiConfig(message.aiConfig);
  const formFields = Array.isArray(message.formFields) ? message.formFields : [];
  const resumeFields = Array.isArray(message.resumeFields) ? message.resumeFields : [];

  if (!aiConfig.apiUrl || !aiConfig.model || !aiConfig.apiKey) {
    return { ok: false, success: false, error: '请先在插件侧边栏配置 AI 接口' };
  }
  if (!formFields.length) return { ok: true, success: true, matches: [] };
  if (!resumeFields.length) return { ok: false, success: false, error: '简历为空，无可用于匹配的数据' };

  // 兜底再次跳过高风险字段（内容脚本已过滤一层）
  const targetFields = formFields.filter(f => !(AJA.AIHelpers && AJA.AIHelpers.shouldSkipAIForField(f)));
  if (!targetFields.length) return { ok: true, success: true, matches: [] };

  let response;
  try {
    response = await fetch(aiConfig.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiConfig.apiKey}` },
      body: JSON.stringify({
        model: aiConfig.model,
        temperature: 0,
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: buildAiUserPrompt(targetFields, resumeFields) }
        ]
      })
    });
  } catch (_) {
    return { ok: false, success: false, error: '无法连接 AI 接口，请检查网络与 API URL' };
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = (data && data.error && data.error.message) || (data && data.message) || `HTTP ${response.status}`;
    return { ok: false, success: false, error: `AI 接口请求失败：${detail}` };
  }
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (typeof content !== 'string' || !content.trim()) {
    return { ok: false, success: false, error: 'AI 未返回可解析的内容' };
  }
  let aiMatches;
  try {
    aiMatches = normalizeAiMatches(parseAiJsonContent(content));
  } catch (err) {
    return { ok: false, success: false, error: `AI 返回结果解析失败：${err.message}` };
  }
  // 防幻觉：值必须对字段合法（select/radio 值∈选项 + email/phone/id/date/name 语义正则）
  const matches = AJA.AIHelpers ? AJA.AIHelpers.filterValidMatches(formFields, aiMatches) : aiMatches;
  return { ok: true, success: true, matches };
}
