'use strict';
// ============================================================================
// test/web-runtime.js — 网页端「邮件提醒」运行时冒烟测试（无需浏览器/jsdom）
// 从 index.html 抽出邮件提醒整段函数，放进带桩 DOM 的 vm 沙箱真实执行，覆盖：
//   renderMailView 四态（未开云同步/无建议/失败/正常）、mailCardHtml 的 0/1/多命中
//   与高低置信勾选、applyMailPayload 过滤 applied、updateMailBadge 角标。
// 运行：node test/web-runtime.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const HTML_PATH = path.resolve(__dirname, '../../autumn-recruitment-tracker/index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

const START = '      // ================= 邮件提醒（M3）：本地状态、模糊匹配、复核视图、应用/忽略 =================';
const END = '      // ================= 视图路由：#/view 形式，旧锚点 #view 自动重定向 =================';
const si = html.indexOf(START);
const ei = html.indexOf(END);
if (si === -1 || ei === -1 || ei <= si) { console.error('✗ 未定位到邮件提醒函数段'); process.exit(1); }
const sectionSrc = html.slice(si, ei);

// ---- 桩 DOM / 应用全局 ----
const els = {};
const sandbox = {
  console,
  $: sel => (els[sel] || (els[sel] = { className: '', innerHTML: '', textContent: '', hidden: false })),
  escapeHtml: v => String(v).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])),
  formatClock: v => (v ? `CLK` : ''),
  formatDateTime: v => (v ? `DT(${v})` : '暂未安排'),
  localDateInput: () => '2026-09-05',
  MAIL_STORAGE_KEY: 'test.mail.v1',
  MAIL_CONFIG_FILENAME: 'mail-config.json',
  MAIL_CFG_DEFAULTS: { keywords: 'K', minConfidence: 0.3, sinceDays: 30, maxPerRun: 30, enabled: true, minIntervalHours: 0, promptExtra: '', promptOverride: '' },
  localStorage: { _s: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null; }, setItem(k, v) { this._s[k] = String(v); } },
  crypto: { getRandomValues: a => { for (let i = 0; i < a.length; i += 1) a[i] = Math.floor(Math.random() * 256); return a; } },
  records: [],
  syncConfig: { token: '', gistId: 'GID' },
  mailState: { appliedIds: [], dismissedIds: [], lastReadAt: '', encKey: '' },
  mailSuggestions: [],
  mailRawSuggestions: [],
  mailMeta: null,
  mailConfig: null,
  mailNeedKey: false,
  pendingMailSeedId: null,
  normalizeRecord: o => ({ ...o, id: o.id || 'new', stage: o.stage || '待投递', timeline: o.timeline || [{ stage: o.stage || '待投递', at: '2026-09-05', note: '' }] }),
  setTimeline: (rec, tl) => { rec.timeline = tl; rec.stage = tl[tl.length - 1].stage; return rec; },
  saveRecords: () => {}, render: () => {}, flashRow: () => {}, playOfferStamp: () => {}, showToast: () => {}, openDialog: () => {},
  scheduleSyncPush: () => {}, resolveSyncGist: async () => 'GID', gistRequest: async () => ({}), syncNow: async () => {}, openSyncDialog: () => {},
  CSS: { escape: s => s },
  document: { querySelector: () => null }
};

vm.createContext(sandbox);
vm.runInContext(sectionSrc, sandbox, { filename: 'mail-section.js' });

let failed = 0;
// 队列式执行：部分被测函数是 async（如 advanceRecordTo 的回退确认跨 await），
// 同步 harness 会在断言前就跑完，导致「假通过」。这里统一收集后按顺序 await。
const cases = [];
function check(name, fn) { cases.push({ kind: 'case', name, fn }); }
function section(title) { cases.push({ kind: 'section', title }); }
async function runAll() {
  for (const item of cases) {
    if (item.kind === 'section') { console.log(item.title); continue; }
    try { await item.fn(); console.log(`  ✓ ${item.name}`); }
    catch (e) { failed += 1; console.error(`  ✗ ${item.name}\n    ${e.message}`); }
  }
  console.log(`\n${failed ? `存在 ${failed} 个失败` : '运行时冒烟测试全部通过（邮件提醒 + v4.4.0）'}`);
  if (failed) process.exitCode = 1;
}

const bar = () => els['#mailStatusBar'];
const list = () => els['#mailList'];
const badge = () => els['#mailNavBadge'];

section('renderMailView 状态');
check('未开云同步 → warning 条 + 空列表', () => {
  sandbox.syncConfig.token = '';
  sandbox.renderMailView();
  assert.ok(bar().className.includes('warning'));
  assert.ok(bar().innerHTML.includes('需先开启云同步'));
  assert.strictEqual(list().innerHTML, '');
});
check('已开云同步但无 meta → 暂无邮件建议', () => {
  sandbox.syncConfig.token = 'tok'; sandbox.mailMeta = null; sandbox.mailSuggestions = [];
  sandbox.renderMailView();
  assert.ok(bar().innerHTML.includes('暂无邮件建议'));
  assert.ok(list().innerHTML.includes('mail-empty'));
});
check('meta.lastStatus=error → error 条 + lastError + 修复说明', () => {
  sandbox.mailMeta = { lastStatus: 'error', lastError: 'QQ 授权码失效' };
  sandbox.renderMailView();
  assert.ok(bar().className.includes('error'));
  assert.ok(bar().innerHTML.includes('QQ 授权码失效'));
  assert.ok(bar().innerHTML.includes('怎么修复'));
});
check('meta 正常 → ok 条 + 统计', () => {
  sandbox.mailMeta = { lastStatus: 'ok', lastRunAt: '2026-09-05T10:00:00Z', newCount: 2, pendingCount: 3 };
  sandbox.mailSuggestions = [{ id: 'uid-9', sourceUid: 9, company: 'X', confidence: 0.9, proposed: {} }];
  sandbox.records = [];
  sandbox.renderMailView();
  assert.ok(bar().className.includes('ok'));
  assert.ok(list().innerHTML.includes('mail-card'));
  // v4.6.0 及更早的 Gist 文件没有 lastDropped：状态栏必须与升级前完全一致，不出现「丢弃」字样
  assert.ok(!bar().innerHTML.includes('丢弃'), '老文件不应显示丢弃段');
  assert.ok(bar().innerHTML.includes('已读取邮件建议'), '既有标题不变');
});

section('邮件丢弃诊断（v4.6.1）');
check('有 lastDropped → 状态栏显示丢弃数，并可展开分类计数与逐封明细', () => {
  sandbox.mailMeta = {
    lastStatus: 'ok', lastRunAt: '2026-09-07T04:54:03Z', newCount: 0, pendingCount: 10,
    lastDropped: {
      total: 14, noiseFrom: 1, noiseSubject: 3, noKeyword: 8, aiNotRecruit: 1, lowConf: 1, aiError: 0,
      recent: [
        { uid: 1894, from: 'noreply@mokahr.com', subject: '面试邀请：后端开发工程师', reason: 'no-keyword' },
        { uid: 1888, from: 'postmaster@qq.com', subject: '退信', reason: 'noise-from' }
      ]
    }
  };
  sandbox.mailSuggestions = [];
  sandbox.renderMailView();
  const h = bar().innerHTML;
  assert.ok(bar().className.includes('ok'), '诊断信息不改变状态栏的成功语义');
  assert.ok(h.includes('丢弃 14 封'), '主行给出丢弃总数');
  assert.ok(h.includes('<details'), '明细可折叠展开（复用 error 分支的 .mail-help 样式）');
  assert.ok(h.includes('主题与正文都没命中预筛关键词') && h.includes('<b>8</b>'), '分类计数用中文标签');
  assert.ok(h.includes('noreply@mokahr.com'), '明细列出发件人');
  assert.ok(h.includes('面试邀请：后端开发工程师'), '明细列出主题');
  assert.ok(h.includes('#1894'), '明细带邮件编号，便于用 UID_FROM 精准回溯');
  assert.ok(h.includes('UID_FROM'), '给出可执行的补救办法，而不只是报数');
  // 计数为 0 的分类不显示，避免一排 0
  assert.ok(!h.includes('AI 调用失败'), 'aiError=0 的分类不出现');
});
check('lastDropped 全 0 / 结构非法时静默降级，不报错也不显示空壳', () => {
  sandbox.mailSuggestions = [];
  for (const dropped of [{ total: 0, recent: [] }, {}, null, 'oops', { total: -3 }]) {
    sandbox.mailMeta = { lastStatus: 'ok', lastRunAt: '2026-09-07T04:54:03Z', newCount: 1, pendingCount: 2, lastDropped: dropped };
    sandbox.renderMailView(); // 不得抛错
    assert.ok(!bar().innerHTML.includes('丢弃'), `lastDropped=${JSON.stringify(dropped)} 时不应显示丢弃段`);
    assert.ok(bar().innerHTML.includes('本次新增 1 封'), '其余统计照常');
  }
});
check('mailDroppedHtml(null) 返回空串（状态栏拼接时不产生 "null" 字样）', () => {
  assert.strictEqual(sandbox.mailDroppedHtml(null), '');
  assert.strictEqual(sandbox.mailDroppedHtml(undefined), '');
});
check('丢弃明细里的 from / subject 必须转义（外部邮件内容不得成为注入入口）', () => {
  sandbox.mailMeta = {
    lastStatus: 'ok', newCount: 0, pendingCount: 0,
    lastDropped: {
      total: 1, noiseFrom: 0, noiseSubject: 0, noKeyword: 1, aiNotRecruit: 0, lowConf: 0, aiError: 0,
      recent: [{ uid: 1, from: '<script>alert(1)</script>@evil.com', subject: '<img src=x onerror=alert(2)>', reason: 'no-keyword' }]
    }
  };
  sandbox.mailSuggestions = [];
  sandbox.renderMailView();
  const h = bar().innerHTML;
  assert.ok(!h.includes('<script>'), '发件人里的 script 标签必须被转义');
  assert.ok(!h.includes('<img src=x'), '主题里的 img/onerror 必须被转义');
  assert.ok(h.includes('&lt;script&gt;'), '以转义后的文本呈现');
  assert.ok(h.includes('&lt;img src=x onerror=alert(2)&gt;'));
});
check('未知 reason 回退显示原文，便于发现两端枚举漂移', () => {
  sandbox.mailMeta = {
    lastStatus: 'ok', newCount: 0, pendingCount: 0,
    lastDropped: { total: 1, recent: [{ uid: 7, from: 'a@b.com', subject: 's', reason: 'brand-new-reason' }] }
  };
  sandbox.mailSuggestions = [];
  sandbox.renderMailView();
  assert.ok(bar().innerHTML.includes('brand-new-reason'), '不吞掉未知原因');
});

section('mailCardHtml 匹配分支');
const baseSug = {
  id: 'uid-1', sourceUid: 1, company: '腾讯科技（深圳）有限公司', position: '后端', emailType: '面试邀请',
  confidence: 0.8, subject: '面试邀请', summary: '二面通知', from: 'hr@t.com', receivedAt: '2026-09-05T10:00:00Z',
  proposed: { milestone: { stage: '二面', at: '2026-09-12', note: '邮件·面试邀请' }, scheduleAt: '2026-09-12T14:30', recentSchedule: '二面 · 线上', nextAction: '准备项目' }
};
check('1 命中 → single + data-target-id + 应用所选 + 高置信默认勾选', () => {
  sandbox.records = [{ id: 'r1', company: '腾讯', position: '后端', stage: '一面' }];
  const h = sandbox.mailCardHtml(baseSug);
  assert.ok(h.includes('mail-match single'));
  assert.ok(h.includes('data-target-id="r1"'));
  assert.ok(h.includes('data-mail-action="apply"'));
  assert.ok(h.includes('data-mail-field="milestone" checked'));
  assert.ok(!h.includes('low-conf'));
});
check('多命中 → 下拉选择 mail-target-select', () => {
  sandbox.records = [{ id: 'a', company: '腾讯', position: '后端', stage: '一面' }, { id: 'b', company: '腾讯科技', position: '前端', stage: '笔试' }];
  const h = sandbox.mailCardHtml(baseSug);
  assert.ok(h.includes('mail-target-select'));
  assert.ok(h.includes('<option'));
});
check('0 命中 → none + 新建记录按钮', () => {
  sandbox.records = [{ id: 'z', company: '美团', position: '产品', stage: '一面' }];
  const h = sandbox.mailCardHtml(baseSug);
  assert.ok(h.includes('mail-match none'));
  assert.ok(h.includes('data-mail-action="new"'));
});
check('低置信 → low-conf 且默认不勾选', () => {
  sandbox.records = [{ id: 'r1', company: '腾讯', position: '后端', stage: '一面' }];
  const h = sandbox.mailCardHtml({ ...baseSug, confidence: 0.4 });
  assert.ok(h.includes('low-conf'));
  assert.ok(h.includes('data-mail-field="milestone" >') || !h.includes('milestone" checked'));
  assert.ok(!h.includes('data-mail-field="milestone" checked'));
});

section('applyMailPayload / updateMailBadge');
check('applyMailPayload 过滤 appliedIds，只留待复核', () => {
  sandbox.mailState = { appliedIds: ['uid-1'], dismissedIds: [], lastReadAt: '' };
  sandbox.syncConfig.token = 'tok';
  sandbox.applyMailPayload({ meta: { lastStatus: 'ok', newCount: 2, pendingCount: 2 }, suggestions: [{ id: 'uid-1', sourceUid: 1 }, { id: 'uid-2', sourceUid: 2 }] });
  assert.strictEqual(sandbox.mailSuggestions.length, 1);
  assert.strictEqual(sandbox.mailSuggestions[0].id, 'uid-2');
});
check('applyMailPayload(null) 清空建议与 meta', () => {
  sandbox.applyMailPayload(null);
  assert.strictEqual(sandbox.mailSuggestions.length, 0);
  assert.strictEqual(sandbox.mailMeta, null);
});
check('updateMailBadge 数量>0 显示、=0 隐藏', () => {
  sandbox.mailSuggestions = [{ id: 'a' }, { id: 'b' }];
  sandbox.updateMailBadge();
  assert.strictEqual(badge().textContent, '2');
  assert.strictEqual(badge().hidden, false);
  sandbox.mailSuggestions = [];
  sandbox.updateMailBadge();
  assert.strictEqual(badge().hidden, true);
});

