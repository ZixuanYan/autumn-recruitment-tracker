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
  root.AJA.VERSION = '3.3.0';

  // 招聘阶段预设（与网页版 autumn-recruitment-tracker 的 STAGE_PRESETS 保持一致，两端需同步；实际阶段可自定义）
  root.AJA.STAGES = ['待投递', '已投递', '测评', '笔试', '机试', '一面', '二面', '三面', '四面', '五面', '交叉面', 'HR面', 'Offer', '已结束'];

  // 存储键（与网页版保持同名，保证 JSON 备份格式互通；插件侧存储域为 chrome.storage.local）
  root.AJA.RECORDS_STORAGE_KEY = 'autumnRecruitmentTracker.records.v1';   // 旧版遗留，仅一次性迁移源
  root.AJA.RESUME_STORAGE_KEY = 'autumnRecruitmentTracker.resume.v1';
  root.AJA.PENDING_KEY = 'autumnRecruitmentTracker.pending.v1';           // 暂存箱队列
  root.AJA.SAFETY_DB_NAME = 'autumnRecruitmentTracker.safety.v1';
  root.AJA.AI_CONFIG_KEY = 'autumnRecruitmentTracker.aiConfig.v1';   // AI 辅助填写配置（仅存本机，绝不进云同步/导出备份）

  // 与网页版管理器的桥接
  root.AJA.TRACKER_URL = 'https://zixuanyan.github.io/autumn-recruitment-tracker/';
  root.AJA.TRACKER_URL_PATTERN = 'https://zixuanyan.github.io/autumn-recruitment-tracker*';
  root.AJA.TRACKER_ORIGIN = 'https://zixuanyan.github.io';
  root.AJA.TRACKER_PATH_PREFIX = '/autumn-recruitment-tracker';

  // 消息类型（chrome.runtime / tabs 通信）
  root.AJA.MSG = {
    PUSH_TO_TRACKER: 'PUSH_TO_TRACKER',       // content -> background：推送记录到网页版（实时确认）
    RELAY_TO_TRACKER: 'RELAY_TO_TRACKER',     // background -> 网页版 content：中继记录
    SAVE_JOB_RECORD: 'SAVE_JOB_RECORD',       // content -> background：存入暂存箱
    GET_PENDING_RECORDS: 'GET_PENDING_RECORDS', // bridge -> background：取暂存队列
    REMOVE_PENDING_RECORD: 'REMOVE_PENDING_RECORD', // bridge -> background：出队（丢弃）
    SAVE_RESUME: 'SAVE_RESUME',               // bridge -> background：接收网页版下发的简历
    GET_RESUME_DATA: 'GET_RESUME_DATA',       // 任意 -> background：读简历
    TOGGLE_SIDEBAR: 'TOGGLE_SIDEBAR',         // background -> content：快捷键/图标唤起侧边栏
    AI_FILL: 'AI_FILL'                        // content -> background：AI 辅助填写（对规则未命中字段请求 AI 匹配）
  };

  // 网页版 postMessage 桥接标识（独立于原作者旧插件的 AUTUMN_JOB_CAPTURE，避免协议撞车）
  root.AJA.BRIDGE_SOURCE = 'AUTUMN_JOB_ASSISTANT';
})();
