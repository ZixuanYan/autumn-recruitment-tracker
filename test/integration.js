'use strict';
// ============================================================================
// test/integration.js — index.js 编排层的真实执行测试（stub 掉 IMAP / mailparser / fetch）
//
// 为什么需要它：index.js 与 src/imap.js 依赖 imapflow、src/parse.js 依赖 mailparser，
// 本地无 node_modules 时既不能 require、也无法被单测覆盖，于是 run.js 的 vm.Script
// 只能做「语法可编译」检查。但 v0.3.0 开发期间 index.js 连续出现两个**只有真实执行
// 才会暴露**的错误，两次都是全绿测试放过、workflow 直接 failure：
//   1) 同一个 for 循环里两个 `const verdict`（重复声明）——node --check 能抓，npm test 抓不到
//   2) `const adjudicated` 声明在 try 块内、却在 finally 之后被 mergeSuggestions 引用
//      ——块级作用域导致运行时 ReferenceError，node --check 与 vm.Script 都抓不到
// 所以这里通过 hook Module._load 注入假依赖，让 index.js 的 main() 真的跑一遍。
//
// 运行：node test/integration.js
// ============================================================================

const assert = require('assert');
const Module = require('module');
const path = require('path');

const INDEX_PATH = path.join(__dirname, '..', 'services', 'mail-sync', 'index.js');

