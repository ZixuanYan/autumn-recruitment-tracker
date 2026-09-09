/**
 * 秋招求职与简历助手 - 公共常量
 * 全端共享（content scripts 注入 / background importScripts）
 * 挂载全局命名空间 AJA，不使用 export，保证加载环境通用
 */
(() => {
  'use strict';
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.AJA = root.AJA || {};

  // 扩展版本（胶囊 title / 控制台均会展示，用于排查“是否已加载新代码”）
  // 必须与 manifest.json 的 version 一致，test/extension-ui.js 有契约断言
  root.AJA.VERSION = '5.3.0';

  // 招聘阶段预设（实际阶段可自定义，允许跳过笔试、支持三/四/五面、交叉面等）
  // v4.9.0 起值来自 shared/stages.js —— 它**必须先于本文件加载**（见 manifest.json 的
  // content_scripts、panel/panel.html 的 script、background.js 的 importScripts 三处顺序）。
  // 这里只做别名转发：shared 导出的名字是 STAGE_PRESETS（与网页版、Action 同名），
  // 而插件全代码用的是 AJA.STAGES，这一行让 capture-form.js / panel.js / 05-capture.js 的调用点零改动。
  // 注意：不要再在这里写字面量——本文件在 shared **之后**加载，字面量会把单一事实源覆盖回两份副本，
  //    而测试与功能全都正常，只有下次改阶段名时才会发现两端不一致。
  root.AJA.STAGES = root.AJA.STAGE_PRESETS;

  // 企业性质（封闭枚举，不像阶段那样允许自定义）：值同样来自 shared/company-types.js，
  // 且两端**同名**（AJA.COMPANY_TYPES / AJA.COMPANY_TYPE_UNSET），所以这里连别名都不必写。
  // 收录表单的「企业性质」下拉由该数组动态生成，首项固定「未设置」（value=''）。
  // 网页端 normalizeRecord 做白名单校验：不在 COMPANY_TYPES 里的值一律归为未设置，
  // 因此多写/写错一个字，用户选了就等于没选、洞察统计永远缺这一档——合并进 shared 之前
  // 这要靠 test/extension-bridge.js 的逐值一致性断言来防，现在结构上不可能漂移了。

  // 存储键（与网页版保持同名，保证 JSON 备份格式互通；插件侧存储域为 chrome.storage.local）
  root.AJA.RECORDS_STORAGE_KEY = 'autumnRecruitmentTracker.records.v1';   // 旧版遗留，仅一次性迁移源
  root.AJA.RESUME_STORAGE_KEY = 'autumnRecruitmentTracker.resume.v1';
  root.AJA.PENDING_KEY = 'autumnRecruitmentTracker.pending.v1';           // 暂存箱队列
  root.AJA.SAFETY_DB_NAME = 'autumnRecruitmentTracker.safety.v1';
  // 插件 UI 偏好（v5.0.0）：胶囊吸边方位与垂直位置 { side:'left'|'right', top:number }。
  // 与网页版同名 key 但存储域不同（插件是 chrome.storage.local，网页是 localStorage），不会互相覆盖。
  // 旧版胶囊位置完全不持久化，刷新页面就回到 top:180px，用户每次都得重新拖。
  root.AJA.UI_STORAGE_KEY = 'autumnRecruitmentTracker.ui.v1';

  // 与网页版管理器的桥接
  root.AJA.TRACKER_URL = 'https://zixuanyan.github.io/autumn-recruitment-tracker/';
  root.AJA.TRACKER_URL_PATTERN = 'https://zixuanyan.github.io/autumn-recruitment-tracker*';
  root.AJA.TRACKER_ORIGIN = 'https://zixuanyan.github.io';
  root.AJA.TRACKER_PATH_PREFIX = '/autumn-recruitment-tracker';

  // 消息类型（chrome.runtime / tabs 通信）
  // 「任意端」= content script / Side Panel / 网页版桥接三者之一，都经 background 的同一个 onMessage 中枢
  root.AJA.MSG = {
    PUSH_TO_TRACKER: 'PUSH_TO_TRACKER',       // 任意端 -> background：推送记录到网页版（实时确认）
    RELAY_TO_TRACKER: 'RELAY_TO_TRACKER',     // background -> 网页版 content：中继记录
    SAVE_JOB_RECORD: 'SAVE_JOB_RECORD',       // 任意端 -> background：存入暂存箱
    GET_PENDING_RECORDS: 'GET_PENDING_RECORDS', // 任意端 -> background：取暂存队列
    REMOVE_PENDING_RECORD: 'REMOVE_PENDING_RECORD', // 任意端 -> background：出队（丢弃）
    SAVE_RESUME: 'SAVE_RESUME',               // bridge -> background：接收网页版下发的简历
    GET_RESUME_DATA: 'GET_RESUME_DATA',       // 任意端 -> background：读简历
    // v5.0.0 新增：Side Panel 是扩展页面，拿不到宿主页 DOM，因此「解析当前页」与「填入聚焦框」
    // 都要 panel -> background -> tabs.sendMessage -> content 走一趟。background 只做转发与
    // 「当前页没有 content script」的错误收敛（edge:// 内部页、扩展商店页等）。
    SCAN_CURRENT_PAGE: 'SCAN_CURRENT_PAGE',       // panel -> background -> content：解析当前页岗位信息
    FILL_FOCUSED_FIELD: 'FILL_FOCUSED_FIELD'      // panel -> background -> content：把值填入宿主页面聚焦框
    // 注：旧版的 TOGGLE_SIDEBAR 已移除。图标点击由 sidePanel.setPanelBehavior({openPanelOnActionClick})
    // 接管，快捷键由 background 直接调 sidePanel.open()，都不再需要往 content script 发消息。
  };

  // 网页版 postMessage 桥接标识（独立于原作者旧插件的 AUTUMN_JOB_CAPTURE，避免协议撞车）
  root.AJA.BRIDGE_SOURCE = 'AUTUMN_JOB_ASSISTANT';
})();