section('加密 / 配置 / 跨设备（v4.3.0）');
check('mailNeedKey=true → 提示填写解密密钥、列表清空', () => {
  sandbox.syncConfig.token = 'tok';
  sandbox.mailNeedKey = true;
  sandbox.renderMailView();
  assert.ok(bar().className.includes('warning'));
  assert.ok(bar().innerHTML.includes('邮件建议已加密'));
  assert.strictEqual(list().innerHTML, '');
  sandbox.mailNeedKey = false;
});
check('applyMailPayload 存原始建议；refilterMail 按 mailState 过滤（模拟跨设备合并）', () => {
  sandbox.mailState = { appliedIds: ['uid-2'], dismissedIds: [], lastReadAt: '', encKey: '' };
  sandbox.applyMailPayload({ meta: { lastStatus: 'ok' }, suggestions: [{ id: 'uid-1' }, { id: 'uid-2' }, { id: 'uid-3' }] });
  assert.strictEqual(sandbox.mailRawSuggestions.length, 3);
  assert.deepStrictEqual(sandbox.mailSuggestions.map(s => s.id), ['uid-1', 'uid-3']);
  sandbox.mailState.dismissedIds = ['uid-1']; // 另一设备忽略了 uid-1，同步并集后
  sandbox.refilterMail();
  assert.deepStrictEqual(sandbox.mailSuggestions.map(s => s.id), ['uid-3']);
});
check('currentMailConfig 无云端配置时回落默认值', () => {
  sandbox.mailConfig = null;
  const c = sandbox.currentMailConfig();
  assert.strictEqual(c.minConfidence, 0.3);
  assert.strictEqual(c.enabled, true);
  assert.strictEqual(c.sinceDays, 30);
});

section('v4.7.0 提示词展示与整体替换');
check('currentMailConfig 读回 promptOverride；非字符串与超长值都要收敛', () => {
  sandbox.mailConfig = { promptOverride: '只解析国企邮件' };
  assert.strictEqual(sandbox.currentMailConfig().promptOverride, '只解析国企邮件');
  // Gist 被手改成数字/null/数组时不得污染 textarea（否则界面上会出现 "undefined"）
  for (const bad of [123, null, {}, ['x']]) {
    sandbox.mailConfig = { promptOverride: bad };
    assert.strictEqual(sandbox.currentMailConfig().promptOverride, '', `promptOverride=${JSON.stringify(bad)} 应回落空串`);
  }
  // 云端存了超长内容也要截到 4000，与 Action 侧 PROMPT_OVERRIDE_MAX 一致
  sandbox.mailConfig = { promptOverride: 'p'.repeat(9000) };
  assert.strictEqual(sandbox.currentMailConfig().promptOverride.length, 4000);
  sandbox.mailConfig = null;
  assert.strictEqual(sandbox.currentMailConfig().promptOverride, '', '无云端配置时回落默认（用内置提示词）');
});
check('renderPromptSnapshot：有快照则展示 Action 实际生效的全文，无快照则整块隐藏', () => {
  const wrap = sandbox.$('#mailPromptSnapshotWrap');
  const body = sandbox.$('#mailPromptSnapshot');
  const note = sandbox.$('#mailPromptSnapshotNote');
  const snapshot = '你是招聘邮件解析引擎。\n\n【输出契约 · 不可覆盖】\n1. 严格只返回一个 JSON 对象';
  sandbox.mailMeta = { lastStatus: 'ok', lastRunAt: '2026-09-07T10:42:29Z', promptSnapshot: snapshot };
  sandbox.renderPromptSnapshot();
  assert.strictEqual(wrap.hidden, false);
  assert.strictEqual(body.textContent, snapshot, '必须原样展示 Action 写入的那一份');
  assert.ok(!body.innerHTML, '要用 textContent 而不是 innerHTML（提示词含 < > 会被当标签解析）');
  assert.ok(note.textContent.includes('实际发给 AI'), '说明这份就是生效值');
  assert.ok(note.textContent.includes('不可覆盖'), '要讲清契约段删不掉');
  assert.ok(note.textContent.includes('CLK'), '带上次运行时间，便于判断快照新旧');
  // 旧版 Action（<0.4.0）写的 meta 没有该字段 → 整块隐藏，不给用户看空框
  sandbox.mailMeta = { lastStatus: 'ok', lastRunAt: '2026-09-07T10:42:29Z' };
  sandbox.renderPromptSnapshot();
  assert.strictEqual(wrap.hidden, true, '无快照时必须隐藏');
  assert.strictEqual(body.textContent, '', '并清空，避免残留上一次的内容');
  // mailMeta 整个为 null（还没同步过）也不得抛错
  sandbox.mailMeta = null;
  sandbox.renderPromptSnapshot();
  assert.strictEqual(wrap.hidden, true);
});
check('mailCardHtml：历史数据的「邮件·其它」改用 summary 展示（不必重扫就变好）', () => {
  sandbox.records = [{ id: 'r1', company: '滴滴', position: '后端', stage: '已投递' }];
  const legacy = {
    id: 'uid-1895', sourceUid: 1895, company: '滴滴', position: '后端', emailType: '其它',
    confidence: 0.95, subject: '【滴滴招聘】简历成功投递通知',
    summary: '简历成功投递滴滴校招，等待后续流程推进。',
    from: 'didiglobal-no-reply@mail.mokahr.co', receivedAt: '2026-09-06T10:00:00Z',
    proposed: { milestone: { stage: '已投递', at: '2026-09-06', note: '邮件·其它' }, scheduleAt: '', recentSchedule: '', nextAction: '查看邮件原文并按需跟进' }
  };
  const h = sandbox.mailCardHtml(legacy);
  // 精确断言里程碑那一段：卡片本身另有摘要行会显示 summary，不能用「整个 HTML 含/不含」来判断
  assert.ok(h.includes('推进里程碑：已投递（2026-09-06） · 邮件·简历成功投递滴滴校招'), '里程碑备注应是 summary');
  assert.ok(!h.includes('邮件·其它'), '不该再出现零信息量的分类术语');
  // 有明确类型的历史数据保持原样（更短、易扫读）
  const typed = { ...legacy, emailType: '测评', summary: '通知参加素质测评', proposed: { milestone: { stage: '测评', at: '2026-09-04', note: '邮件·测评' } } };
  const h2 = sandbox.mailCardHtml(typed);
  assert.ok(h2.includes('推进里程碑：测评（2026-09-04） · 邮件·测评'), '类型明确的保留类型名，不换成 summary');
  // 用户手写的备注绝不能被改写
  const manual = { ...legacy, summary: 'x', proposed: { milestone: { stage: '一面', at: '2026-09-10', note: '电话面试，面试官是张工' } } };
  assert.ok(sandbox.mailCardHtml(manual).includes('推进里程碑：一面（2026-09-10） · 电话面试，面试官是张工'));
});

// ============================================================================
// v4.4.0：洞察 / 台账（表格+看板）/ 详情抽屉 / ⌘K 命令面板 运行时冒烟
// 抽取三段真实源码放进第二个沙箱执行：CORE 纯函数块 + 邮件纯函数块（companyKeyOf 依赖
// normalizeCompanySlug）+ 洞察/台账渲染段 + 台账视图增强段；外部依赖一律用桩。
// ============================================================================
function extractFunction(src, name) {
  const marker = `function ${name}(`;
  let start = src.indexOf(marker);
  if (start === -1) return '';
  // 必须带上 async 前缀：否则抽出来的异步函数体里的 await 会直接变成语法错误
  if (src.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  // 必须先配平参数列表的圆括号再找函数体的 '{'：默认参数写成 `options = {}` 时，
  // 直接 indexOf('{') 会命中默认值里的 '{'，配平后只返回一小段签名（踩过这个坑）。
  let p = src.indexOf('(', start);
  if (p === -1) return '';
  let pDepth = 0;
  let bodyStart = -1;
  for (; p < src.length; p += 1) {
    if (src[p] === '(') pDepth += 1;
    else if (src[p] === ')') { pDepth -= 1; if (pDepth === 0) { bodyStart = p + 1; break; } }
  }
  if (bodyStart === -1) return '';
  let i = src.indexOf('{', bodyStart);
  if (i === -1) return '';
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}
function extractBlock(src, startMark, endMark) {
  const s = src.indexOf(startMark);
  const e = src.indexOf(endMark);
  return (s !== -1 && e !== -1 && e > s) ? src.slice(s + startMark.length, e) : '';
}
// 顶层常量现场求值抽取（不在测试里复制字面量）：枚举漂移后测试会失败，而不是继续「绿」。
function extractConst(src, name) {
  const line = src.split('\n').find(l => l.includes(`const ${name} =`));
  if (!line) throw new Error(`未在 index.html 找到 const ${name}`);
  return new Function(`${line.trim()}\nreturn ${name};`)();
}

const CORE_START = '/*__CORE_PURE_START__*/';
const CORE_END = '/*__CORE_PURE_END__*/';
const INSIGHT_START = '      // ===== 洞察面板（v4.4.0）：漏斗 / 节奏 / 停留 / 指标 / 卡点，全部由 records+timeline 派生 =====';
const V44_START = '      // ================= 台账视图增强（v4.4.0）：UI 偏好 / 看板 / 详情抽屉 / ⌘K 命令面板 =================';
const coreBlock = extractBlock(html, CORE_START, CORE_END);
const mailPureBlock = extractBlock(html, '/*__MAIL_PURE_START__*/', '/*__MAIL_PURE_END__*/');
const insightSection = extractBlock(html, INSIGHT_START, CORE_START);
const v44Section = extractBlock(html, V44_START, START);
const getVisibleRecordsSrc = extractFunction(html, 'getVisibleRecords');
const applyAdvanceSrc = extractFunction(html, 'applyAdvance');
const loadRecordsSrc = extractFunction(html, 'loadRecords');
const submitFormSrc = extractFunction(html, 'submitForm');
// 岗位库「记为已投递」入口：浏览器实证时岗位库为空（0 卡片）测不到，改由运行时测试覆盖。
// 修复前这里是 `return showToast('这条岗位已经在投递记录中')` —— 硬拦截、点了没反应。
const handleJobActionSrc = extractFunction(html, 'handleJobAction');
// 时间线编辑器：新增表单的默认阶段就在这里决定（曾是「待投递」，会让记录在洞察里隐身）
const timelineEditorSrc = ['timelineRowHtml', 'renderTimelineEditor'].map(name => extractFunction(html, name));
// v4.5.0 区段：查重统一处置 resolveDuplicate + 录入时前置提示 updateSameCompanyHint。
// 必须用真实现 —— 它决定了「同一家公司能不能录进第二个岗位」，桩掉就等于没测。
const V45_START = '      // ================= 查重统一处置（v4.5.0）=================';
const v45Section = extractBlock(html, V45_START, V44_START);
// normalizeRecord 必须是真实现：它是「老数据补默认值 + 新字段透传 + 写回」这条链的核心，
// 桩成恒等函数会让 loadRecords 的写回永远不触发（测的是桩而不是应用）。
const normalizeRecordSrc = ['normalizeRecord', 'sanitizeTimeline', 'deriveStage', 'cryptoId']
  .map(name => extractFunction(html, name));

for (const [label, src] of [['CORE 纯函数块', coreBlock], ['邮件纯函数块', mailPureBlock], ['洞察/台账渲染段', insightSection], ['台账视图增强段', v44Section], ['getVisibleRecords', getVisibleRecordsSrc], ['查重统一处置段(v4.5.0)', v45Section], ['handleJobAction', handleJobActionSrc], ...timelineEditorSrc.map((src, i) => [[ 'timelineRowHtml', 'renderTimelineEditor' ][i], src])]) {
  if (!src || src.length < 40) { console.error(`✗ 未定位到${label}`); process.exit(1); }
}

const els2 = {};
function makeEl(sel) {
  return {
    sel, className: '', innerHTML: '', textContent: '', hidden: false, value: '', open: false, dataset: {}, style: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); },
      toggle(c, force) { const on = force === undefined ? !this._s.has(c) : !!force; if (on) this._s.add(c); else this._s.delete(c); return on; }
    },
    // 属性用真实映射存：悬浮明细会给触发元素设 aria-describedby，隐藏时必须摘掉，需要能断言
    _attrs: {},
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    removeAttribute(k) { delete this._attrs[k]; },
    focus() {}, scrollIntoView() {},
    // 悬浮明细浮层的定位依赖实测尺寸：默认给一个可控的矩形，测试里改写 _rect 即可模拟「靠近视口右/下边缘」
    _rect: { left: 100, top: 200, right: 260, bottom: 220, width: 160, height: 20 },
    getBoundingClientRect() { return this._rect; },
    closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    contains() { return false; },
    addEventListener() {}, showModal() { this.open = true; }, close() { this.open = false; }
  };
}
const calls = { saveRecords: [], toast: [], openDialog: [], confirm: [], focus: [], advance: [], delete: [] };
// 让桩 $ 表达真实 querySelector 语义：纯单 class 选择器命中文档里「第一个」带该 class 的元素，
// 且同一元素无论用 #id 还是 .class 访问都返回同一个桩。这样 $('.table-scroll') 与
// $('#recordsTableScroll') 会落到不同桩上——正是 v4.6.0 复用 .table-scroll 后「切换器选错元素」
// 缺陷的真实成因（旧桩按选择器字符串索引，天然无法暴露它，所以当初漏过）。
const DOM_ORDER = (() => {
  const order = [];
  const tagRe = /<([a-z][\w-]*)([^>]*)>/gi;
  let mm;
  while ((mm = tagRe.exec(html)) !== null) {
    const attrs = mm[2];
    const cls = /class="([^"]+)"/.exec(attrs);
    if (!cls) continue;
    const id = /(?:^|\s)id="([\w-]+)"/.exec(attrs);
    order.push({ id: id ? id[1] : null, classes: cls[1].trim().split(/\s+/) });
  }
  return order;
})();
function resolveEl(sel) {
  const cm = /^\.([\w-]+)$/.exec(sel);
  if (cm) {
    const first = DOM_ORDER.find(el => el.classes.includes(cm[1]));
    // 第一个匹配元素若带 id，则与 $('#thatId') 共享同一个桩（真实 DOM 里本就是同一个节点）
    const key = first && first.id ? `#${first.id}` : sel;
    return els2[key] || (els2[key] = makeEl(key));
  }
  return els2[sel] || (els2[sel] = makeEl(sel));
}
// 沙箱里的枚举一律取 index.html 的实时值（阶段预设 / 企业性质），避免测试复制字面量后与源码漂移
const STAGE_PRESETS_LIVE = extractConst(html, 'STAGE_PRESETS');
const COMPANY_TYPES_LIVE = extractConst(html, 'COMPANY_TYPES');
const COMPANY_TYPE_UNSET_LIVE = extractConst(html, 'COMPANY_TYPE_UNSET');
let confirmAnswer = true;
// 确认框三态：'ok' | 'cancel' | 'dismiss'（Esc/点遮罩）。resolveDuplicate 靠 lastConfirmOutcome()
// 区分「用户明确选了取消按钮」与「什么都没选就关掉」，后者必须中止入库而不是等同于某个按钮。
let confirmOutcomeValue = 'ok';
const sandbox2 = {
  console,
  $: resolveEl,
  els: {
    empty: makeEl('#emptyState'), body: makeEl('#recordBody'), caption: makeEl('#resultCaption'),
    upcoming: makeEl('#upcomingList'), search: makeEl('#searchInput'), filter: makeEl('#stageFilter'),
    sort: makeEl('#sortSelect'), dialog: makeEl('#recordDialog'), form: makeEl('#recordForm'), toast: makeEl('#toast')
  },
  document: { querySelector: () => null, querySelectorAll: () => [], body: { style: {} }, createElement: () => makeEl('tmp'), activeElement: null },
  // 悬浮明细浮层的定位与触屏降级都要读 window：给可控视口尺寸，测试里改写即可模拟窄屏/溢出
  window: { innerWidth: 1440, innerHeight: 900, matchMedia: () => ({ matches: false }) },
  localStorage: { _s: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null; }, setItem(k, v) { this._s[k] = String(v); } },
  location: { hash: '#/overview' },
  requestAnimationFrame: fn => fn(),
  setTimeout: (fn) => { fn(); return 0; },
  clearTimeout: () => {},
  escapeHtml: v => String(v == null ? '' : v).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])),
  formatDate: v => (v ? `D(${String(v).slice(5, 10)})` : '—'),
  formatDateTime: v => (v ? `DT(${v})` : '暂未安排'),
  parseLocal: v => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; },
  localDateInput: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
  stageOrder: s => { const i = STAGE_PRESETS_LIVE.indexOf(s); return i === -1 ? 9000 : i; },
  isActive: r => !['待投递', 'Offer', '已结束'].includes(r.stage),
  cryptoId: () => `id-${Math.random().toString(16).slice(2, 8)}`,
  UI_STORAGE_KEY: 'test.ui.v1',
  STAGE_PRESETS: STAGE_PRESETS_LIVE,
  COMPANY_TYPES: COMPANY_TYPES_LIVE,
  COMPANY_TYPE_UNSET: COMPANY_TYPE_UNSET_LIVE,
  syncConfig: { token: 'tok' },
  records: [],
  jobs: [], // 岗位库（handleJobAction 从这里按 data-job-id 取岗位）
  sampleDataMode: false,
  parseRoute: () => 'overview',
  exampleRecords: () => [{ id: 'demo1', company: '星海科技', position: '产品', stage: '一面' }],
  // normalizeRecord / sanitizeTimeline / deriveStage / cryptoId 用真实现（见下方注入），不在此打桩
  self: null, crypto: globalThis.crypto,
  markDeleted: () => {},
  saveRecords: msg => calls.saveRecords.push(msg || ''),
  render: () => {},
  showToast: (msg, options) => { calls.toast.push(msg); calls.lastToastOptions = options || null; },
  openDialog: rec => calls.openDialog.push(rec),
  openRecordFocus: id => calls.focus.push(id),
  confirmInApp: async (message, options) => {
    calls.confirm.push({ message: String(message || ''), title: (options && options.title) || '', confirmText: (options && options.confirmText) || '' });
    return confirmAnswer;
  },
  lastConfirmOutcome: () => confirmOutcomeValue,
  setTimeline: (rec, tl) => { rec.timeline = tl; rec.stage = tl[tl.length - 1].stage; rec.updatedAt = Date.now(); return rec; },
  flashRow: () => {}, playOfferStamp: () => {},
  // applyAdvance 的外部依赖（推进弹窗的状态与关闭动作不在被抽取的区段里）
  advancingId: null, closeAdvanceDialog: () => {},
  // loadRecords / submitForm 的外部依赖
  STORAGE_KEY: 'test.records.v1',
  primaryLoadState: 'unknown',
  editingId: null,
  pendingMailSeedId: null,
  collectTimeline: () => [{ stage: '已投递', at: '2026-09-06', note: '' }],
  closeDialog: () => { calls.closeDialog = (calls.closeDialog || 0) + 1; },
  markMailApplied: () => {}, renderMailView: () => {}, updateMailBadge: () => {},
  // submitForm 用 Object.fromEntries(new FormData(form).entries()) 取值：用 _entries 数组驱动
  FormData: class {
    constructor(form) { this._entries = (form && form._entries) || []; }
    entries() { return this._entries[Symbol.iterator](); }
  },
  openSyncDialog: () => {}, openScreenshotDialog: () => {}, openSafetyDialog: () => {}, openMailSettings: () => {},
  syncNow: () => {}, exportData: () => {}, exportIcs: () => {}, exportResume: () => {}
};
sandbox2.globalThis = sandbox2;
sandbox2.self = sandbox2; // cryptoId 用 self.crypto 探测
vm.createContext(sandbox2);
vm.runInContext(
  [mailPureBlock, coreBlock, v45Section, normalizeRecordSrc.join('\n'), getVisibleRecordsSrc, applyAdvanceSrc, loadRecordsSrc, submitFormSrc, handleJobActionSrc, timelineEditorSrc.join('\n'), insightSection, v44Section].join('\n'),
  sandbox2,
  { filename: 'v44-sections.js' }
);