// 跑一次 index.js：注入假 IMAP / 假 mailparser / 假 fetch，返回本次 PATCH 进 Gist 的内容与日志。
// options:
//   mails      假邮件数组 [{ uid, parsed: { from, subject, text, date } }]
//   prevGist   假 Gist 内容 { files: { 'mail-suggestions.json': { content } } }
//   ai         'ok' | 'fail' | fn(mail) => 结果对象；控制 AI 行为
async function runIndexOnce({ mails = [], prevGist = null, ai = 'ok', uidFrom = '' }) {
  const patches = [];      // 每次 PATCH gist 的 body
  const logs = [];         // 收集 console 输出，顺便断言日志内容
  let exitCodeBefore = process.exitCode;

  // ---- 假依赖：IMAP ----
  class FakeImapFlow {
    constructor(opts) { this.opts = opts; this.mailbox = null; }
    async connect() {}
    async getMailboxLock() {
      this.mailbox = { uidValidity: 1763287821, exists: 161 };
      return { release() {} };
    }
    // imapflow 的 fetch 返回异步可迭代对象
    async *fetch() {
      for (const m of mails) {
        yield { uid: m.uid, envelope: {}, internalDate: m.parsed.date, source: { __parsed: m.parsed } };
      }
    }
    async logout() {}
    close() {}
  }

  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'imapflow') return { ImapFlow: FakeImapFlow };
    // src/parse.js 惰性 require('mailparser')；source 上挂了 __parsed 直接返回
    if (request === 'mailparser') {
      return {
        simpleParser: async (source) => {
          const p = (source && source.__parsed) || {};
          return {
            from: { value: [{ address: p.from || '', name: p.fromName || '' }] },
            subject: p.subject || '',
            text: p.text || '',
            html: p.html || false,
            date: p.date ? new Date(p.date) : new Date()
          };
        }
      };
    }
    return originalLoad.apply(this, arguments);
  };

  // ---- 假依赖：网络（Gist GET/PATCH + AI）----
  const originalFetch = globalThis.fetch;
  let aiCalls = 0;
  let lastSystemPrompt = '';
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = String(opts.method || 'GET').toUpperCase();
    if (u.includes('/chat/completions')) {
      aiCalls += 1;
      if (ai === 'fail') throw new Error('fetch failed');
      const body = JSON.parse(opts.body);
      // 记下实际发出去的 system prompt：用于验证「网页端展示的快照」与「真正生效的」逐字一致
      lastSystemPrompt = String((body.messages[0] && body.messages[0].content) || '');
      const mailText = body.messages[body.messages.length - 1].content;
      const result = typeof ai === 'function' ? ai(mailText) : {
        isRecruitment: true, emailType: '面试邀请', company: '测试公司', position: '后端',
        stage: '一面', scheduleAt: '2026-09-12T14:00', location: '深圳', round: '一面',
        summary: '测试摘要', confidence: 0.9
      };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(result) } }] }) };
    }
    if (u.includes('/gists/')) {
      if (method === 'PATCH') {
        patches.push(JSON.parse(opts.body));
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return {
        ok: true, status: 200,
        json: async () => (prevGist || { files: {} })
      };
    }
    throw new Error(`测试未预期的请求：${method} ${u}`);
  };

  // ---- 环境变量 ----
  const envBackup = { ...process.env };
  Object.assign(process.env, {
    QQ_EMAIL: 'test@qq.com', QQ_AUTHCODE: 'x', GIST_ID: 'GID', GIST_PAT: 'T',
    AI_BASE_URL: 'https://ai.example/v1', AI_API_KEY: 'K', AI_MODEL: 'm',
    MAIL_ENC_KEY: '', SINCE_DAYS: '30', MAX_PER_RUN: '60', UID_FROM: uidFrom, KEYWORDS: ''
  });

  // ---- 静默并收集 console ----
  const origLog = console.log, origWarn = console.warn, origErr = console.error;
  console.log = (...a) => logs.push(a.join(' '));
  console.warn = (...a) => logs.push(`WARN ${a.join(' ')}`);
  console.error = (...a) => logs.push(`ERR ${a.join(' ')}`);

  try {
    // 必须清掉**本项目全部**模块的缓存，不能只清 index.js：
    // src/imap.js 在首次 require 时通过 hook 拿到了本次注入的 ImapFlow stub，
    // 而那个 stub 的 fetch() 闭包捕获了本次的 mails。若 src/imap.js 命中缓存，
    // 下一次 runIndexOnce 就会继续用上一次的假邮件（实测过：第 6 个用例抓到的是
    // 第 4 个用例的 uid=1890，导致「丢弃日志 0 条」这种误导性失败）。
    const projectRoot = path.join(__dirname, '..', 'services', 'mail-sync');
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(projectRoot)) delete require.cache[key];
    }
    require(INDEX_PATH); // 文件末尾无条件 main()，require 即执行
    // main() 是 async 且未被 await；假依赖全部同步/立即 resolve，轮询等它落盘
    for (let i = 0; i < 60 && patches.length === 0; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  } finally {
    console.log = origLog; console.warn = origWarn; console.error = origErr;
    Module._load = originalLoad;
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in envBackup)) delete process.env[key];
    }
    Object.assign(process.env, envBackup);
    // 同样清全部：残留的 src/* 缓存会持有已恢复的 Module._load 之前注入的 stub
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(path.join(__dirname, '..', 'services', 'mail-sync'))) delete require.cache[key];
    }
  }

  const exitCodeAfter = process.exitCode;
  process.exitCode = exitCodeBefore; // 不让被测代码的退出码污染测试进程
  return {
    patch: patches.length ? patches[patches.length - 1] : null,
    patchCount: patches.length,
    logs,
    aiCalls,
    lastSystemPrompt,
    hardFailed: exitCodeAfter !== exitCodeBefore
  };
}

const mail = (uid, from, subject, text) => ({
  uid,
  parsed: { from, subject, text: text || '', date: '2026-09-06T10:00:00Z' }
});
const gistWith = (suggestions, meta) => ({
  files: {
    'mail-suggestions.json': {
      content: JSON.stringify({
        meta: Object.assign({ version: 1, lastRunAt: '2026-09-06T00:00:00Z', lastStatus: 'ok', lastError: '', lastUidValidity: 1763287821, lastUid: 1876, newCount: 0, pendingCount: suggestions.length }, meta || {}),
        suggestions
      })
    }
  }
});
const sug = (uid, company, subject) => ({
  id: `uid-${uid}`, sourceUid: uid, receivedAt: '2026-09-06T10:00:00Z',
  from: 'x@y.com', subject: subject || `subj-${uid}`, emailType: '其它',
  company: company || `c${uid}`, position: 'p', stage: '已投递', scheduleAt: '',
  location: '', round: '', summary: '', confidence: 0.9, proposed: {}
});

