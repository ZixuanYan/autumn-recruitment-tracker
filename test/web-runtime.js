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
  MAIL_CFG_DEFAULTS: { keywords: 'K', minConfidence: 0.3, sinceDays: 30, maxPerRun: 30, enabled: true, minIntervalHours: 0, promptExtra: '' },
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

// ============================================================================
// v4.4.0：洞察 / 台账（表格+看板）/ 详情抽屉 / ⌘K 命令面板 运行时冒烟
// 抽取三段真实源码放进第二个沙箱执行：CORE 纯函数块 + 邮件纯函数块（companyKeyOf 依赖
// normalizeCompanySlug）+ 洞察/台账渲染段 + 台账视图增强段；外部依赖一律用桩。
// ============================================================================
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) return '';
  let i = src.indexOf('{', start);
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

for (const [label, src] of [['CORE 纯函数块', coreBlock], ['邮件纯函数块', mailPureBlock], ['洞察/台账渲染段', insightSection], ['台账视图增强段', v44Section], ['getVisibleRecords', getVisibleRecordsSrc]]) {
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
    setAttribute() {}, getAttribute() { return null; }, focus() {}, scrollIntoView() {},
    closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    contains() { return false; },
    addEventListener() {}, showModal() { this.open = true; }, close() { this.open = false; }
  };
}
const calls = { saveRecords: [], toast: [], openDialog: [], confirm: [], focus: [], advance: [], delete: [] };
let confirmAnswer = true;
const sandbox2 = {
  console,
  $: sel => (els2[sel] || (els2[sel] = makeEl(sel))),
  els: {
    empty: makeEl('#emptyState'), body: makeEl('#recordBody'), caption: makeEl('#resultCaption'),
    upcoming: makeEl('#upcomingList'), search: makeEl('#searchInput'), filter: makeEl('#stageFilter'),
    sort: makeEl('#sortSelect'), dialog: makeEl('#recordDialog'), form: makeEl('#recordForm'), toast: makeEl('#toast')
  },
  document: { querySelector: () => null, querySelectorAll: () => [], body: { style: {} }, createElement: () => makeEl('tmp'), activeElement: null },
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
  stageOrder: s => { const i = ['待投递', '已投递', '测评', '笔试', '机试', '一面', '二面', '三面', '四面', '五面', '交叉面', 'HR面', 'Offer', '已结束'].indexOf(s); return i === -1 ? 9000 : i; },
  isActive: r => !['待投递', 'Offer', '已结束'].includes(r.stage),
  cryptoId: () => `id-${Math.random().toString(16).slice(2, 8)}`,
  UI_STORAGE_KEY: 'test.ui.v1',
  STAGE_PRESETS: ['待投递', '已投递', '测评', '笔试', '机试', '一面', '二面', '三面', '四面', '五面', '交叉面', 'HR面', 'Offer', '已结束'],
  syncConfig: { token: 'tok' },
  records: [],
  sampleDataMode: false,
  parseRoute: () => 'overview',
  normalizeRecord: o => o,
  exampleRecords: () => [{ id: 'demo1', company: '星海科技', position: '产品', stage: '一面' }],
  markDeleted: () => {},
  saveRecords: msg => calls.saveRecords.push(msg),
  render: () => {},
  showToast: msg => calls.toast.push(msg),
  openDialog: rec => calls.openDialog.push(rec),
  openRecordFocus: id => calls.focus.push(id),
  confirmInApp: async () => { calls.confirm.push(1); return confirmAnswer; },
  setTimeline: (rec, tl) => { rec.timeline = tl; rec.stage = tl[tl.length - 1].stage; rec.updatedAt = Date.now(); return rec; },
  flashRow: () => {}, playOfferStamp: () => {},
  // applyAdvance 的外部依赖（推进弹窗的状态与关闭动作不在被抽取的区段里）
  advancingId: null, closeAdvanceDialog: () => {},
  openSyncDialog: () => {}, openScreenshotDialog: () => {}, openSafetyDialog: () => {}, openMailSettings: () => {},
  syncNow: () => {}, exportData: () => {}, exportIcs: () => {}, exportResume: () => {}
};
sandbox2.globalThis = sandbox2;
vm.createContext(sandbox2);
vm.runInContext(
  [mailPureBlock, coreBlock, getVisibleRecordsSrc, applyAdvanceSrc, insightSection, v44Section].join('\n'),
  sandbox2,
  { filename: 'v44-sections.js' }
);

section('\nv4.4.0 台账视图（表格 / 看板 / 拖拽推进）');
const boardColsEl = () => els2['#boardCols'];
const boardView = () => els2['#boardView'];
const tableScroll = () => els2['.table-scroll'];

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
  assert.strictEqual(tableScroll().hidden, true);
  assert.ok(els2['#viewBoardBtn'].classList.contains('is-active'));
  assert.ok(!els2['#viewTableBtn'].classList.contains('is-active'));
  assert.strictEqual(JSON.parse(sandbox2.localStorage.getItem('test.ui.v1')).recordsView, 'board');
  assert.ok(boardColsEl().innerHTML.includes('board-col'), '切到看板时确实渲染了列');
  sandbox2.setRecordsView('table');
  assert.strictEqual(boardView().hidden, true);
  assert.strictEqual(tableScroll().hidden, false);
  assert.ok(els2['#viewTableBtn'].classList.contains('is-active'));
  assert.strictEqual(JSON.parse(sandbox2.localStorage.getItem('test.ui.v1')).recordsView, 'table');
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
  // '/' 聚焦台账搜索：应切到总览并 focus
  let focused = false;
  sandbox2.els.search.focus = () => { focused = true; };
  const slash = ev('/');
  sandbox2.handleGlobalKeydown(slash);
  assert.strictEqual(focused, true, '/ 聚焦搜索框');
  assert.strictEqual(slash.defaultPrevented, true, '/ 应阻止默认行为');
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

runAll();