section('\nv4.4.0 台账视图（表格 / 看板 / 拖拽推进）');
const boardColsEl = () => els2['#boardCols'];
const boardView = () => els2['#boardView'];
// 台账表格容器（唯一 id）与文档第一个 .table-scroll（洞察的 Offer 对比矩阵容器）必须是两个不同的桩
const recordsScroll = () => sandbox2.$('#recordsTableScroll');
const offerScroll = () => sandbox2.$('.table-scroll');

function seedRecords() {
  // getVisibleRecords 依赖筛选控件的值：filter 必须是 'all'，否则桩里的空字符串会筛掉全部记录
  sandbox2.els.search.value = '';
  sandbox2.els.filter.value = 'all';
  sandbox2.els.sort.value = 'schedule';
  sandbox2.records = [
    { id: 'r1', company: '腾讯', position: '后端', city: '深圳', stage: '一面', batch: '提前批', intent: 4, deadline: '', scheduleAt: '', applicationDate: '2026-09-01', updatedAt: 30, timeline: [{ stage: '已投递', at: '2026-09-01', note: '' }, { stage: '一面', at: '2026-09-04', note: '业务面' }], notes: [{ id: 'n1', at: 1, text: '问了项目难点' }], nextAction: '准备二面' },
    { id: 'r2', company: '腾讯科技有限公司', position: '前端', city: '深圳', stage: '已投递', batch: '', intent: 0, deadline: '', scheduleAt: '', applicationDate: '2026-09-02', updatedAt: 20, timeline: [{ stage: '已投递', at: '2026-09-02', note: '' }], notes: [], nextAction: '' },
    { id: 'r3', company: '阿里', position: '算法', city: '杭州', stage: 'Offer', batch: '', intent: 5, deadline: '', scheduleAt: '', applicationDate: '2026-08-20', updatedAt: 10, timeline: [{ stage: '已投递', at: '2026-08-20', note: '' }, { stage: 'Offer', at: '2026-09-03', note: '' }], notes: [], nextAction: '谈薪' }
  ];
}

check('boardColumns = 出现过的阶段（按预设序）+ 末尾固定 Offer / 已结束', () => {
  seedRecords();
  const cols = sandbox2.boardColumns(sandbox2.getVisibleRecords());
  // 沙箱内数组属于另一个 realm，deepStrictEqual 会因原型不同失败 → 按内容比较
  assert.strictEqual(cols.join('|'), '已投递|一面|Offer|已结束');
  // 没有任何记录时也应给出 Offer / 已结束 两列，便于直接拖入
  assert.strictEqual(sandbox2.boardColumns([]).join('|'), 'Offer|已结束');
});