let passed = 0;
let failed = 0;
const cases = [];
function test(name, fn) { cases.push({ name, fn }); }
async function runAll() {
  for (const c of cases) {
    try { await c.fn(); passed += 1; console.log(`  ✓ ${c.name}`); }
    catch (e) { failed += 1; console.error(`  ✗ ${c.name}\n    ${e.message}`); }
  }
  console.log(`\n${failed ? `存在 ${failed} 个失败用例` : '全部通过'}（共 ${passed + failed} 个，通过 ${passed}）`);
  if (failed) process.exitCode = 1;
}

// ===== 1) 编排层能真实跑完（作用域 / 未定义变量 / 调用签名的总守卫）=====
test('index.js 的 run() 能真实执行到底并 PATCH Gist（抓 ReferenceError 这类只有执行才暴露的错误）', async () => {
  const r = await runIndexOnce({
    mails: [mail(1877, 'noreply@careers.bytedance.com', '字节跳动校园招聘投递成功通知', '感谢您的投递')],
    prevGist: gistWith([])
  });
  assert.strictEqual(r.hardFailed, false, `编排层抛错：\n    ${r.logs.filter(l => l.startsWith('ERR')).join('\n    ')}`);
  assert.strictEqual(r.patchCount, 1, '应恰好 PATCH 一次');
  assert.ok(r.patch, '应有 PATCH body');
  // 只写 mail-suggestions.json 这一个文件（不变量：永不触碰 vault）
  assert.deepStrictEqual(Object.keys(r.patch.files), ['mail-suggestions.json']);
  const written = JSON.parse(r.patch.files['mail-suggestions.json'].content);
  assert.strictEqual(written.suggestions.length, 1, 'noreply 发件人的招聘通知应成功入库');
  assert.strictEqual(written.suggestions[0].company, '测试公司');
  assert.strictEqual(written.meta.lastStatus, 'ok');
  assert.strictEqual(written.meta.lastUid, 1877, '水位推进到已抓取的最大 UID');
  assert.strictEqual(r.aiCalls, 1);
});

// ===== 2) 真实事故回归：AI 全失败时不得删除已有建议 =====
test('AI 全部失败时保留已有建议（事故回归：曾把 10 条删成 7 条）', async () => {
  const prev = [sug(1881, '蚂蚁'), sug(1885, '招商银行'), sug(1887, '中信银行')];
  const r = await runIndexOnce({
    // 本轮重扫这三封，但 AI 全部 fetch failed → 未能裁决。
    // 正文都要含关键词，确保三封都通过预筛成为候选（否则测的是预筛路径而不是 AI 失败路径）
    mails: [
      mail(1881, 'anttalent@antgroup.com', '蚂蚁27届秋招空宣', '招聘直播间等你来'),
      mail(1885, '95555@message.cmbchina.com', '招商银行素质测评通知', '请完成测评'),
      mail(1887, 'job@citicbank.com', '招聘系统邮箱认证', '招聘系统认证')
    ],
    prevGist: gistWith(prev),
    ai: 'fail'
  });
  assert.strictEqual(r.hardFailed, false, '软失败不应让进程退出码非 0');
  // 6 = 3 封 × 2 次：analyzeEmail 失败会自动重试一次（第 2 次去掉 response_format），顺带验证重试机制
  assert.strictEqual(r.aiCalls, 6, '三封都成为候选，且每封失败后各重试一次');
  const written = JSON.parse(r.patch.files['mail-suggestions.json'].content);
  assert.strictEqual(written.suggestions.length, 3, 'AI 失败属于未能裁决，三条已有建议必须全部保留');
  assert.deepStrictEqual(written.suggestions.map(s => s.sourceUid).sort(), [1881, 1885, 1887]);
  assert.strictEqual(written.meta.lastStatus, 'error', '软失败要上屏');
  assert.ok(written.meta.lastError.includes('AI 分析失败 3/3'), `实际 lastError=${written.meta.lastError}`);
  assert.strictEqual(written.meta.lastDropped.aiError, 3);
  assert.strictEqual(written.meta.lastDropped.total, 3);
});

// ===== 3) 重扫即重新裁决：AI 明确判非招聘时删除旧的错误建议 =====
test('AI 判定为非招聘的旧建议会被清除（回溯能纠正已入库的营销邮件）', async () => {
  const prev = [sug(1841, 'HSBC', '年度账户回顾'), sug(1828, 'OPPO', '校园招聘空中宣讲会')];
  const r = await runIndexOnce({
    // 两封都要先通过预筛（主题不含营销词、正文含关键词），才能真正测到「AI 判非招聘」这条路径；
    // 若主题写了「限时优惠」这类词，预筛就丢了，测的其实是用例 4
    mails: [
      mail(1841, 'hsbc.communications@message.hsbc.com.hk', '关于您的年度账户回顾', '招聘相关年度回顾'),
      mail(1828, 'airtalk3@oppo.com', 'OPPO 校园招聘空中宣讲会', '宣讲')
    ],
    prevGist: gistWith(prev),
    // 必须用 UID_FROM 回溯：这两封的 uid（1841/1828）都低于水位 1876，
    // 常规增量会在 fetchMessages 里被 `uid < startUid` 过滤掉，一封也抓不到。
    // 这也正是「回溯纠正已入库营销邮件」的真实用法。
    uidFrom: '1828',
    ai: (text) => (text.includes('年度账户回顾')
      ? { isRecruitment: false, emailType: '其它', confidence: 0.98 }
      : { isRecruitment: true, emailType: '其它', company: 'OPPO', confidence: 0.9 })
  });
  assert.strictEqual(r.aiCalls, 2, '两封都应进 AI');
  const written = JSON.parse(r.patch.files['mail-suggestions.json'].content);
  assert.strictEqual(written.suggestions.length, 1, 'AI 判非招聘的那条应被移除');
  assert.strictEqual(written.suggestions[0].sourceUid, 1828);
  assert.strictEqual(written.meta.lastDropped.aiNotRecruit, 1);
});

// ===== 4) 预筛丢弃也算裁决：规则收紧后旧建议应被清掉 =====
test('预筛判定为噪声的旧建议也会被清除（规则变更后重扫能生效）', async () => {
  const prev = [sug(1890, 'HSBC', '限时优惠 现金奖赏')];
  const r = await runIndexOnce({
    mails: [mail(1890, 'hsbc.communications@message.hsbc.com.hk', '限時優惠 現金獎賞', '优惠')],
    prevGist: gistWith(prev),
    ai: 'ok'
  });
  const written = JSON.parse(r.patch.files['mail-suggestions.json'].content);
  assert.strictEqual(written.suggestions.length, 0, '主题命中营销噪声 → 预筛裁决为不入队');
  assert.strictEqual(r.aiCalls, 0, '预筛丢弃的邮件不该消耗 token');
  assert.strictEqual(written.meta.lastDropped.noiseSubject, 1);
});

// ===== 5) UID_FROM 回溯真的忽略云端水位 =====
test('UID_FROM 回溯：忽略水位重扫，日志标明强制回溯', async () => {
  const r = await runIndexOnce({
    mails: [mail(1880, 'x@y.com', '邮箱验证码', '验证码')],
    prevGist: gistWith([], { lastUid: 1896 }), // 水位已在 1896，正常增量不会抓到 1880
    ai: 'ok',
    uidFrom: '1877'
  });
  assert.ok(r.logs.some(l => l.includes('UID_FROM 强制回溯')), `日志应标明强制回溯，实际：\n    ${r.logs.join('\n    ')}`);
  assert.ok(r.logs.some(l => l.includes('startUid=1877')), '起点应为 UID_FROM 而不是 lastUid+1');
});