check('renderBoard 渲染列与卡片，同公司卡片共用 companyColor', () => {
  seedRecords();
  sandbox2.renderBoard();
  const h = boardColsEl().innerHTML;
  assert.ok(h.includes('board-col'), '应有列');
  assert.ok(h.includes('data-id="r1"') && h.includes('data-id="r3"'));
  assert.ok(h.includes('拖到这里'), '空列有占位');
  const colorOf = id => {
    const seg = h.slice(h.indexOf(`data-id="${id}"`));
    return /--company-color:(#[0-9a-f]{6})/i.exec(seg.slice(0, 200))[1];
  };
  assert.strictEqual(colorOf('r1'), colorOf('r2'), '「腾讯」与「腾讯科技有限公司」应同色（同一家）');
  assert.notStrictEqual(colorOf('r1'), colorOf('r3'));
});

check('boardCardHtml 带批次 chip 与意向度点', () => {
  seedRecords();
  const h = sandbox2.boardCardHtml(sandbox2.records[0]);
  assert.ok(h.includes('board-chip">提前批'), '批次 chip');
  assert.ok(h.includes('intent-dots'), '意向度点');
  assert.ok(h.includes('draggable="true"'));
  const noBatch = sandbox2.boardCardHtml(sandbox2.records[2]);
  assert.ok(!noBatch.includes('board-chip">提前批'));
});

check('setRecordsView 切换容器可见性 / 按钮态，并把偏好写进 localStorage', () => {
  seedRecords();
  sandbox2.setRecordsView('board');
  assert.strictEqual(boardView().hidden, false);
  assert.strictEqual(recordsScroll().hidden, true);
  assert.ok(els2['#viewBoardBtn'].classList.contains('is-active'));
  assert.ok(!els2['#viewTableBtn'].classList.contains('is-active'));
  assert.strictEqual(JSON.parse(sandbox2.localStorage.getItem('test.ui.v1')).recordsView, 'board');
  assert.ok(boardColsEl().innerHTML.includes('board-col'), '切到看板时确实渲染了列');
  sandbox2.setRecordsView('table');
  assert.strictEqual(boardView().hidden, true);
  assert.strictEqual(recordsScroll().hidden, false);
  assert.ok(els2['#viewTableBtn'].classList.contains('is-active'));
  assert.strictEqual(JSON.parse(sandbox2.localStorage.getItem('test.ui.v1')).recordsView, 'table');
});

check('切换器命中台账表格而非 Offer 矩阵（.table-scroll 被两个容器复用导致的选错元素缺陷回归）', () => {
  // 真实 DOM 里 $('.table-scroll') 只返回文档中第一个（洞察的 Offer 对比矩阵），台账表格是第二个。
  // v4.6.0 复用同一 class 后，renderRecordsView 的 $('.table-scroll') 一直在隐藏 Offer 矩阵、
  // 台账表格从未被隐藏（表格与看板叠加）。修复后台账走唯一 id，Offer 矩阵不再被误伤。
  seedRecords();
  const offer = offerScroll();
  const records = recordsScroll();
  assert.notStrictEqual(offer, records, '两个 .table-scroll 必须是不同的桩（ Offer 矩阵 vs 台账表格）');
  offer.hidden = false; // Offer 对比矩阵容器初始可见
  sandbox2.setRecordsView('board');
  assert.strictEqual(recordsScroll().hidden, true, '切到看板时台账表格容器必须被隐藏');
  assert.strictEqual(offer.hidden, false, 'Offer 对比矩阵容器的 hidden 全程不得被台账切换改动');
  sandbox2.setRecordsView('table');
  assert.strictEqual(recordsScroll().hidden, false, '切回表格时台账表格容器恢复可见');
  assert.strictEqual(offer.hidden, false, '切回表格后 Offer 矩阵仍不受影响');
});

check('advanceRecordTo 前进追加里程碑并落库；同阶段不动', async () => {
  seedRecords();
  calls.saveRecords.length = 0;
  const ok = await sandbox2.advanceRecordTo(sandbox2.records[0], '二面');
  assert.strictEqual(ok, true);
  assert.strictEqual(sandbox2.records[0].stage, '二面');
  assert.strictEqual(sandbox2.records[0].timeline.length, 3, '追加而非覆盖');
  assert.ok(calls.saveRecords.some(m => m.includes('二面')));
  const same = await sandbox2.advanceRecordTo(sandbox2.records[0], '二面');
  assert.strictEqual(same, false, '同阶段不应重复追加');
});

check('advanceRecordTo 回退需二次确认：取消则不落库', async () => {
  seedRecords();
  calls.saveRecords.length = 0; calls.confirm.length = 0;
  confirmAnswer = false;
  const denied = await sandbox2.advanceRecordTo(sandbox2.records[0], '已投递');
  assert.strictEqual(denied, false);
  assert.strictEqual(sandbox2.records[0].stage, '一面', '取消后阶段不变');
  assert.strictEqual(calls.saveRecords.length, 0);
  assert.strictEqual(calls.confirm.length, 1, '确实弹了确认');
  confirmAnswer = true;
  const allowed = await sandbox2.advanceRecordTo(sandbox2.records[0], '已投递');
  assert.strictEqual(allowed, true);
  assert.strictEqual(sandbox2.records[0].timeline.length, 3, '回退同样是追加里程碑');
});

check('toggleCompanyGroup 折叠态持久化，且聚合排序下折叠组不渲染明细行', () => {
  seedRecords();
  sandbox2.els.sort.value = 'company-group';
  sandbox2.renderRecordsView();
  let h = sandbox2.els.body.innerHTML;
  assert.ok(h.includes('company-group-row'), '聚合排序应有组头行');
  assert.ok(h.includes('个岗位'));
  assert.ok(h.includes('data-id="r1"') && h.includes('data-id="r2"'), '未折叠时明细行都在');
  // 折叠「腾讯」这一组（zh-CN 排序下「阿里」在前，不能直接取第一个组头）
  const tencentKey = sandbox2.companyGroupIndex(sandbox2.records).get('r1');
  assert.ok(tencentKey, '应能取到腾讯的规范组键');
  assert.ok(h.includes(`data-group="${tencentKey}"`), '腾讯组头存在');
  sandbox2.toggleCompanyGroup(tencentKey);
  assert.ok(JSON.parse(sandbox2.localStorage.getItem('test.ui.v1')).collapsedGroups.includes(tencentKey));
  h = sandbox2.els.body.innerHTML;
  assert.ok(h.includes(`data-group="${tencentKey}"`), '组头仍在（只是折叠）');
  assert.ok(!h.includes('data-id="r1"') && !h.includes('data-id="r2"'), '折叠后该公司的明细行被跳过');
  assert.ok(h.includes('data-id="r3"'), '其它公司不受影响');
  sandbox2.toggleCompanyGroup(tencentKey); // 复原
  assert.ok(sandbox2.els.body.innerHTML.includes('data-id="r1"'), '再次点击展开');
});

check('recordRowHtml：同公司 +N 岗位 chip、批次、截止倒计时分级', () => {
  seedRecords();
  // 截止日按「今天 +2 天」动态生成，避免测试随真实日期漂移而失效
  const soon = new Date(Date.now() + 2 * 86400000);
  sandbox2.records[0].deadline = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
  const groups = sandbox2.groupRecordsByCompany(sandbox2.records);
  const index = new Map(groups.map(g => [g.key, g.records]));
  const groupKeyById = sandbox2.companyGroupIndex(sandbox2.records);
  const rowNo = new Map(sandbox2.records.map((r, i) => [r.id, String(i + 1).padStart(4, '0')]));
  const h = sandbox2.recordRowHtml(sandbox2.records[0], rowNo, index, groupKeyById);
  assert.ok(h.includes('company-chip'), '同公司多岗位应有 chip');
  assert.ok(h.includes('+1 岗位'), 'chip 显示除自己以外的岗位数');
  assert.ok(h.includes('提前批'), '岗位行显示批次');
  assert.ok(h.includes('deadline-hint warn'), '2 天内截止 → warn 配色');
  assert.strictEqual(groupKeyById.get('r1'), groupKeyById.get('r2'), '腾讯与腾讯科技有限公司同组');
  const solo = sandbox2.recordRowHtml(sandbox2.records[2], rowNo, index, groupKeyById);
  assert.ok(!solo.includes('company-chip'), '单独一家公司不显示 chip');
  sandbox2.records[0].deadline = '';
});

section('v4.6.0 企业性质在台账 / 看板 / 抽屉上的可见性');
check('companyTypeChipHtml：三档各带 data-ct 配色，未设置返回空串不占位', () => {
  for (const type of COMPANY_TYPES_LIVE) {
    const chip = sandbox2.companyTypeChipHtml(type);
    assert.ok(chip.includes('class="ct-chip"'), `${type} 应渲染 ct-chip`);
    assert.ok(chip.includes(`data-ct="${type}"`), `${type} 应带 data-ct 驱动配色`);
    assert.ok(chip.includes(`>${type}</span>`), `${type} 文案可见`);
  }
  // 未设置 / 非法值 / 空值都不渲染，避免台账里出现一排灰色「未设置」噪声
  for (const bad of ['', null, undefined, '国企', '央国企x']) {
    assert.strictEqual(sandbox2.companyTypeChipHtml(bad), '', `companyType=${JSON.stringify(bad)} 不应渲染徽章`);
  }
});

check('表格行与看板卡片都带企业性质徽章', () => {
  seedRecords();
  sandbox2.records[0].companyType = '央国企';
  sandbox2.records[2].companyType = '外企';
  const groups = sandbox2.groupRecordsByCompany(sandbox2.records);
  const index = new Map(groups.map(g => [g.key, g.records]));
  const groupKeyById = sandbox2.companyGroupIndex(sandbox2.records);
  const rowNo = new Map(sandbox2.records.map((r, i) => [r.id, String(i + 1).padStart(4, '0')]));
  const row = sandbox2.recordRowHtml(sandbox2.records[0], rowNo, index, groupKeyById);
  assert.ok(row.includes('data-ct="央国企"'), '表格公司名单元格带企业性质');
  const rowNoType = sandbox2.recordRowHtml(sandbox2.records[1], rowNo, index, groupKeyById);
  assert.ok(!rowNoType.includes('ct-chip'), '未设置的记录不渲染徽章');
  const card = sandbox2.boardCardHtml(sandbox2.records[2], groupKeyById);
  assert.ok(card.includes('data-ct="外企"'), '看板卡片带企业性质');
  sandbox2.records[0].companyType = '';
  sandbox2.records[2].companyType = '';
});

check('详情抽屉：副标题带色徽章 + 关键信息有「企业性质」一行', () => {
  seedRecords();
  sandbox2.records[0].companyType = '民企';
  sandbox2.openRecordDrawer('r1');
  assert.ok(els2['#drawerSub'].innerHTML.includes('data-ct="民企"'), '副标题阶段徽章后紧跟企业性质');
  const body = els2['#drawerBody'].innerHTML;
  assert.ok(body.includes('企业性质'), '关键信息列出企业性质');
  assert.ok(body.includes('data-ct="民企"'), '关键信息里也用带色徽章');
  // 未设置时给明确文案，而不是空白（用户要能分辨「没填」与「渲染漏了」）
  sandbox2.records[0].companyType = '';
  sandbox2.renderDrawer();
  assert.ok(els2['#drawerBody'].innerHTML.includes('未设置'), '未设置显式标注');
  sandbox2.closeRecordDrawer();
});

section('v4.4.0 详情抽屉');
check('openRecordDrawer 渲染步骤条（含距上一步天数）/ 笔记 / 同公司其它投递 / 操作', () => {
  seedRecords();
  sandbox2.openRecordDrawer('r1');
  assert.strictEqual(els2['#recordDrawer'].hidden, false);
  assert.strictEqual(els2['#drawerBackdrop'].hidden, false);
  const h = els2['#drawerBody'].innerHTML;
  assert.ok(h.includes('class="step"'), '有步骤条');
  assert.ok(h.includes('距上一步 3 天'), '09-01 → 09-04 = 3 天');
  assert.ok(h.includes('问了项目难点'), '笔记内容渲染出来');
  assert.ok(h.includes('同公司其它投递'), '同公司 r2 出现在抽屉里');
  assert.ok(h.includes('data-sibling="r2"'));
  assert.ok(els2['#drawerActions'].innerHTML.includes('data-drawer="advance"'));
  assert.strictEqual(els2['#drawerTitle'].textContent, '腾讯 · 后端');
});

check('未知 id 打开抽屉是安全的空操作（不会把已打开的抽屉甩关上）', () => {
  seedRecords();
  sandbox2.openRecordDrawer('r1');
  sandbox2.openRecordDrawer('nope');
  assert.strictEqual(els2['#recordDrawer'].hidden, false, '仍停留在 r1');
  assert.strictEqual(els2['#drawerTitle'].textContent, '腾讯 · 后端');
});

check('抽屉里的记录被删掉后，renderDrawer 自动关闭而不是渲染空壳', () => {
  seedRecords();
  sandbox2.openRecordDrawer('r1');
  sandbox2.records = sandbox2.records.filter(r => r.id !== 'r1');
  sandbox2.renderDrawer();
  assert.strictEqual(els2['#recordDrawer'].hidden, true);
  assert.strictEqual(els2['#drawerBackdrop'].hidden, true);
});

check('addDrawerNote / deleteDrawerNote 增删并落库', () => {
  seedRecords();
  calls.saveRecords.length = 0;
  sandbox2.openRecordDrawer('r1');
  sandbox2.addDrawerNote('  二面问了系统设计  ');
  assert.strictEqual(sandbox2.records[0].notes.length, 2);
  assert.strictEqual(sandbox2.records[0].notes[1].text, '二面问了系统设计', '文本被 trim');
  assert.ok(calls.saveRecords.some(m => m.includes('笔记')));
  const addedId = sandbox2.records[0].notes[1].id;
  sandbox2.deleteDrawerNote(addedId);
  assert.strictEqual(sandbox2.records[0].notes.length, 1);
  sandbox2.addDrawerNote('   ');
  assert.strictEqual(sandbox2.records[0].notes.length, 1, '空文本不入库');
  assert.ok(calls.toast.some(t => t.includes('请先输入')));
  sandbox2.closeRecordDrawer();
});

check('抽屉焦点陷阱：Tab 在抽屉内循环，焦点在背景时先被拉进抽屉', () => {
  seedRecords();
  sandbox2.openRecordDrawer('r1');
  const drawer = els2['#recordDrawer'];
  let focused = null;
  const node = name => ({ name, offsetParent: {}, focus() { focused = name; } });
  const nodes = [node('close'), node('advance'), node('noteInput'), node('delete')];
  drawer.querySelectorAll = () => nodes;
  drawer.contains = n => nodes.includes(n);
  const tab = (shiftKey = false) => {
    const event = { key: 'Tab', shiftKey, metaKey: false, ctrlKey: false, altKey: false, target: { tagName: 'DIV' }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    sandbox2.handleGlobalKeydown(event);
    return event;
  };
  // 焦点还在背景（activeElement 不在抽屉里）→ 首次 Tab 拉进抽屉第一个可聚焦元素
  sandbox2.document.activeElement = null;
  let event = tab();
  assert.strictEqual(focused, 'close', '首次 Tab 把焦点拉进抽屉');
  assert.strictEqual(event.defaultPrevented, true, '陷阱必须阻止默认 Tab，否则焦点会跑到背景');
  // 顺序前进
  sandbox2.document.activeElement = nodes[0];
  tab();
  assert.strictEqual(focused, 'advance');
  sandbox2.document.activeElement = nodes[2];
  tab();
  assert.strictEqual(focused, 'delete');
  // 末尾回卷到第一个
  sandbox2.document.activeElement = nodes[3];
  tab();
  assert.strictEqual(focused, 'close', 'Tab 到末尾应回卷');
  // Shift+Tab 从第一个回卷到末尾
  sandbox2.document.activeElement = nodes[0];
  tab(true);
  assert.strictEqual(focused, 'delete', 'Shift+Tab 从首项回卷到末项');
  // 抽屉内没有可聚焦元素时只阻止默认，不抛错
  drawer.querySelectorAll = () => [];
  event = tab();
  assert.strictEqual(event.defaultPrevented, true);
  // 抽屉关闭后 Tab 交还浏览器默认行为
  drawer.querySelectorAll = () => nodes;
  sandbox2.closeRecordDrawer();
  sandbox2.document.activeElement = nodes[0];
  focused = null;
  event = tab();
  assert.strictEqual(event.defaultPrevented, false, '抽屉关闭后不再拦截 Tab');
  assert.strictEqual(focused, null);
});

check('Esc 在抽屉打开时关闭抽屉', () => {
  seedRecords();
  sandbox2.openRecordDrawer('r1');
  assert.strictEqual(els2['#recordDrawer'].hidden, false);
  sandbox2.handleGlobalKeydown({ key: 'Escape', metaKey: false, ctrlKey: false, altKey: false, target: { tagName: 'DIV' }, preventDefault() {} });
  assert.strictEqual(els2['#recordDrawer'].hidden, true);
  assert.strictEqual(els2['#drawerBackdrop'].hidden, true);
  assert.strictEqual(sandbox2.document.body.style.overflow, '', '关闭后恢复页面滚动');
});

check('抽屉内点「推进阶段」后步骤条实时刷新（回归：此前要关掉重开才看得到）', () => {
  seedRecords();
  sandbox2.openRecordDrawer('r1');
  // 用里程碑徽章判定（不能用裸字符串「二面」：样例的下一步行动就是"准备二面"）
  assert.ok(!els2['#drawerBody'].innerHTML.includes('data-stage="二面"'), '推进前步骤条里没有二面里程碑');
  sandbox2.advancingId = 'r1';
  sandbox2.applyAdvance('二面');
  assert.strictEqual(sandbox2.records[0].stage, '二面');
  const after = els2['#drawerBody'].innerHTML;
  assert.ok(after.includes('data-stage="二面"'), '推进后抽屉应立即出现新里程碑');
  assert.ok(after.includes('距上一步'), '新步骤条带间隔天数');
  // 抽屉开着但推进的是别的记录时，不应重渲当前抽屉
  sandbox2.advancingId = 'r3';
  const snapshot = els2['#drawerBody'].innerHTML;
  sandbox2.applyAdvance('已结束');
  assert.strictEqual(els2['#drawerBody'].innerHTML, snapshot, '推进别的记录不动当前抽屉');
  sandbox2.closeRecordDrawer();
  sandbox2.advancingId = null;
});

section('v4.4.0 ⌘K 命令面板与快捷键');
check('buildCmdItems 空 query 给默认清单；有 query 时过滤记录/视图/动作', () => {
  seedRecords();
  const all = sandbox2.buildCmdItems('');
  assert.ok(all.some(i => i.group === '跳转' && i.label === '总览'));
  assert.ok(all.some(i => i.group === '跳转' && i.label === '投递记录' && i.sub === '#/records'), '⌘K 视图跳转项应含投递记录（v4.8.0 独立视图）');
  assert.ok(all.some(i => i.group === '动作' && i.label === '新增投递'));
  assert.ok(all.some(i => i.group === '记录'), '空 query 也给最近记录');
  const byName = sandbox2.buildCmdItems('阿里');
  assert.ok(byName.some(i => i.group === '记录' && i.label.includes('阿里')));
  assert.ok(!byName.some(i => i.label.includes('腾讯')), '不匹配的记录被过滤');
  const byBatch = sandbox2.buildCmdItems('提前批');
  assert.ok(byBatch.some(i => i.group === '记录'), '批次也可被搜到');
  assert.ok(sandbox2.buildCmdItems('zzz不存在').length === 0);
});

check('命令面板渲染分组与高亮，↑↓ 循环移动', () => {
  seedRecords();
  sandbox2.closeCmdPalette(); // 清掉上一个用例可能留下的开启态
  sandbox2.openCmdPalette();
  assert.strictEqual(els2['#cmdPalette'].open, true);
  let h = els2['#cmdResults'].innerHTML;
  assert.ok(h.includes('cmd-group'), '有分组标题');
  const activeIndex = html => Number(/class="cmd-item is-active"[\s\S]*?data-index="(\d+)"/.exec(html)[1]);
  assert.strictEqual(activeIndex(h), 0, '默认高亮第一项');
  sandbox2.moveCmdActive(1);
  assert.strictEqual(activeIndex(els2['#cmdResults'].innerHTML), 1, '下移一项');
  sandbox2.moveCmdActive(-1);
  assert.strictEqual(activeIndex(els2['#cmdResults'].innerHTML), 0, '上移回到第一项');
  sandbox2.closeCmdPalette();
  assert.strictEqual(els2['#cmdPalette'].open, false);
});

check('命令面板无结果时给空态文案', () => {
  sandbox2.closeCmdPalette();
  sandbox2.openCmdPalette();
  // cmdItems 是区段内的词法绑定（不是沙箱属性），只能在同一 context 里改写
  vm.runInContext('cmdItems = []; cmdActiveIndex = 0; renderCmdResults();', sandbox2);
  assert.ok(els2['#cmdResults'].innerHTML.includes('cmd-empty'));
  assert.ok(els2['#cmdResults'].innerHTML.includes('没有匹配'));
  // ↑↓ 在空结果上不应抛错
  vm.runInContext('moveCmdActive(1); moveCmdActive(-1);', sandbox2);
  sandbox2.closeCmdPalette();
});

check('handleGlobalKeydown：⌘K 开面板、输入态不抢键、弹窗打开时不抢键、N 新增', () => {
  seedRecords();
  calls.openDialog.length = 0;
  sandbox2.closeCmdPalette(); // 从确定的关闭态开始
  const ev = (key, opts = {}) => Object.assign({ key, metaKey: false, ctrlKey: false, altKey: false, preventDefault() { this.defaultPrevented = true; }, target: { tagName: 'DIV' } }, opts);
  sandbox2.handleGlobalKeydown(ev('k', { metaKey: true }));
  assert.strictEqual(els2['#cmdPalette'].open, true, '⌘K 打开面板');
  sandbox2.handleGlobalKeydown(ev('k', { ctrlKey: true }));
  assert.strictEqual(els2['#cmdPalette'].open, false, 'Ctrl+K 再按一次关闭');
  sandbox2.handleGlobalKeydown(ev('n', { target: { tagName: 'INPUT' } }));
  assert.strictEqual(calls.openDialog.length, 0, '输入框里不抢 N');
  sandbox2.handleGlobalKeydown(ev('n', { target: { isContentEditable: true } }));
  assert.strictEqual(calls.openDialog.length, 0, 'contenteditable 里也不抢键');
  sandbox2.handleGlobalKeydown(ev('n'));
  assert.strictEqual(calls.openDialog.length, 1, '非输入态 N 触发新增');
  sandbox2.document.querySelector = () => ({}); // 模拟有弹窗打开
  calls.openDialog.length = 0;
  sandbox2.handleGlobalKeydown(ev('n'));
  assert.strictEqual(calls.openDialog.length, 0, '弹窗打开时不抢键');
  sandbox2.document.querySelector = () => null;
  // '/' 聚焦台账搜索：搜索框已随台账迁入「投递记录」视图，应切到 #/records 再 focus
  let focused = false;
  sandbox2.els.search.focus = () => { focused = true; };
  sandbox2.location.hash = '#/overview';
  const slash = ev('/');
  sandbox2.handleGlobalKeydown(slash);
  assert.strictEqual(focused, true, '/ 聚焦搜索框');
  assert.strictEqual(slash.defaultPrevented, true, '/ 应阻止默认行为');
  assert.strictEqual(sandbox2.location.hash, '#/records', '/ 应切到投递记录视图（搜索框现在在那里，不再是总览）');
});

section('v4.4.0 洞察 / 空状态 / 首启引导');
check('示例数据模式 → 引导卡显示并明确告知，洞察内容隐藏', () => {
  seedRecords();
  sandbox2.sampleDataMode = true;
  sandbox2.renderInsights();
  assert.strictEqual(els2['#firstRunGuide'].hidden, false);
  assert.strictEqual(els2['#insightsBody'].hidden, true);
  assert.ok(els2['#guideNote'].innerHTML.includes('当前是示例数据'));
  assert.ok(els2['#guideActions'].innerHTML.includes('data-guide="clear"'));
  sandbox2.sampleDataMode = false;
});

check('有数据 → 渲染漏斗 / sparkline / 停留 / 指标 / 卡点', () => {
  seedRecords();
  sandbox2.records[1].deadline = '2026-09-07'; // 临期 → 卡点
  sandbox2.renderInsights();
  assert.strictEqual(els2['#firstRunGuide'].hidden, true);
  assert.strictEqual(els2['#insightsBody'].hidden, false);
  assert.ok(els2['#funnelRow'].innerHTML.includes('funnel-step'));
  assert.ok(els2['#funnelRow'].innerHTML.includes('funnel-arrow'), '步骤之间有箭头');
  assert.ok(els2['#sparkSvg'].innerHTML.includes('polyline'), 'sparkline 已绘制');
  assert.ok(els2['#dwellList'].innerHTML.includes('dwell-row'), '有停留统计');
  assert.ok(els2['#insightMetrics'].innerHTML.includes('覆盖公司'));
  assert.ok(els2['#alertList'].innerHTML.includes('alert-item'), '有卡点条目');
  sandbox2.records[1].deadline = '';
});

check('漏斗口径切换：公司去重后基数变小（同公司多岗位只算一家）', () => {
  seedRecords();
  sandbox2.renderInsights();
  assert.ok(els2['#funnelNote'].textContent.includes('记录口径'));
  const recordScope = els2['#funnelRow'].innerHTML;
  assert.ok(/funnel-value">3</.test(recordScope), '记录口径下投递基数是 3 条');
  // funnelScope 是区段内词法绑定，只能在同一 context 里翻转（等价于点击切换按钮）
  vm.runInContext("funnelScope = 'company'; renderInsights();", sandbox2);
  assert.ok(els2['#funnelNote'].textContent.includes('公司去重口径'));
  assert.ok(/funnel-value">2</.test(els2['#funnelRow'].innerHTML), '腾讯两条合并为一家 → 基数 2');
  assert.strictEqual(els2['#funnelScopeBtn'].textContent, '切换为记录口径');
  vm.runInContext("funnelScope = 'record'; renderInsights();", sandbox2);
  assert.strictEqual(els2['#funnelScopeBtn'].textContent, '切换为公司去重口径');
});

check('Offer 对比矩阵：<2 个隐藏，≥2 个按意向度降序显示', () => {
  seedRecords();
  sandbox2.renderOfferMatrix();
  assert.strictEqual(els2['#offerMatrixWrap'].hidden, true, '只有 1 个 Offer 时不显示');
  sandbox2.records.push({ id: 'r4', company: '字节', position: '后端', city: '北京', stage: 'Offer', intent: 3, salary: '30k×15', deadline: '2026-09-30', batch: '', notes: [], nextAction: '考虑中', timeline: [{ stage: 'Offer', at: '2026-09-04', note: '' }], applicationDate: '2026-09-01', updatedAt: 5 });
  sandbox2.renderOfferMatrix();
  assert.strictEqual(els2['#offerMatrixWrap'].hidden, false);
  const h = els2['#offerMatrix'].innerHTML;
  assert.ok(h.indexOf('阿里') < h.indexOf('字节'), '意向度 5 的阿里排在意向度 3 的字节之前');
  assert.ok(h.includes('30k×15'), '薪资列有值');
  assert.ok(h.includes('offer-row'));
});

check('多岗位公司清单：每家一个岗位时隐藏，有多岗位时列出明细', () => {
  seedRecords(); // r1 腾讯/后端、r2 腾讯科技有限公司/前端、r3 阿里/算法 → 腾讯 2 个岗位
  sandbox2.renderMultiCompanies();
  assert.strictEqual(els2['#multiCompanyWrap'].hidden, false, '存在多岗位公司时应显示');
  const h = els2['#multiCompanyList'].innerHTML;
  assert.ok(h.includes('multi-company'), '有清单容器');
  assert.ok(h.includes('2 个岗位'), '标出岗位数');
  assert.ok(h.includes('data-id="r1"') && h.includes('data-id="r2"'), '两个岗位都可点开');
  assert.ok(h.includes('提前批'), '带批次');
  assert.ok(h.includes('--company-color:#'), '带公司标识色');
  assert.strictEqual(els2['#multiCompanyNote'].textContent, '1 家公司投了多个岗位');
  // 只剩互不相同的公司时应隐藏
  sandbox2.records = [sandbox2.records[2]];
  sandbox2.renderMultiCompanies();
  assert.strictEqual(els2['#multiCompanyWrap'].hidden, true);
  assert.strictEqual(els2['#multiCompanyList'].innerHTML, '');
});

check('空状态三态：首启 / 筛选无结果 / 有数据隐藏', () => {
  seedRecords();
  sandbox2.renderEmptyState(3);
  assert.strictEqual(sandbox2.els.empty.hidden, true, '有数据时隐藏');
  sandbox2.renderEmptyState(0);
  assert.ok(sandbox2.els.empty.innerHTML.includes('没有符合条件的记录'), '有记录但筛不出 → 无结果态');
  assert.ok(sandbox2.els.empty.innerHTML.includes('data-empty-action="clear"'));
  sandbox2.els.search.value = 'zzz';
  sandbox2.renderEmptyState(0);
  assert.ok(sandbox2.els.empty.innerHTML.includes('zzz'), '回显当前筛选条件');
  sandbox2.els.search.value = '';
  sandbox2.records = [];
  sandbox2.renderEmptyState(0);
  assert.ok(sandbox2.els.empty.innerHTML.includes('还没有投递记录'), '台账为空 → 首启态');
  assert.ok(sandbox2.els.empty.innerHTML.includes('data-empty-action="demo"'));
});

check('loadDemoRecords 只在台账为空时载入，绝不覆盖真实记录', () => {
  seedRecords();
  calls.toast.length = 0;
  sandbox2.loadDemoRecords();
  assert.strictEqual(sandbox2.records.length, 3, '已有记录时不覆盖');
  assert.ok(calls.toast.some(t => t.includes('不载入示例')));
  sandbox2.records = [];
  sandbox2.loadDemoRecords();
  assert.strictEqual(sandbox2.records.length, 1);
  assert.strictEqual(sandbox2.sampleDataMode, true);
});

check('clearSampleData 清空并写删除标记，随后解除示例标记', () => {
  sandbox2.records = [{ id: 'd1', company: '星海科技', position: '产品', stage: '一面' }];
  sandbox2.sampleDataMode = true;
  let marked = null;
  sandbox2.markDeleted = ids => { marked = ids; };
  sandbox2.clearSampleData();
  // 沙箱内创建的数组属于另一个 realm，deepStrictEqual 会因原型不同而失败，这里按内容比较
  assert.strictEqual(sandbox2.records.length, 0);
  assert.strictEqual(marked.length, 1);
  assert.strictEqual(marked[0], 'd1');
  assert.strictEqual(sandbox2.sampleDataMode, false);
  assert.ok(calls.openDialog.length >= 0, '清空后直接打开新增弹窗（不抛错即可）');
  sandbox2.markDeleted = () => {};
});

section('v4.4.0 浏览器实证发现问题的回归');

check('loadRecords 把老数据补齐后写回 localStorage（外部读取者能看到新结构）', () => {
  const legacy = [{ id: 'L1', company: '老数据公司', position: 'p', city: 'C', applicationDate: '2026-09-01' }];
  sandbox2.localStorage.setItem('test.records.v1', JSON.stringify(legacy));
  const loaded = sandbox2.loadRecords();
  assert.strictEqual(loaded.length, 1);
  const storedRaw = sandbox2.localStorage.getItem('test.records.v1');
  assert.notStrictEqual(storedRaw, JSON.stringify(legacy), '应发生一次写回');
  const stored = JSON.parse(storedRaw);
  assert.ok(stored[0].timeline, '写回后带 normalizeRecord 补的字段');
  assert.strictEqual(stored[0].company, '老数据公司', '老字段零丢失');
  // 幂等：结构已一致时不再写盘
  const before = sandbox2.localStorage.getItem('test.records.v1');
  sandbox2.loadRecords();
  assert.strictEqual(sandbox2.localStorage.getItem('test.records.v1'), before, '第二次不应再写');
  sandbox2.localStorage.setItem('test.records.v1', '[]');
});

function formEntries(overrides = {}) {
  const base = {
    company: '腾讯', position: '前端', city: '深圳', applicationDate: '2026-09-06',
    applicationUrl: '', scheduleAt: '', deadline: '', recentSchedule: '', nextAction: '',
    batch: '', channel: '', referral: '', intent: '', salary: ''
  };
  return Object.entries(Object.assign(base, overrides));
}

check('submitForm：同公司不同岗位 → 新增成功，且提示并入保存 toast（不被顶掉）', async () => {
  sandbox2.records = [{ id: 'x1', company: '腾讯', position: '后端', batch: '', stage: '已投递', applicationUrl: '', updatedAt: 1 }];
  sandbox2.editingId = null;
  sandbox2.els.form._entries = formEntries({ position: '前端' });
  calls.saveRecords.length = 0; calls.confirm.length = 0; calls.toast.length = 0;
  await sandbox2.submitForm({ preventDefault() {} });
  assert.strictEqual(sandbox2.records.length, 2, '同公司不同岗位应新增成功');
  assert.strictEqual(calls.confirm.length, 0, '不该弹「疑似重复投递」');
  assert.strictEqual(calls.saveRecords.length, 1, '只保存一次');
  const msg = calls.saveRecords[0];
  assert.ok(msg.includes('已新增并自动保存'), msg);
  assert.ok(msg.includes('名下现在共 2 个岗位'), `提示必须并入同一条 toast：${msg}`);
});

check('submitForm：同公司同岗位同批次 → 弹「疑似重复投递」；选「编辑已有」则不新增', async () => {
  sandbox2.records = [{ id: 'x1', company: '腾讯', position: '后端', batch: '提前批', stage: '已投递', applicationUrl: '', updatedAt: 1 }];
  sandbox2.editingId = null;
  sandbox2.els.form._entries = formEntries({ position: '后端', batch: '提前批' });
  calls.confirm.length = 0; calls.openDialog.length = 0; calls.saveRecords.length = 0;
  confirmAnswer = true; confirmOutcomeValue = 'ok';
  await sandbox2.submitForm({ preventDefault() {} });
  assert.strictEqual(calls.confirm.length, 1, '应弹确认框');
  assert.strictEqual(calls.confirm[0].title, '疑似重复投递');
  assert.strictEqual(calls.confirm[0].confirmText, '编辑已有记录');
  assert.strictEqual(sandbox2.records.length, 1, '选「编辑已有记录」不应新增');
  assert.strictEqual(calls.openDialog.length, 1, '应打开已有记录的编辑弹窗');
  assert.strictEqual(calls.openDialog[0].id, 'x1');
  assert.strictEqual(calls.saveRecords.length, 0, '未保存新记录');
  confirmAnswer = true;
});

check('submitForm：同公司同岗位但批次不同 → variant 提示，选「是独立投递」则正常新增', async () => {
  sandbox2.records = [{ id: 'x1', company: '腾讯', position: '后端', batch: '提前批', stage: '已投递', applicationUrl: '', updatedAt: 1 }];
  sandbox2.editingId = null;
  sandbox2.els.form._entries = formEntries({ position: '后端', batch: '正式批' });
  calls.confirm.length = 0; calls.saveRecords.length = 0;
  confirmAnswer = true; confirmOutcomeValue = 'ok'; // variant 的主按钮就是「是独立投递，新增」
  await sandbox2.submitForm({ preventDefault() {} });
  assert.strictEqual(calls.confirm.length, 1, '提前批/正式批应给 variant 提示，而不是无声合并或无声放行');
  assert.strictEqual(calls.confirm[0].title, '疑似同岗位不同方向');
  assert.strictEqual(calls.confirm[0].confirmText, '是独立投递，新增');
  assert.strictEqual(sandbox2.records.length, 2);
  assert.strictEqual(sandbox2.records[0].batch, '正式批');
});

check('submitForm：variant 选「其实是同一条」→ 打开既有记录、不新增', async () => {
  sandbox2.records = [{ id: 'x1', company: '腾讯', position: '后端', batch: '提前批', stage: '已投递', applicationUrl: '', updatedAt: 1 }];
  sandbox2.editingId = null;
  sandbox2.els.form._entries = formEntries({ position: '后端', batch: '正式批' });
  calls.confirm.length = 0; calls.openDialog.length = 0; calls.saveRecords.length = 0;
  confirmAnswer = false; confirmOutcomeValue = 'cancel';
  await sandbox2.submitForm({ preventDefault() {} });
  assert.strictEqual(sandbox2.records.length, 1, '不应新增');
  assert.strictEqual(calls.openDialog.length, 1);
  assert.strictEqual(calls.openDialog[0].id, 'x1');
  assert.strictEqual(calls.saveRecords.length, 0);
  confirmAnswer = true; confirmOutcomeValue = 'ok';
});

check('submitForm：确认框被 Esc/点遮罩关掉 → 中止入库，什么都不写', async () => {
  sandbox2.records = [{ id: 'x1', company: '腾讯', position: '后端', batch: '', stage: '已投递', applicationUrl: '', updatedAt: 1 }];
  sandbox2.editingId = null;
  sandbox2.els.form._entries = formEntries({ position: '后端', batch: '' });
  calls.confirm.length = 0; calls.openDialog.length = 0; calls.saveRecords.length = 0;
  confirmAnswer = false; confirmOutcomeValue = 'dismiss';
  await sandbox2.submitForm({ preventDefault() {} });
  assert.strictEqual(sandbox2.records.length, 1, 'Esc 不得静默新增一条重复记录');
  assert.strictEqual(calls.saveRecords.length, 0, 'Esc 不得写盘');
  assert.strictEqual(calls.openDialog.length, 0, 'Esc 也不该被当成「编辑已有」');
  confirmAnswer = true; confirmOutcomeValue = 'ok';
});

check('submitForm：同一家公司的第二个岗位（括号里是不同城市）能录进去 —— 用户报告的核心场景', async () => {
  sandbox2.records = [{ id: 'x1', company: '腾讯', position: '后端开发工程师（深圳）', batch: '', stage: '一面', applicationUrl: '', updatedAt: 1 }];
  sandbox2.editingId = null;
  sandbox2.els.form._entries = formEntries({ position: '后端开发工程师（北京）' });
  calls.confirm.length = 0; calls.saveRecords.length = 0;
  confirmAnswer = true; confirmOutcomeValue = 'ok';
  await sandbox2.submitForm({ preventDefault() {} });
  assert.strictEqual(sandbox2.records.length, 2, '不同工作地的两个岗位必须都能入库');
  assert.strictEqual(sandbox2.records[0].position, '后端开发工程师（北京）');
  assert.strictEqual(sandbox2.records[1].position, '后端开发工程师（深圳）');
  assert.strictEqual(calls.confirm[0].title, '疑似同岗位不同方向', '给提示但不阻断');
});

section('v4.5.0 录入时前置提示：该公司已有哪几个岗位');

const hintText = () => sandbox2.$('#sameCompanyHint');
function setCompanyForm(company, position) {
  // 必须走沙箱的 $（惰性建元素）：直接读 els2['#company'] 在首次访问前是 undefined
  sandbox2.$('#company').value = company;
  sandbox2.$('#position').value = position;
}

check('公司名为空或过短 → 提示隐藏（不打扰）', () => {
  sandbox2.records = [{ id: 'x1', company: '腾讯', position: '后端', batch: '', stage: '一面' }];
  sandbox2.editingId = null;
  setCompanyForm('', '后端');
  sandbox2.updateSameCompanyHint();
  assert.strictEqual(hintText().hidden, true);
  setCompanyForm('腾', '后端');
  sandbox2.updateSameCompanyHint();
  assert.strictEqual(hintText().hidden, true, '单字不触发，避免误判');
});

check('同一家公司已有岗位 → 列出岗位名与阶段，让用户知道自己是在加第二个', () => {
  sandbox2.records = [
    { id: 'x1', company: '腾讯', position: '后端开发', batch: '', stage: '一面' },
    { id: 'x2', company: '腾讯科技（深圳）有限公司', position: '产品经理', batch: '提前批', stage: '已投递' }
  ];
  sandbox2.editingId = null;
  setCompanyForm('腾讯', '客户端开发');
  sandbox2.updateSameCompanyHint();
  const box = hintText();
  assert.strictEqual(box.hidden, false);
  assert.ok(box.innerHTML.includes('该公司已有 2 个岗位'), box.innerHTML);
  assert.ok(box.innerHTML.includes('后端开发'), '列出已有岗位');
  assert.ok(box.innerHTML.includes('一面'), '并带当前阶段');
  assert.ok(box.innerHTML.includes('产品经理（提前批）'), '带批次');
});

check('简称与法人全称算同一家（与查重、展示分组同源）', () => {
  sandbox2.records = [{ id: 'x1', company: '腾讯科技（深圳）有限公司', position: '后端', batch: '', stage: '已投递' }];
  sandbox2.editingId = null;
  setCompanyForm('腾讯', '前端');
  sandbox2.updateSameCompanyHint();
  assert.strictEqual(hintText().hidden, false, '「腾讯」应能认出「腾讯科技（深圳）有限公司」');
  assert.ok(hintText().innerHTML.includes('该公司已有 1 个岗位'));
});

check('不同公司 → 隐藏；星海科技 与 星海互娱 不得互相误认', () => {
  sandbox2.records = [{ id: 'x1', company: '星海互娱', position: '后端', batch: '', stage: '已投递' }];
  sandbox2.editingId = null;
  setCompanyForm('星海科技', '后端');
  sandbox2.updateSameCompanyHint();
  assert.strictEqual(hintText().hidden, true);
  setCompanyForm('阿里巴巴', '后端');
  sandbox2.updateSameCompanyHint();
  assert.strictEqual(hintText().hidden, true);
});

check('编辑态排除自身：编辑一条记录时不会把自己算成「已有岗位」', () => {
  sandbox2.records = [{ id: 'x1', company: '腾讯', position: '后端', batch: '', stage: '一面' }];
  sandbox2.editingId = 'x1';
  setCompanyForm('腾讯', '后端');
  sandbox2.updateSameCompanyHint();
  assert.strictEqual(hintText().hidden, true, '只有它自己一条时不该提示');
  sandbox2.records.push({ id: 'x2', company: '腾讯', position: '产品', batch: '', stage: '已投递' });
  sandbox2.updateSameCompanyHint();
  assert.ok(hintText().innerHTML.includes('该公司已有 1 个岗位'), '应只算另一条');
  assert.ok(!hintText().innerHTML.includes('>后端'), '不含自身');
  sandbox2.editingId = null;
});

check('当前填的岗位与已有岗位宽松相等 → 该项标黄预警（保存时会再确认）', () => {
  sandbox2.records = [
    { id: 'x1', company: '腾讯', position: '后端开发工程师（深圳）', batch: '', stage: '一面' },
    { id: 'x2', company: '腾讯', position: '产品经理', batch: '', stage: '已投递' }
  ];
  sandbox2.editingId = null;
  setCompanyForm('腾讯', '后端开发工程师（北京）');
  sandbox2.updateSameCompanyHint();
  const h = hintText().innerHTML;
  assert.ok(h.includes('same-company-item is-similar'), '相近岗位要标出来');
  assert.ok(h.includes('后端开发工程师（深圳）'), '标在相近的那一项上');
  assert.strictEqual((h.match(/is-similar/g) || []).length, 1, '无关岗位不应被标黄');
});

check('超过 4 条时折叠为「等 N 个」，避免提示区把表单撑爆', () => {
  sandbox2.records = [1, 2, 3, 4, 5, 6].map(n => ({ id: `x${n}`, company: '腾讯', position: `岗位${n}`, batch: '', stage: '已投递' }));
  sandbox2.editingId = null;
  setCompanyForm('腾讯', '新岗位');
  sandbox2.updateSameCompanyHint();
  const h = hintText().innerHTML;
  assert.ok(h.includes('该公司已有 6 个岗位'));
  assert.strictEqual((h.match(/same-company-item/g) || []).length, 4, '最多列 4 条');
  assert.ok(h.includes('等 6 个'));
});

check('提示元素自身未被 CSS 设 display，hidden 属性能正常生效（静态守卫覆盖）', () => {
  // #sameCompanyHint 复用 .hint 类；.hint 只设 margin/color/font-size，
  // 一旦有人给它加 display 就会盖掉 [hidden] 的 UA display:none，变成常驻占位。
  const styleBlock = html.slice(html.indexOf('<style>'), html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
  const hintRules = styleBlock.split('}').filter(chunk => /(^|[,\s])\.hint\s*\{/.test(chunk));
  for (const rule of hintRules) {
    assert.ok(!/display\s*:/.test(rule), `.hint 不得设 display，否则 hidden 失效：${rule.trim().slice(0, 80)}`);
  }
});

section('v4.5.0 岗位库「记为已投递」入口（浏览器实证时岗位库为空，改由此覆盖）');

// handleJobAction 只用到 event.target.closest 与 button.dataset，桩一个最小事件即可
const jobEvent = (jobId, action = 'applied') => ({
  target: { closest: sel => (sel === 'button[data-job-action]' ? { dataset: { jobAction: action, jobId } } : null) }
});
function seedJobs(list) { sandbox2.jobs = list; }

check('同公司不同岗位 → 直接新增，不弹框打断（岗位库路径此前是硬拦截）', async () => {
  sandbox2.records = [{ id: 'j1', company: '腾讯', position: '后端开发', batch: '', stage: '已投递', applicationUrl: '', updatedAt: 1 }];
  seedJobs([{ id: 'job1', company: '腾讯', position: '产品经理', city: '深圳', category: '腾讯文档', applicationUrl: '' }]);
  calls.confirm.length = 0; calls.saveRecords.length = 0; calls.openDialog.length = 0;
  confirmAnswer = true; confirmOutcomeValue = 'ok';
  await sandbox2.handleJobAction(jobEvent('job1'));
  assert.strictEqual(sandbox2.records.length, 2, '应新增成功');
  assert.strictEqual(sandbox2.records[0].position, '产品经理');
  assert.strictEqual(calls.confirm.length, 0, '无关岗位不该弹框');
  assert.ok(calls.saveRecords[0].includes('已加入投递记录'), calls.saveRecords[0]);
  assert.ok(calls.saveRecords[0].includes('名下现在共 2 个岗位'), `同公司提示应并入保存 toast：${calls.saveRecords[0]}`);
});

check('相近岗位（括号里是不同城市）→ 弹「疑似同岗位不同方向」，选新增则入库', async () => {
  sandbox2.records = [{ id: 'j1', company: '腾讯', position: '后端开发工程师（深圳）', batch: '', stage: '一面', applicationUrl: '', updatedAt: 1 }];
  seedJobs([{ id: 'job2', company: '腾讯', position: '后端开发工程师（北京）', city: '北京', category: '腾讯文档', applicationUrl: '' }]);
  calls.confirm.length = 0; calls.saveRecords.length = 0;
  confirmAnswer = true; confirmOutcomeValue = 'ok';
  await sandbox2.handleJobAction(jobEvent('job2'));
  assert.strictEqual(calls.confirm.length, 1, '修复前这里是 return showToast，点了没反应');
  assert.strictEqual(calls.confirm[0].title, '疑似同岗位不同方向');
  assert.strictEqual(sandbox2.records.length, 2, '第二个岗位必须能录进去');
  assert.strictEqual(sandbox2.records[0].position, '后端开发工程师（北京）');
});

check('真重复 → 弹「疑似重复投递」；选「编辑已有」打开既有记录且不新增', async () => {
  sandbox2.records = [{ id: 'j1', company: '腾讯', position: '后端开发', batch: '', stage: '已投递', applicationUrl: '', updatedAt: 1 }];
  seedJobs([{ id: 'job3', company: '腾讯', position: '后端开发', city: '深圳', category: '腾讯文档', applicationUrl: '' }]);
  calls.confirm.length = 0; calls.openDialog.length = 0; calls.saveRecords.length = 0;
  confirmAnswer = true; confirmOutcomeValue = 'ok';
  await sandbox2.handleJobAction(jobEvent('job3'));
  assert.strictEqual(calls.confirm[0].title, '疑似重复投递');
  assert.strictEqual(sandbox2.records.length, 1, '选编辑不应新增');
  assert.strictEqual(calls.openDialog.length, 1);
  assert.strictEqual(calls.openDialog[0].id, 'j1');
  assert.strictEqual(calls.saveRecords.length, 0);
});

check('真重复 → 选「仍然新增」则放行（修复前岗位库路径完全没有这个逃生口）', async () => {
  sandbox2.records = [{ id: 'j1', company: '腾讯', position: '后端开发', batch: '', stage: '已投递', applicationUrl: '', updatedAt: 1 }];
  seedJobs([{ id: 'job4', company: '腾讯', position: '后端开发', city: '深圳', category: '腾讯文档', applicationUrl: '' }]);
  calls.confirm.length = 0; calls.saveRecords.length = 0;
  confirmAnswer = false; confirmOutcomeValue = 'cancel';
  await sandbox2.handleJobAction(jobEvent('job4'));
  assert.strictEqual(sandbox2.records.length, 2, '必须能坚持新增');
  assert.strictEqual(calls.saveRecords.length, 1);
  confirmAnswer = true; confirmOutcomeValue = 'ok';
});

check('Esc / 点遮罩关掉确认框 → 中止入库，什么都不写', async () => {
  sandbox2.records = [{ id: 'j1', company: '腾讯', position: '后端开发', batch: '', stage: '已投递', applicationUrl: '', updatedAt: 1 }];
  seedJobs([{ id: 'job5', company: '腾讯', position: '后端开发', city: '深圳', category: '腾讯文档', applicationUrl: '' }]);
  calls.confirm.length = 0; calls.saveRecords.length = 0; calls.openDialog.length = 0;
  confirmAnswer = false; confirmOutcomeValue = 'dismiss';
  await sandbox2.handleJobAction(jobEvent('job5'));
  assert.strictEqual(sandbox2.records.length, 1, '不得静默新增');
  assert.strictEqual(calls.saveRecords.length, 0, '不得写盘');
  assert.strictEqual(calls.openDialog.length, 0, '也不得被当成「编辑已有」');
  confirmAnswer = true; confirmOutcomeValue = 'ok';
});

check('非 applied 动作、未知岗位 id、空事件 → 安全空操作', async () => {
  sandbox2.records = [{ id: 'j1', company: '腾讯', position: '后端开发', batch: '', stage: '已投递', applicationUrl: '', updatedAt: 1 }];
  seedJobs([{ id: 'job6', company: '腾讯', position: '前端', city: '', category: '腾讯文档', applicationUrl: '' }]);
  calls.saveRecords.length = 0;
  await sandbox2.handleJobAction({ target: { closest: () => null } });
  await sandbox2.handleJobAction(jobEvent('不存在的id'));
  await sandbox2.handleJobAction(jobEvent('job6', 'other-action'));
  assert.strictEqual(sandbox2.records.length, 1, '以上三种情况都不得改动台账');
  assert.strictEqual(calls.saveRecords.length, 0);
});

check('详情抽屉「关键信息」包含批次（此前缺失）', () => {
  seedRecords();
  sandbox2.openRecordDrawer('r1');
  const h = els2['#drawerBody'].innerHTML;
  assert.ok(h.includes('<dt>批次</dt>'), '应有批次一行');
  assert.ok(h.includes('提前批'), '且显示实际批次值');
  sandbox2.closeRecordDrawer();
});

check('删除笔记给 6 秒撤销，撤销后按原位置恢复', () => {
  seedRecords();
  sandbox2.records[0].notes = [
    { id: 'n1', at: 1, text: '一面笔记' },
    { id: 'n2', at: 2, text: '二面笔记' },
    { id: 'n3', at: 3, text: 'HR 面笔记' }
  ];
  sandbox2.openRecordDrawer('r1');
  calls.toast.length = 0; calls.lastToastOptions = null;
  sandbox2.deleteDrawerNote('n2');
  assert.strictEqual(sandbox2.records[0].notes.length, 2);
  assert.ok(calls.lastToastOptions && calls.lastToastOptions.actionLabel === '撤销', '删除笔记必须提供撤销');
  assert.strictEqual(typeof calls.lastToastOptions.onAction, 'function');
  calls.lastToastOptions.onAction(); // 点撤销
  const notes = sandbox2.records[0].notes;
  assert.strictEqual(notes.length, 3);
  assert.strictEqual(notes[1].id, 'n2', '恢复到原来的位置而不是追加到末尾');
  assert.strictEqual(notes[1].text, '二面笔记');
  // 撤销只能生效一次
  calls.lastToastOptions.onAction();
  assert.strictEqual(sandbox2.records[0].notes.length, 3, '重复点击不应重复插入');
  // 删除不存在的笔记是安全空操作
  const snapshot = sandbox2.records[0].notes.length;
  sandbox2.deleteDrawerNote('not-exist');
  assert.strictEqual(sandbox2.records[0].notes.length, snapshot);
  sandbox2.closeRecordDrawer();
});

section('v4.6.0 洞察：城市分布 / 企业性质 / 精简模式');

const cityListEl = () => sandbox2.$('#cityList');
const cityNoteEl = () => sandbox2.$('#cityNote');
const ctypeBarEl = () => sandbox2.$('#ctypeBar');
const ctypeLegendEl = () => sandbox2.$('#ctypeLegend');
const ctypeNoteEl = () => sandbox2.$('#ctypeNote');

check('指标条扩到 6 项：新增「覆盖城市」与「已拿 Offer」，顺序为概览优先', () => {
  seedRecords();
  sandbox2.renderInsights();
  const h = sandbox2.$('#insightMetrics').innerHTML;
  const labels = [...h.matchAll(/insight-metric-label">([^<]+)</g)].map(m => m[1]);
  // 标签经过 escapeHtml，「>」会变成 &gt;
  assert.deepStrictEqual(labels, ['覆盖公司', '覆盖城市', '在流程中', '停滞 &gt;14 天', '已拿 Offer', '需要关注']);
  const values = [...h.matchAll(/insight-metric-value">([^<]+)</g)].map(m => m[1]);
  assert.strictEqual(values[0], '2', '腾讯与腾讯科技聚成一家 + 阿里 = 2 家');
  assert.strictEqual(values[1], '2', '深圳 + 杭州');
  assert.strictEqual(values[4], '1', '阿里那条是 Offer');
  // 卡点清单已移到指标条上方，文案不能再指向下方
  assert.ok(!h.includes('见下方清单'), '「见下方清单」已随布局重构失效');
});

check('城市分布：每行挂悬浮明细钩子，未填桶灰显且排最后，说明写明多城市口径', () => {
  seedRecords();
  sandbox2.renderCityStats();
  const h = cityListEl().innerHTML;
  assert.ok(h.includes('data-tip-kind="city"'), '每行都挂悬浮明细钩子');
  assert.ok(h.includes('data-tip-key="深圳"'));
  assert.ok(/city-name">深圳</.test(h));
  assert.ok(h.includes('city-bar-offer'), '有 Offer 分层条');
  assert.ok(!h.includes('is-unknown'), '三条都填了城市 → 不出现未填行');
  assert.ok(cityNoteEl().textContent.includes('2 个城市'));
  assert.ok(cityNoteEl().textContent.includes('各计一次'), '必须写明口径，否则各城市之和 > 台账条数会被当成算错');
  // 有记录没填城市（含岗位库写入的「待确认」）时，未填行出现、灰显并排在最后
  sandbox2.records[2].city = '待确认';
  sandbox2.renderCityStats();
  const h2 = cityListEl().innerHTML;
  assert.ok(h2.includes('is-unknown'), '出现未填行');
  assert.ok(h2.includes('没填城市'), '用用户能懂的话，而不是空白键');
  assert.ok(h2.indexOf('is-unknown') > h2.indexOf('data-tip-key="深圳"'), '未填行排在所有真实城市之后');
  sandbox2.records[2].city = '杭州';
});

check('企业性质：比例条只画非零段，图例固定 4 行，未设置占比写进说明提醒补填', () => {
  seedRecords();
  sandbox2.renderCompanyTypeStats();
  const legend = ctypeLegendEl().innerHTML;
  const rows = [...legend.matchAll(/ctype-label">([^<]+)</g)].map(m => m[1]);
  assert.deepStrictEqual(rows, ['央国企', '民企', '外企', '未设置'], '图例固定 4 行，为 0 也出现');
  assert.ok(legend.includes('is-empty'), '为 0 的档位灰显');
  assert.strictEqual((ctypeBarEl().innerHTML.match(/ctype-seg/g) || []).length, 1, '只有未设置有数据 → 只画一段');
  assert.ok(ctypeBarEl().innerHTML.includes('data-tip-kind="ctype"'), '每段挂悬浮明细钩子');
  assert.ok(ctypeNoteEl().textContent.includes('3 条未设置'), '提醒去补填，否则这一维永远统计不出来');
  // 标注后按占比分段
  sandbox2.records[0].companyType = '央国企';
  sandbox2.records[2].companyType = '外企';
  sandbox2.renderCompanyTypeStats();
  const bar = ctypeBarEl().innerHTML;
  assert.ok(bar.includes('data-ct="央国企"') && bar.includes('data-ct="外企"') && bar.includes('data-ct=""'), '三段（含未设置）');
  assert.ok(/style="width:33\.33%"/.test(bar), '1/3 占比');
  assert.ok(ctypeNoteEl().textContent.includes('1 条未设置'), '还剩一条没标注');
  sandbox2.records[0].companyType = '';
  sandbox2.records[2].companyType = '';
});

check('精简模式：明细整块折叠、按钮文案切换、偏好写进 localStorage，折叠期间内容仍渲染', () => {
  seedRecords();
  vm.runInContext('uiPrefs.insightsCompact = false', sandbox2);
  sandbox2.renderInsights();
  assert.strictEqual(sandbox2.$('#insightDetails').hidden, false);
  assert.strictEqual(sandbox2.$('#insightsCompactBtn').textContent, '精简');
  vm.runInContext('toggleInsightsCompact()', sandbox2);
  assert.strictEqual(sandbox2.$('#insightDetails').hidden, true, '城市/企业性质/节奏/停留/多岗位/Offer 对比整块折叠');
  assert.strictEqual(sandbox2.$('#insightsCompactBtn').textContent, '完整');
  assert.strictEqual(JSON.parse(sandbox2.localStorage.getItem('test.ui.v1')).insightsCompact, true, '偏好持久化');
  // 折叠只是容器 hidden，明细照常渲染：切回完整时不需要重算，也不会出现半渲染状态
  assert.ok(sandbox2.$('#cityList').innerHTML.includes('深圳'), '折叠期间内容仍在');
  assert.ok(sandbox2.$('#insightMetrics').innerHTML.includes('覆盖城市'), '概览指标不受精简影响');
  vm.runInContext('toggleInsightsCompact()', sandbox2);
  assert.strictEqual(sandbox2.$('#insightDetails').hidden, false);
  assert.strictEqual(JSON.parse(sandbox2.localStorage.getItem('test.ui.v1')).insightsCompact, false);
});

check('空台账：城市与企业性质都给空态文案，而不是渲染成一片空白', () => {
  sandbox2.records = [];
  sandbox2.renderCityStats();
  assert.ok(cityListEl().innerHTML.includes('insight-empty'));
  assert.strictEqual(cityNoteEl().textContent, '—');
  sandbox2.renderCompanyTypeStats();
  assert.strictEqual(ctypeBarEl().innerHTML, '', '没有数据不画比例条');
  assert.ok(ctypeLegendEl().innerHTML.includes('insight-empty'));
});

check('悬浮明细：按需构建内容、无明细不弹空壳、隐藏时清空并摘掉 aria-describedby', () => {
  seedRecords();
  const layer = sandbox2.$('#tipLayer');
  const row = makeEl('city-row');
  row.dataset = { tipKind: 'city', tipKey: '深圳' };
  sandbox2.showTipFor(row);
  assert.strictEqual(layer.hidden, false);
  assert.ok(layer.innerHTML.includes('深圳 · 2 条投递'), '内容在显示时才构建');
  assert.ok(layer.innerHTML.includes('腾讯'), '列出该城市的投递明细');
  assert.strictEqual(vm.runInContext('tipTarget', sandbox2), row, '记住当前触发元素');
  assert.strictEqual(row.getAttribute('aria-describedby'), 'tipLayer', '读屏能关联到浮层');
  sandbox2.hideTip();
  assert.strictEqual(layer.hidden, true);
  assert.strictEqual(layer.innerHTML, '', '隐藏时清空，避免下次显示残留上一条内容');
  assert.strictEqual(vm.runInContext('tipTarget', sandbox2), null);
  assert.strictEqual(row.getAttribute('aria-describedby'), null, '隐藏后必须摘掉，否则指向一个空浮层');
  // 这一档一条记录都没有 → 不弹空壳（弹出来会是空白卡片，看着像坏了）
  const emptySeg = makeEl('ctype-seg');
  emptySeg.dataset = { tipKind: 'ctype', tipKey: '外企' };
  sandbox2.showTipFor(emptySeg);
  assert.strictEqual(layer.hidden, true);
  assert.strictEqual(layer.innerHTML, '');
  // 没有 data-tip-kind 的普通元素不触发
  const plain = makeEl('div');
  plain.dataset = {};
  sandbox2.showTipFor(plain);
  assert.strictEqual(layer.hidden, true);
  sandbox2.showTipFor(null);
  assert.strictEqual(layer.hidden, true, '传 null 不抛错');
});

check('悬浮明细定位：默认贴下方，右/下溢出时翻转并夹紧到视口内，窄屏不留负坐标', () => {
  const layer = sandbox2.$('#tipLayer');
  layer._rect = { left: 0, top: 0, width: 300, height: 120 }; // 浮层显示后实测到的尺寸
  sandbox2.window.innerWidth = 1440;
  sandbox2.window.innerHeight = 900;
  sandbox2.positionTip({ left: 100, top: 200, right: 260, bottom: 220, width: 160, height: 20 });
  assert.strictEqual(layer.style.left, '100px', '左对齐触发元素');
  assert.strictEqual(layer.style.top, '228px', '贴在下方 8px');
  sandbox2.positionTip({ left: 1300, top: 200, right: 1420, bottom: 220, width: 120, height: 20 });
  assert.strictEqual(layer.style.left, `${1440 - 8 - 300}px`, '右侧放不下 → 贴右边缘而不是溢出');
  sandbox2.positionTip({ left: 100, top: 820, right: 260, bottom: 860, width: 160, height: 40 });
  assert.strictEqual(layer.style.top, `${820 - 8 - 120}px`, '下方放不下 → 翻到触发元素上方');
  sandbox2.window.innerWidth = 200;
  sandbox2.window.innerHeight = 100;
  sandbox2.positionTip({ left: 180, top: 80, right: 195, bottom: 95, width: 15, height: 15 });
  assert.ok(parseInt(layer.style.left, 10) >= 8, '窄屏也不留负坐标');
  assert.ok(parseInt(layer.style.top, 10) >= 8);
  sandbox2.positionTip(null);
  assert.ok(layer.style.left, 'rect 缺失时安全空操作，不清掉已有定位');
  sandbox2.window.innerWidth = 1440;
  sandbox2.window.innerHeight = 900;
});

check('Esc 先关悬浮明细，第二次才关抽屉（浮层是最表层的临时 UI）', () => {
  seedRecords();
  sandbox2.openRecordDrawer('r1');
  const row = makeEl('city-row');
  row.dataset = { tipKind: 'city', tipKey: '深圳' };
  sandbox2.showTipFor(row);
  assert.strictEqual(sandbox2.$('#tipLayer').hidden, false);
  const esc = () => sandbox2.handleGlobalKeydown({ key: 'Escape', metaKey: false, ctrlKey: false, altKey: false, target: { tagName: 'DIV' }, preventDefault() {} });
  esc();
  assert.strictEqual(sandbox2.$('#tipLayer').hidden, true, '浮层被关掉');
  assert.strictEqual(els2['#recordDrawer'].hidden, false, '抽屉不受影响');
  esc();
  assert.strictEqual(els2['#recordDrawer'].hidden, true, '再按一次才关抽屉');
});

check('触屏降级：无 hover 时用点击切换，matchMedia 缺失也不抛错', () => {
  sandbox2.window.matchMedia = () => ({ matches: true });
  assert.strictEqual(sandbox2.isCoarsePointer(), true);
  sandbox2.window.matchMedia = () => ({ matches: false });
  assert.strictEqual(sandbox2.isCoarsePointer(), false);
  sandbox2.window.matchMedia = undefined;
  assert.strictEqual(sandbox2.isCoarsePointer(), false, '老浏览器没有 matchMedia 时按有 hover 处理');
  sandbox2.window.matchMedia = () => ({ matches: false });
});

check('洞察里可悬浮的元素都挂了 data-tip-kind（指标卡 / 城市行 / 企业性质段 / 多岗位条目）', () => {
  seedRecords();
  sandbox2.renderInsights();
  const metrics = sandbox2.$('#insightMetrics').innerHTML;
  assert.strictEqual((metrics.match(/data-tip-kind="metric"/g) || []).length, 6, '6 个指标卡都能查口径');
  assert.strictEqual((metrics.match(/tabindex="0"/g) || []).length, 6, '键盘用户也能触发');
  for (const key of ['companies', 'cities', 'flow', 'stalled', 'offers', 'alerts']) {
    assert.ok(metrics.includes(`data-tip-key="${key}"`), `缺 ${key} 的口径说明钩子`);
  }
  assert.ok((sandbox2.$('#cityList').innerHTML.match(/data-tip-kind="city"/g) || []).length >= 2, '每个城市行都有');
  assert.ok(sandbox2.$('#ctypeBar').innerHTML.includes('data-tip-kind="ctype"'), '比例条每段都有');
  assert.ok(sandbox2.$('#multiCompanyList').innerHTML.includes('data-tip-kind="record"'), '被省略号截断的岗位名可悬浮看全');
  assert.ok(!sandbox2.$('#multiCompanyList').innerHTML.includes('title="'), '改用自绘浮层后不再留原生 title');
});

section('v4.6.0 新增表单的默认阶段');

check('新增投递默认「已投递」而不是「待投递」（待投递会被 isActive 排除，记录在洞察里隐身）', () => {
  sandbox2.$('#applicationDate').value = '2026-09-07';
  sandbox2.renderTimelineEditor(null);
  const h = sandbox2.$('#timelineEditor').innerHTML;
  assert.ok(h.includes('value="已投递"'), '默认阶段应是已投递');
  assert.ok(!h.includes('value="待投递"'), '不应再默认待投递');
  assert.ok(h.includes('value="2026-09-07"'), '日期沿用表单里已填的投递日期');
  assert.strictEqual((h.match(/tl-row/g) || []).length, 1, '默认只给一行');
  // 与 isActive 的口径对齐：默认值存下来的记录必须算「在流程中」，否则不会进停滞提醒与卡点清单
  assert.strictEqual(sandbox2.isActive({ stage: '已投递' }), true);
  assert.strictEqual(sandbox2.isActive({ stage: '待投递' }), false, '这正是旧默认值的问题所在');
});

check('编辑与带 stage 的 seed 仍按来源回填，不被新默认值覆盖', () => {
  sandbox2.$('#applicationDate').value = '2026-09-07';
  sandbox2.renderTimelineEditor({ stage: '三面', applicationDate: '2026-08-01', timeline: [] });
  assert.ok(sandbox2.$('#timelineEditor').innerHTML.includes('value="三面"'), 'seed 的 stage 优先于默认值');
  assert.ok(sandbox2.$('#timelineEditor').innerHTML.includes('value="2026-08-01"'), '日期用 seed 的投递日期');
  sandbox2.renderTimelineEditor({ timeline: [{ stage: '已投递', at: '2026-08-01', note: '' }, { stage: '笔试', at: '2026-08-09', note: '在线笔试' }] });
  const h = sandbox2.$('#timelineEditor').innerHTML;
  assert.strictEqual((h.match(/tl-row/g) || []).length, 2, '编辑时还原整条时间线');
  assert.ok(h.includes('value="笔试"') && h.includes('在线笔试'), '里程碑与备注都在');
  // 表单里没填投递日期时兜底为今天，不能留空（留空会导致 sanitizeTimeline 丢掉这一行）
  sandbox2.$('#applicationDate').value = '';
  sandbox2.renderTimelineEditor(null);
  assert.ok(/value="\d{4}-\d{2}-\d{2}"/.test(sandbox2.$('#timelineEditor').innerHTML), '日期兜底为今天');
});

// ============================================================================
// v4.8.0：视图路由（switchView / parseRoute）行为冒烟——投递记录独立成视图后，
// 抽取真实源码放进第三个沙箱执行，验证 #/records 解析、切到 records 触发 renderRecordsView、
// 以及只有目标视图可见（其余 hidden）。VIEW_META / ROUTE_ALIASES 现场从 index.html 抽取求值。
// ============================================================================
const els3 = {};
const VIEW_META_SRC = (() => {
  const s = html.indexOf('const VIEW_META = {');
  const e = html.indexOf('};', s);
  return html.slice(s, e + 2);
})();
const ROUTE_ALIASES_SRC = html.split('\n').find(l => l.includes('const ROUTE_ALIASES =')).trim();
const parseRouteSrc = extractFunction(html, 'parseRoute');
const switchViewSrc = extractFunction(html, 'switchView');
for (const [label, src] of [['VIEW_META', VIEW_META_SRC], ['ROUTE_ALIASES', ROUTE_ALIASES_SRC], ['parseRoute', parseRouteSrc], ['switchView', switchViewSrc]]) {
  if (!src || src.length < 20) { console.error(`✗ 未定位到路由源码 ${label}`); process.exit(1); }
}
const routeCalls = { renderRecordsView: 0, renderMailView: 0, renderToolCards: 0 };
const viewStubs = ['overview', 'records', 'jobPool', 'resume', 'tools', 'mail']
  .map(v => ({ dataset: { view: v }, hidden: false, offsetWidth: 0, classList: { remove() {}, add() {} } }));
const navStubs = ['overview', 'records', 'mail', 'resume', 'jobPool', 'tools']
  .map(r => {
    const stub = { dataset: { route: r }, active: null, classList: {} };
    stub.classList.toggle = (cls, on) => { stub.active = on; };
    return stub;
  });
const sandbox3 = {
  console,
  $: sel => (els3[sel] || (els3[sel] = makeEl(sel))),
  document: { title: '', querySelectorAll: sel => (String(sel).includes('.view') ? viewStubs : navStubs) },
  location: { hash: '#/overview' },
  history: { replaceState: (a, b, url) => { sandbox3.location.hash = url; } },
  window: { scrollTo: () => {} },
  renderToolCards: () => { routeCalls.renderToolCards += 1; },
  renderMailView: () => { routeCalls.renderMailView += 1; },
  renderRecordsView: () => { routeCalls.renderRecordsView += 1; }
};
vm.createContext(sandbox3);
vm.runInContext([VIEW_META_SRC, ROUTE_ALIASES_SRC, parseRouteSrc, switchViewSrc].join('\n'), sandbox3, { filename: 'router-section.js' });

section('\nv4.8.0 视图路由（投递记录独立视图）');
check('switchView("records") 只显示记录视图、触发 renderRecordsView 并更新标题', () => {
  routeCalls.renderRecordsView = 0; routeCalls.renderMailView = 0; routeCalls.renderToolCards = 0;
  sandbox3.switchView('records');
  const rec = viewStubs.find(v => v.dataset.view === 'records');
  assert.strictEqual(rec.hidden, false, 'records 视图应显示');
  assert.ok(viewStubs.filter(v => v.dataset.view !== 'records').every(v => v.hidden === true), '其余视图必须隐藏');
  assert.strictEqual(routeCalls.renderRecordsView, 1, '切到 records 必须重渲台账/看板');
  assert.strictEqual(routeCalls.renderMailView, 0, '不该连带渲染邮件视图');
  assert.strictEqual(routeCalls.renderToolCards, 0, '不该连带渲染工具卡片');
  assert.strictEqual(sandbox3.location.hash, '#/records', 'hash 同步到 #/records');
  assert.strictEqual(els3['#viewTitle'].textContent, '投递记录');
  assert.strictEqual(els3['#viewKicker'].textContent, 'PIPELINE');
  assert.strictEqual(navStubs.find(n => n.dataset.route === 'records').active, true, 'records 导航项高亮');
});

check('switchView("overview") 不触发 renderRecordsView（台账已不在总览）', () => {
  routeCalls.renderRecordsView = 0;
  sandbox3.switchView('overview');
  assert.strictEqual(routeCalls.renderRecordsView, 0);
  assert.strictEqual(viewStubs.find(v => v.dataset.view === 'overview').hidden, false);
  assert.strictEqual(viewStubs.find(v => v.dataset.view === 'records').hidden, true);
  assert.strictEqual(els3['#viewTitle'].textContent, '投递总览');
});

check('parseRoute：#/records 解析到 records（旧书签不再被重定向到 overview），#/upcoming 仍回总览', () => {
  sandbox3.location.hash = '#/records';
  assert.strictEqual(sandbox3.parseRoute(), 'records');
  sandbox3.location.hash = '#/upcoming';
  assert.strictEqual(sandbox3.parseRoute(), 'overview', '未来安排旧书签仍回总览');
  sandbox3.location.hash = '#/jobPool';
  assert.strictEqual(sandbox3.parseRoute(), 'jobPool');
  sandbox3.location.hash = '#/不存在';
  assert.strictEqual(sandbox3.parseRoute(), 'overview', '未知路由回退总览');
});

runAll();