// ===== 6) 丢弃日志逐条可查（修复前完全静默）=====
test('每封被丢弃的邮件都逐条打日志，并打印分类汇总', async () => {
  const r = await runIndexOnce({
    mails: [
      mail(2001, 'noreply@github.com', '[GitHub] Please verify your device', 'verify'),
      mail(2002, 'postmaster@qq.com', '退信', 'bounce'),
      mail(2003, 'noreply@mokahr.com', '面试邀请：后端', '诚邀面试')
    ],
    prevGist: gistWith([]),
    ai: 'ok'
  });
  const dropLogs = r.logs.filter(l => l.startsWith('[sync] 丢弃 uid='));
  assert.strictEqual(dropLogs.length, 2, '两封被丢的都应有日志');
  assert.ok(dropLogs.some(l => l.includes('uid=2001') && l.includes('reason=no-keyword')));
  assert.ok(dropLogs.some(l => l.includes('uid=2002') && l.includes('reason=noise-from')));
  assert.ok(r.logs.some(l => l.includes('[sync] 丢弃 2 封：')), '运行结束应有分类汇总');
  // 第三封（noreply + 明确面邀）必须成功入库——这正是本次修复的核心场景
  const written = JSON.parse(r.patch.files['mail-suggestions.json'].content);
  assert.strictEqual(written.suggestions.length, 1);
  assert.strictEqual(written.suggestions[0].sourceUid, 2003);
});

// ===== 7) 门禁：enabled=false 时零 token 跳过 =====
test('mail-config.json 的 enabled=false 时直接跳过，不抓邮件不调 AI', async () => {
  const gist = gistWith([sug(1, 'X')]);
  gist.files['mail-config.json'] = { content: JSON.stringify({ enabled: false }) };
  const r = await runIndexOnce({ mails: [mail(2, 'a@b.com', '面试邀请', 'x')], prevGist: gist, ai: 'ok' });
  assert.strictEqual(r.aiCalls, 0);
  assert.strictEqual(r.patchCount, 0, '跳过时不应写 Gist');
  assert.ok(r.logs.some(l => l.includes('跳过本次（0 token）')));
});

// ===== 8) v0.4.0：提示词整体替换端到端 =====
test('mail-config.json 的 promptOverride 真的传到 AI，且 meta.promptSnapshot 与实际发出的逐字一致', async () => {
  const gist = gistWith([]);
  gist.files['mail-config.json'] = {
    content: JSON.stringify({
      promptOverride: '只解析国企与事业单位的招聘邮件，忽略互联网大厂与培训机构。',
      promptExtra: 'summary 用一句话概括'
    })
  };
  const r = await runIndexOnce({
    mails: [mail(3001, 'noreply@mokahr.com', '面试邀请：后端开发工程师', '诚邀您参加面试')],
    prevGist: gist,
    ai: 'ok'
  });
  assert.strictEqual(r.aiCalls, 1);
  // override 与 extra 都要真的进到发出去的 system prompt 里
  assert.ok(r.lastSystemPrompt.includes('只解析国企与事业单位'), 'override 应传到 AI');
  assert.ok(r.lastSystemPrompt.includes('summary 用一句话概括'), 'extra 应同时生效');
  // 契约不可被替换掉——这是开放整体替换的安全前提
  assert.ok(r.lastSystemPrompt.includes('严格只返回一个 JSON 对象'), '输出契约仍强制附加');
  assert.ok(r.lastSystemPrompt.includes('isRecruitment(bool)'), '字段清单仍在');
  assert.ok(!r.lastSystemPrompt.includes('你是招聘邮件解析引擎'), '内置解析偏好已被整体替换');
  // 关键：网页端只读展示的就是这份快照，必须与实际发给 AI 的完全相同，否则展示的是假的
  const written = JSON.parse(r.patch.files['mail-suggestions.json'].content);
  assert.strictEqual(written.meta.promptSnapshot, r.lastSystemPrompt, '快照必须与实际发出的 system prompt 逐字一致');
  assert.ok(r.logs.some(l => l.includes('promptOverride=yes')), '日志应标明本次用的是自定义提示词');
});
test('未配置 promptOverride 时用内置提示词，快照同样写入 meta', async () => {
  const r = await runIndexOnce({
    mails: [mail(3002, 'noreply@mokahr.com', '面试邀请：后端', '诚邀面试')],
    prevGist: gistWith([]),
    ai: 'ok'
  });
  assert.ok(r.lastSystemPrompt.includes('你是招聘邮件解析引擎'), '用内置解析偏好');
  assert.ok(r.lastSystemPrompt.includes('严格只返回一个 JSON 对象'));
  const written = JSON.parse(r.patch.files['mail-suggestions.json'].content);
  assert.strictEqual(written.meta.promptSnapshot, r.lastSystemPrompt);
  assert.ok(r.logs.some(l => l.includes('promptOverride=no')), '日志应标明用的是内置提示词');
});

// ===== 9) v0.4.0：里程碑备注端到端（写进 Gist 的 proposed.milestone.note）=====
test('AI 归为「其它」时，写进建议的 milestone.note 用 summary 而不是「邮件·其它」', async () => {
  const r = await runIndexOnce({
    mails: [
      mail(4001, 'didiglobal-no-reply@mail.mokahr.co', '【滴滴招聘】简历成功投递通知', '您的简历已成功投递'),
      mail(4002, '95555@message.cmbchina.com', '招商银行素质测评通知', '请完成测评')
    ],
    prevGist: gistWith([]),
    // 第一封归「其它」（投递确认类），第二封归「测评」
    // 招商银行这条刻意**只给 deadline、不给 scheduleAt**：素质测评类邮件的典型形状就是
    // "请在 X 日前完成"而没有开始时间。用来端到端验证 v4.16.0 新接的 deadline 字段
    // 真的能从 AI 输出走到落盘的 mail-suggestions.json。
    ai: (text) => (text.includes('素质测评')
      ? { isRecruitment: true, emailType: '测评', company: '招商银行', summary: '通知参加素质测评，截止9月20日12:00', confidence: 0.98, stage: '测评', deadline: '2026-09-20' }
      : { isRecruitment: true, emailType: '其它', company: '滴滴', summary: '简历成功投递滴滴校招，等待后续流程推进', confidence: 0.95, stage: '已投递' })
  });
  const written = JSON.parse(r.patch.files['mail-suggestions.json'].content);
  const didi = written.suggestions.find(s => s.sourceUid === 4001);
  const cmb = written.suggestions.find(s => s.sourceUid === 4002);
  // 两条都没有 scheduleAt → milestone.at 是收信日兜底，备注必须**自报身份**。
  // 此前这里是静默兜底：显示成「测评（2026-09-06）」，看起来像从邮件里读出来的，
  // 勾选后永久写进时间线，三个月后无从分辨。
  assert.ok(didi.proposed.milestone.note.startsWith('邮件·简历成功投递滴滴校招，等待后续流程推进'),
    `「其它」类必须用 summary —— 这条会被永久写进台账时间线，实际：${didi.proposed.milestone.note}`);
  assert.ok(didi.proposed.milestone.note.includes('未给时间'), '兜底日期必须在备注里标注出来');
  assert.strictEqual(didi.proposed.milestone.atSource, 'received');
  assert.strictEqual(cmb.proposed.milestone.note, '邮件·测评（未给时间·按收信日）',
    '有明确类型的保留简短类型名便于扫读，兜底标注照加');
  // deadline 端到端：AI 输出 → normalizeAiResult → proposed → 落盘的 suggestions
  assert.strictEqual(cmb.proposed.deadline, '2026-09-20',
    '截止时间必须一路带到落盘的建议里（台账有 deadline 字段与「签约截止」列，此前整条链路丢弃它）');
  assert.strictEqual(didi.proposed.deadline, '', 'AI 没给 deadline 时必须是空串而不是 undefined');
  // isRecruitment 落盘备查（v4.6.1 加的字段）
  assert.strictEqual(didi.isRecruitment, true);
});

// 直接运行时执行全部用例；被 require 时只导出工具（便于临时调试单个场景）
if (require.main === module) runAll();
module.exports = { runIndexOnce, runAll, test, mail, gistWith, sug };
