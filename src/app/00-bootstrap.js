
      // 跨端单一事实源（v4.9.0）：以下常量全部来自 ./shared/*.js（<script> 已在主内联脚本之前加载），
      // 这里只做**转发别名**，不再写字面量。同一份值还被浏览器插件（extension/shared/ 生成拷贝）
      // 与 mail-sync Action（require）消费——从此改一个阶段名不会出现「网页版认、Action 不认」的静默失败。
      // test/web-check.js 的别名守卫断言这几行只能是 `= AJA.X` 形式，写回字面量即红。
      // 阶段预设（仅用于排序/推进建议/分布/配色）：实际阶段可自定义，允许跳过笔试、支持三/四/五面、交叉面等。
      const STAGE_PRESETS = AJA.STAGE_PRESETS;
      const STAGES = STAGE_PRESETS; // 兼容别名：旧引用（分布/筛选/采集）仍可用
      // v4.11.0：批次（BATCH_PRESETS）与渠道（CHANNEL_PRESETS）两个字段整体删除。
      // 批次原本承担「同公司同岗位但不是同一次投递」的区分职责，现由 orgUnit（机构 / 子公司 / BU）
      // 接替，而且更贴合实际 —— 杭州分行与成都分行招同名岗位是两次真实投递，
      // 而「提前批 / 正式批」是时间维度，与「是不是同一次投递」关系更弱。
      // 渠道则与 referral（内推人 / 联系方式）语义重叠：删掉分类标签、留下具体的人，信息反而更清楚。
      // v4.6.0 企业性质（封闭枚举，白名单校验，非法值归 ''=未设置）。
      // v4.9.0 起值来自 ./shared/company-types.js，与插件端同源；此前要靠 extension-bridge.js 的
      // 逐值一致性断言防漂移（多写或写错一个字，用户选了也等于没选、洞察统计永远缺这一档），
      // 现在结构上不可能漂移了。
      const COMPANY_TYPES = AJA.COMPANY_TYPES;
      const COMPANY_TYPE_UNSET = AJA.COMPANY_TYPE_UNSET;
      // v4.11.0 改名的读时迁移表（旧值「民企」→「私企」），同样只是 shared/ 的转发别名
      const COMPANY_TYPE_ALIASES = AJA.COMPANY_TYPE_ALIASES;
      // 阶段排序：预设返回索引；自定义/未知返回大值（视为“更靠后”），用 9000 规避 2^53 精度问题
      function stageOrder(stage) {
        const i = STAGE_PRESETS.indexOf(stage);
        return i === -1 ? 9000 : i;
      }
      // 清洗时间线：仅保留有阶段名的里程碑，规范字段，按日期升序（同日期保持插入序）
      function sanitizeTimeline(list) {
        if (!Array.isArray(list)) return [];
        return list
          .map(m => ({ stage: String(m && m.stage || '').trim(), at: String(m && m.at || '').trim(), note: String(m && m.note || '').trim() }))
          .filter(m => m.stage)
          .map((m, i) => ({ m, i }))
          .sort((a, b) => (a.m.at || '9999-99-99').localeCompare(b.m.at || '9999-99-99') || a.i - b.i)
          .map(x => x.m);
      }
      // 当前阶段 = 时间线末项（派生）；无时间线则回退到 stage 字段
      function deriveStage(rec) {
        const tl = rec && Array.isArray(rec.timeline) ? rec.timeline : [];
        return tl.length ? tl[tl.length - 1].stage : (String(rec && rec.stage || '').trim() || '待投递');
      }
      // 统一写时间线并同步派生 stage/updatedAt——所有时间线改动都走这里，保证 stage 一致
      function setTimeline(rec, timeline) {
        rec.timeline = sanitizeTimeline(timeline);
        rec.stage = deriveStage(rec);
        rec.updatedAt = Date.now();
        return rec;
      }
      // 永久兼容约定：后续版本不得更改或复用此键；字段升级统一通过 normalizeRecord 迁移。
      const STORAGE_KEY = 'autumnRecruitmentTracker.records.v1';
      const RESUME_STORAGE_KEY = 'autumnRecruitmentTracker.resume.v1';
      const RESUME_META_KEY = 'autumnRecruitmentTracker.resumeMeta.v1';
      // 简历默认骨架（全空，不预置任何个人信息；须在 loadResumeData 调用前声明）
      // v4.9.0 起骨架来自 ./shared/default-resume.js，与插件 background 的首次初始化、
      // Side Panel 的兜底同源（合并前已实测两份逐值深度相同：6 段、段名一致、JSON 序列化相同）。
      // 结构约定见 shared 里的注释：对象段不含下划线键，数组段用 _rowName 作段名元数据。
      const DEFAULT_RESUME = AJA.DEFAULT_RESUME;
      // 下面两个是**网页版专有**的渲染分类（插件侧用 Array.isArray 判断段类型，不依赖段名），
      // 刻意不搬进 shared/——搬过去只会让 Action 与插件多一份用不到的耦合。
      const RESUME_KV_SECTIONS = ['优先信息', '基本信息', '竞赛与技能'];
      const RESUME_EXP_SECTIONS = ['教育经历', '实习经历', '项目经历'];
      const SCHEMA_VERSION = 1;
      const APP_VERSION = '4.14.0';
      const SAFETY_DB_NAME = 'autumnRecruitmentTracker.safety.v1';
      const SYNC_KEY = 'autumnRecruitmentTracker.sync.v1';
      const TOMBSTONE_KEY = 'autumnRecruitmentTracker.tombstones.v1';
      const GIST_API = 'https://api.github.com';
      const GIST_FILENAME = 'qiuzhao-tracker-data.json';
      // 邮件提醒（M3）：Action 只写这个独立文件，网页只读它、绝不写它；mailState 纯本地，不进 envelope、不跨设备同步
      const MAIL_SUGGEST_FILENAME = 'mail-suggestions.json';
      const MAIL_STORAGE_KEY = 'autumnRecruitmentTracker.mail.v1';
      // UI 偏好（v4.4.0）：台账视图模式（表格/看板）、公司分组折叠态、首启引导是否已关闭。
      // 纯本机、不进 envelope、不跨设备同步——这是显示偏好而非数据。
      const UI_STORAGE_KEY = 'autumnRecruitmentTracker.ui.v1';
      // 网页写、Action 读的配置文件（明文，不含任何密钥）；默认值与 Action src/config.js 保持一致
      const MAIL_CONFIG_FILENAME = 'mail-config.json';
      const MAIL_CFG_DEFAULTS = { keywords: '面试|笔试|机试|测评|录用|应聘|招聘|校招|网申|入职|简历|interview', minConfidence: 0.3, sinceDays: 30, maxPerRun: 30, enabled: true, minIntervalHours: 0, promptExtra: '', promptOverride: '' };
      const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
      const $ = (selector) => document.querySelector(selector);
      const els = {
        total: $('#totalCount'), today: $('#todayCount'), active: $('#activeCount'), week: $('#weekCount'), offer: $('#offerCount'),
        stageGrid: $('#stageGrid'), body: $('#recordBody'), empty: $('#emptyState'), caption: $('#resultCaption'),
        upcoming: $('#upcomingList'), search: $('#searchInput'), filter: $('#stageFilter'), sort: $('#sortSelect'),
        dialog: $('#recordDialog'), form: $('#recordForm'), dialogTitle: $('#dialogTitle'), toast: $('#toast')
      };
      let primaryLoadState = 'unknown';
      // 当前台账是否为「首次打开自动塞入的示例数据」（必须在 loadRecords 调用前声明，否则赋值触发 TDZ）
      let sampleDataMode = false;
      // 示例标记必须**持久化**：sampleDataMode 只是内存变量时，刷新页面后标记丢失而示例还在
      // localStorage 里——首启引导消失（showGuide 依赖它）、统计把示例当真实数据、之后开云同步时
      // 示例被 syncNow 静默丢弃（用户会莫名其妙发现台账空了）。三个后果都不报错，属静默型缺陷。
      // 所有赋值必须走 setSampleMode（web-check 有守卫钉住裸赋值），否则又会绕过持久化。
      const SAMPLE_FLAG_KEY = 'autumnRecruitmentTracker.sample.v1';
      function setSampleMode(on) {
        sampleDataMode = !!on;
        try {
          if (on) localStorage.setItem(SAMPLE_FLAG_KEY, '1');
          else localStorage.removeItem(SAMPLE_FLAG_KEY);
        } catch (_) {}
      }
      let records = loadRecords();
      // 刷新恢复标记：loadRecords 播种时会 setSampleMode(true)；若上次会话已载入/播种过示例，
      // flag 仍在 localStorage → 读回。keep / 清空 / 快照恢复 / 云同步丢弃都会删 flag。
      if (!sampleDataMode) {
        try { sampleDataMode = localStorage.getItem(SAMPLE_FLAG_KEY) === '1'; } catch (_) {}
      }
      let resume = loadResumeData();
      let resumeSavedAt = loadResumeMeta();
      let editingId = null;
      let toastTimer;
      let safetyDbPromise;
      let backupFileHandle = null;
      let lastFileBackupAt = '';
      let persistenceQueue = Promise.resolve();
      let syncConfig = loadSyncConfig();
      let tombstones = loadTombstones();
      let syncBusy = false;
      let syncPushTimer = null;
      // 忙碌期间被记下的待推变更。原先 scheduleSyncPush 遇到 syncBusy 直接 return，
      // 那次改动就**永不上推**了（不报错、不重试，只是静默少同步一次），故改为记标志、
      // 在 syncNow 的 finally 里补推。
      let syncPushPending = false;
      let cachedSnapshotCount = null; // 快照计数缓存，避免每次渲染都全量读 IndexedDB

      // ===== 邮件提醒（M3）本地状态 =====
      // mailState.appliedIds/dismissedIds 仅本机、不进 envelope、不跨设备同步（v1 取舍）；
      // mailSuggestions/mailMeta 为内存态，每次 syncNow 从 Gist 的 mail-suggestions.json 刷新。
      let mailState = loadMailState();
      let mailSuggestions = [];
      let mailRawSuggestions = []; // 未过滤的原始建议（来自 Gist），供 mailState 合并后重新过滤
      let mailMeta = null;
      let mailConfig = null;       // Gist 里的 mail-config.json（内存态，供设置面板回填）
      let mailNeedKey = false;     // 邮件文件已加密但本机未填解密密钥
      let pendingMailSeedId = null; // 「新建记录」交接到弹窗，保存成功后才标记该建议为已应用

      function dateOffset(days, hour = 10, minute = 0) {
        const d = new Date();
        d.setHours(hour, minute, 0, 0);
        d.setDate(d.getDate() + days);
        return d;
      }

      function localDateInput(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }

      function localDateTimeInput(date) {
        return `${localDateInput(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
      }

      function exampleRecords() {
        const now = Date.now();
        return [
          { id: cryptoId(), company: '星海科技', position: '产品经理校招生', city: '上海', applicationDate: localDateInput(dateOffset(-12)), stage: '一面', scheduleAt: localDateTimeInput(dateOffset(1, 14, 0)), recentSchedule: '线上一面', nextAction: '梳理项目经历，准备三分钟自我介绍', updatedAt: now - 2000 },
          { id: cryptoId(), company: '山岚智能', position: '算法工程师', city: '北京', applicationDate: localDateInput(dateOffset(-18)), stage: '笔试', scheduleAt: localDateTimeInput(dateOffset(3, 19, 0)), recentSchedule: '在线笔试', nextAction: '复习动态规划与概率题', updatedAt: now - 5000 },
          { id: cryptoId(), company: '青禾互娱', position: '用户运营', city: '杭州', applicationDate: localDateInput(dateOffset(-7)), stage: '已投递', scheduleAt: localDateTimeInput(dateOffset(5, 10, 30)), recentSchedule: '邮件跟进招聘进度', nextAction: '检查邮箱并准备补充作品集', updatedAt: now - 8000 },
          { id: cryptoId(), company: '远帆咨询', position: '商业分析顾问', city: '深圳', applicationDate: localDateInput(dateOffset(-28)), stage: '二面', timeline: [{ stage: '已投递', at: localDateInput(dateOffset(-28)), note: '' }, { stage: '笔试', at: localDateInput(dateOffset(-20)), note: '在线测评' }, { stage: '一面', at: localDateInput(dateOffset(-10)), note: '' }, { stage: '二面', at: localDateInput(dateOffset(-3)), note: '业务负责人面' }], scheduleAt: localDateTimeInput(dateOffset(8, 15, 0)), recentSchedule: '业务负责人面试', nextAction: '练习市场规模估算案例', updatedAt: now - 12000 },
          { id: cryptoId(), company: '拾光设计', position: '交互设计师', city: '广州', applicationDate: localDateInput(dateOffset(-33)), stage: 'Offer', scheduleAt: '', recentSchedule: '已收到录用通知', nextAction: '确认入职时间并回复邮件', updatedAt: now - 15000 }
        ];
      }

      function cryptoId() {
        return (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }

      function loadRecords() {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw !== null) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              primaryLoadState = 'valid';
              const normalized = parsed.map(normalizeRecord);
              // 老数据被 normalizeRecord 补齐新字段后写回一次：否则在下一次任何变更之前，
              // localStorage 里仍是旧结构，导出备份 / 外部读取者（插件桥接、脚本）看不到 v4.4.0 的字段。
              // 仅在序列化结果确实变化时写，避免每次启动都无谓写盘。
              try {
                const serialized = JSON.stringify(normalized);
                if (serialized !== raw) localStorage.setItem(STORAGE_KEY, serialized);
              } catch (error) { console.warn('回写归一化后的记录失败', error); }
              return normalized;
            }
            primaryLoadState = 'corrupt';
          } else {
            primaryLoadState = 'missing';
          }
        } catch (error) {
          primaryLoadState = 'corrupt';
          console.warn('无法读取本地记录', error);
        }
        const initial = exampleRecords();
        // 标记「当前台账是示例数据」：首启引导会明确告知并提供一键清空，避免用户误把示例当成自己的投递
        setSampleMode(true);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(initial)); } catch (error) { console.warn(error); }
        return initial;
      }

      function normalizeRecord(item) {
        // 时间线迁移：有时间线则清洗；否则由旧的单一 stage 合成一条里程碑（老数据零丢失，自定义阶段不再被打回）
        const timeline = Array.isArray(item.timeline) && item.timeline.length
          ? sanitizeTimeline(item.timeline)
          : [{ stage: String(item.stage || '').trim() || '待投递', at: String(item.applicationDate || '').trim() || localDateInput(new Date()), note: '' }];
        const rec = {
          id: String(item.id || cryptoId()),
          company: String(item.company || ''), position: String(item.position || ''), city: String(item.city || ''),
          // v4.11.0 机构 / 子公司 / BU（选填，上限 60 字）。必须在 normalizeRecord 里显式携带 ——
          // 这里的对象是**白名单式重建**，漏写的字段会在每次 load / 云同步 / 导入时被静默丢弃。
          // 为什么不能靠算法推断：companyKey 的「互相包含」规则会把「招商银行杭州分行」吸进
          // 「招商银行」，但「招银网络科技」与「招商银行」互不包含 → 判成两家。那是刻意的保守
          // （猜错会把两家真不同的公司并成一家），所以中间层只能由用户显式填。
          orgUnit: String(item.orgUnit || '').trim().slice(0, 60),
          applicationDate: String(item.applicationDate || ''),
          applicationUrl: /^https?:\/\//i.test(String(item.applicationUrl || '')) ? String(item.applicationUrl) : '',
          scheduleAt: String(item.scheduleAt || ''), recentSchedule: String(item.recentSchedule || ''),
          nextAction: String(item.nextAction || ''), updatedAt: Number(item.updatedAt) || Date.now(),
          // ===== v4.4.0 新增字段（全部可选，老数据缺省即为空；必须在此显式携带，否则每次 load/sync 会静默丢失）=====
          deadline: String(item.deadline || ''),            // 网申/测评/笔试/签约截止日（YYYY-MM-DD）
          referral: String(item.referral || ''),            // 内推人或联系方式
          salary: String(item.salary || ''),                // 薪资文本（Offer 对比用）
          intent: Math.min(5, Math.max(0, Number(item.intent) || 0)), // 意向度 0-5，0=未设
          // v4.6.0：企业性质（央国企/私企/外企）。封闭枚举 + 白名单校验，非法值一律归 ''（未设置），
          // 避免插件旧版本或手工改 JSON 塞进自由文本后污染洞察统计的分桶。
          // v4.11.0：先过一遍别名表再查白名单 —— 第二档从「民企」改名成「私企」，不迁移的话
          // 用户已有记录会被白名单静默打回「未设置」（洞察少一档、徽章变灰，都不报错）。
          // 读时迁移而不是写时批量改写：记录分散在 localStorage / 快照 / 云端三处，见 shared 的说明。
          companyType: (() => {
            const raw = String(item.companyType || '').trim();
            const mapped = Object.prototype.hasOwnProperty.call(COMPANY_TYPE_ALIASES, raw) ? COMPANY_TYPE_ALIASES[raw] : raw;
            return COMPANY_TYPES.includes(mapped) ? mapped : '';
          })(),
          notes: (Array.isArray(item.notes) ? item.notes : [])
            .filter(n => n && String(n.text || '').trim())
            .map(n => ({ id: String(n.id || cryptoId()), at: Number(n.at) || Date.now(), text: String(n.text).trim() }))
            .slice(-200),                                   // 面经/跟进笔记，上限 200 条防膨胀
          timeline
        };
        rec.stage = deriveStage(rec); // 当前阶段 = 时间线末项（派生缓存，兼容分布/筛选/排序/徽章/桥接/同步）
        return rec;
      }
      // ===== 云同步（可选）：把投递记录同步到自己的 GitHub 私有 Gist，实现跨设备修改 =====
      function loadSyncConfig() {
        const empty = { token: '', passphrase: '', gistId: '', lastSyncAt: '' };
        try {
          const parsed = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null');
          if (!parsed || typeof parsed !== 'object') return empty;
          return {
            token: String(parsed.token || ''),
            passphrase: String(parsed.passphrase || ''),
            gistId: String(parsed.gistId || ''),
            lastSyncAt: String(parsed.lastSyncAt || '')
          };
        } catch (_) {
          return empty;
        }
      }

      function saveSyncConfig() {
        try { localStorage.setItem(SYNC_KEY, JSON.stringify(syncConfig)); } catch (error) { console.warn('云同步配置保存失败', error); }
      }

      function loadTombstones() {
        try {
          const parsed = JSON.parse(localStorage.getItem(TOMBSTONE_KEY) || '[]');
          return Array.isArray(parsed) ? parsed.filter(item => item && item.id && Number(item.deletedAt) > 0) : [];
        } catch (_) {
          return [];
        }
      }

      function pruneTombstones(list) {
        const limit = Date.now() - TOMBSTONE_TTL_MS;
        return list.filter(item => Number(item.deletedAt) > limit);
      }

      function saveTombstones() {
        try { localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(tombstones)); } catch (error) { console.warn('删除标记保存失败', error); }
      }

      // 跨设备删除同步：被删记录留下墓碑，合并时只有晚于墓碑更新的记录才会“复活”
      function markDeleted(ids) {
        if (!ids.length) return;
        const map = new Map(tombstones.map(item => [item.id, item]));
        const now = Date.now();
        ids.forEach(id => map.set(id, { id, deletedAt: now }));
        tombstones = pruneTombstones([...map.values()]);
        saveTombstones();
      }

      // 撤销删除：撤回墓碑，避免这次删除被云同步传播到其它设备
      function unmarkDeleted(ids) {
        if (!ids.length) return;
        const set = new Set(ids);
        tombstones = tombstones.filter(item => !set.has(item.id));
        saveTombstones();
      }

      function sameRecordSet(left, right) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
        const map = new Map(right.map(item => [item.id, item]));
        return left.every(item => {
          const other = map.get(item.id);
          return other && other.updatedAt === item.updatedAt && other.stage === item.stage
            && other.company === item.company && other.position === item.position;
        });
      }

      function sameTombstoneSet(left, right) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
        const map = new Map(right.map(item => [item.id, Number(item.deletedAt)]));
        return left.every(item => map.get(item.id) === Number(item.deletedAt));
      }

      // ID 集合是否相同（顺序无关）——用于判断 mailState 是否需要回推云端
      function sameIdSet(left, right) {
        const a = new Set((Array.isArray(left) ? left : []).map(String));
        const b = new Set((Array.isArray(right) ? right : []).map(String));
        if (a.size !== b.size) return false;
        for (const x of a) if (!b.has(x)) return false;
        return true;
      }

      // LWW 合并：同一条记录保留 updatedAt 更新的版本；墓碑晚于记录则保持删除，否则记录复活
      function mergeSyncState(remote) {
        const remoteRecords = (remote?.records || []).map(normalizeRecord);
        const remoteTombstones = (remote?.tombstones || []).filter(item => item && item.id && Number(item.deletedAt) > 0);
        const localById = new Map(records.map(item => [item.id, item]));
        const remoteById = new Map(remoteRecords.map(item => [item.id, item]));
        const stoneById = new Map();
        [...tombstones, ...remoteTombstones].forEach(item => {
          const prev = stoneById.get(item.id);
          if (!prev || Number(item.deletedAt) > Number(prev.deletedAt)) stoneById.set(item.id, item);
        });
        const mergedRecords = [];
        new Set([...localById.keys(), ...remoteById.keys()]).forEach(id => {
          const newest = [localById.get(id), remoteById.get(id)].filter(Boolean).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
          const stone = stoneById.get(id);
          if (stone && Number(stone.deletedAt) >= Number(newest.updatedAt || 0)) return;
          if (stone) stoneById.delete(id);
          mergedRecords.push(newest);
        });
        const mergedTombstones = pruneTombstones([...stoneById.values()]);
        return { mergedRecords, mergedTombstones };
      }

      function bytesToBase64(bytes) {
        let binary = '';
        bytes.forEach(byte => { binary += String.fromCharCode(byte); });
        return btoa(binary);
      }

      function base64ToBytes(value) {
        return Uint8Array.from(atob(value), char => char.charCodeAt(0));
      }

      async function deriveSyncKey(passphrase, salt) {
        const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      }

      async function encryptSyncText(text, passphrase) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveSyncKey(passphrase, salt);
        const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
        return { v: 1, enc: 'AES-GCM-PBKDF2', salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(cipher) };
      }

      async function decryptSyncText(payload, passphrase) {
        const key = await deriveSyncKey(passphrase, base64ToBytes(payload.salt));
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(payload.iv) }, key, base64ToBytes(payload.data));
        return new TextDecoder().decode(plain);
      }

      // 口令指纹：同一口令始终指向同一个数据空间文件，不同口令互不覆盖、可切换
      async function passphraseFingerprint(passphrase) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`autumnRecruitmentTracker.fp.v1:${passphrase}`));
        return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
      }

      async function vaultFileName(passphrase) {
        return passphrase ? `vault-${await passphraseFingerprint(passphrase)}.json` : 'vault-plain.json';
      }

      function isTrackerGist(gist) {
        return Object.keys(gist?.files || {}).some(name => name === GIST_FILENAME || /^vault-/.test(name));
      }

      // 区分云端状态：当前口令的空间 / 旧版单文件 / 是否存在其他口令的空间
      function classifyGistFiles(files, vaultName) {
        const names = Object.keys(files || {});
        return {
          vaultContent: files?.[vaultName]?.content || '',
          legacyContent: names.includes(GIST_FILENAME) ? (files[GIST_FILENAME].content || '') : '',
          hasOtherVaults: names.some(name => name !== vaultName && name !== GIST_FILENAME && /^vault-/.test(name))
        };
      }

      async function parseSyncPayload(rawContent, passphrase) {
        let parsed = JSON.parse(rawContent);
        if (parsed && parsed.enc) {
          if (!passphrase) throw new Error('云端数据已加密，请先填写同步口令');
          if (!(self.crypto && crypto.subtle)) throw new Error('当前环境不支持解密，请改用 https 访问');
          try {
            parsed = JSON.parse(await decryptSyncText(parsed, passphrase));
          } catch (_) {
            throw new Error('同步口令不正确，无法解密云端数据');
          }
        }
        return {
          records: Array.isArray(parsed?.records) ? parsed.records : [],
          tombstones: Array.isArray(parsed?.tombstones) ? parsed.tombstones : [],
          // 简历必须一并带回，否则跨设备拉取时 remote.resume/resumeSavedAt 为 undefined，
          // LWW 采纳条件(Number(undefined)>x 恒为 false)永不成立，简历只能推不能拉
          resume: parsed?.resume && typeof parsed.resume === 'object' && !Array.isArray(parsed.resume) ? parsed.resume : null,
          resumeSavedAt: Number(parsed?.resumeSavedAt) || 0,
          // 邮件状态必须一并带回，否则跨设备拉取时 remote.mailState 为 undefined，
          // 并集合并拿不到远端已忽略/已应用项 → 只能推不能拉（同"简历只推不拉"陷阱）
          mailState: parsed?.mailState && typeof parsed.mailState === 'object'
            ? {
                appliedIds: Array.isArray(parsed.mailState.appliedIds) ? parsed.mailState.appliedIds.map(String) : [],
                dismissedIds: Array.isArray(parsed.mailState.dismissedIds) ? parsed.mailState.dismissedIds.map(String) : []
              }
            : null
        };
      }

      async function gistRequest(path, options = {}) {
        const response = await fetch(`${GIST_API}${path}`, {
          method: options.method || 'GET',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${syncConfig.token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            ...(options.body ? { 'Content-Type': 'application/json' } : {})
          },
          body: options.body
        });
        if (response.status === 404 && options.allowNotFound) return null;
        if (response.status === 401) throw new Error('访问令牌无效或已过期，请重新生成');
        if (response.status === 404) throw new Error('云端数据不存在，可能 Gist 已被删除');
        if (response.status === 403) throw new Error(response.headers.get('x-ratelimit-remaining') === '0' ? 'GitHub 接口调用太频繁，请几分钟后再试' : 'GitHub 拒绝了请求，请确认令牌已勾选 gist 权限');
        if (!response.ok) {
          // 读出 GitHub 的校验详情（尤其 422），否则只能看到状态码、无法定位非法字段
          let detail = '';
          try {
            const errBody = await response.json();
            const first = Array.isArray(errBody?.errors) ? errBody.errors[0] : null;
            if (first) detail = `：${first.message || first.code || ''}${first.field ? `（字段 ${first.field}）` : ''}`;
            else if (errBody?.message) detail = `：${errBody.message}`;
          } catch (_) {}
          throw new Error(`GitHub 接口异常（${response.status}）${detail}`);
        }
        return response.json().catch(() => null);
      }

      async function resolveSyncGist() {
        if (syncConfig.gistId) {
          const gist = await gistRequest(`/gists/${syncConfig.gistId}`, { allowNotFound: true });
          if (gist && isTrackerGist(gist)) return syncConfig.gistId;
          syncConfig.gistId = '';
        }
        const owned = await gistRequest('/gists?per_page=100');
        const found = (Array.isArray(owned) ? owned : []).find(isTrackerGist);
        if (found) {
          syncConfig.gistId = found.id;
          saveSyncConfig();
          return syncConfig.gistId;
        }
        const created = await gistRequest('/gists', {
          method: 'POST',
          body: JSON.stringify({
            description: '秋招投递管理器云同步数据（自动创建，请勿删除）',
            public: false,
            files: { [await vaultFileName(syncConfig.passphrase)]: { content: '{}' } }
          })
        });
        syncConfig.gistId = created?.id || '';
        if (!syncConfig.gistId) throw new Error('创建云同步 Gist 失败');
        saveSyncConfig();
        return syncConfig.gistId;
      }

      async function pushSyncState(dropLegacy = false) {
        const envelope = { ...createEnvelope(records), tombstones };
        let payload = envelope;
        if (syncConfig.passphrase) {
          if (!(self.crypto && crypto.subtle)) throw new Error('当前环境不支持加密，请清空同步口令或改用 https 访问');
          payload = await encryptSyncText(JSON.stringify(envelope), syncConfig.passphrase);
        }
        const vaultName = await vaultFileName(syncConfig.passphrase);
        const files = { [vaultName]: { content: JSON.stringify(payload) } };
        if (dropLegacy) files[GIST_FILENAME] = null; // GitHub 删除文件的正确写法是“整个文件置 null”；写成 {content:null} 会被当成空内容→422 Validation Failed
        await gistRequest(`/gists/${syncConfig.gistId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            description: '秋招投递管理器云同步数据（自动创建，请勿删除）',
            files
          })
        });
      }

      async function syncNow(trigger = 'manual') {
        if (syncBusy) return;
        if (!syncConfig.token) {
          if (trigger === 'manual') openSyncDialog();
          return;
        }
        syncBusy = true;
        renderSyncStatus('syncing');
        try {
          await resolveSyncGist();
          const gist = await gistRequest(`/gists/${syncConfig.gistId}`, { allowNotFound: true });
          if (!gist || !gist.files) throw new Error('云端数据读取失败，请稍后重试');
          const vaultName = await vaultFileName(syncConfig.passphrase);
          const cloud = classifyGistFiles(gist.files, vaultName);
          // 邮件配置（明文，无密钥）：读回供设置面板回填，网页与 Action 共用同一份配置
          try {
            const cfgFile = gist.files[MAIL_CONFIG_FILENAME];
            mailConfig = cfgFile && cfgFile.content ? JSON.parse(cfgFile.content) : null;
          } catch (_) { mailConfig = null; }
          // 邮件建议：独立于 vault 解密读取，不受同步口令影响；缺失/损坏静默跳过，绝不影响 vault 同步。
          // 若 Action 配了 MAIL_ENC_KEY，文件是加密信封，用本机 mailState.encKey 解密；未填/填错则提示去设置里填。
          mailNeedKey = false;
          try {
            const mailFile = gist.files[MAIL_SUGGEST_FILENAME];
            if (!mailFile || !mailFile.content) {
              applyMailPayload(null);
            } else {
              let parsedMail = JSON.parse(mailFile.content);
              if (parsedMail && parsedMail.enc) {
                if (!mailState.encKey) { mailNeedKey = true; applyMailPayload(null); }
                else {
                  try { applyMailPayload(JSON.parse(await decryptSyncText(parsedMail, mailState.encKey))); }
                  catch (_) { mailNeedKey = true; applyMailPayload(null); } // 密钥不正确
                }
              } else {
                applyMailPayload(parsedMail);
              }
            }
          } catch (_) { applyMailPayload(null); }
          let remote = null;
          let migrateLegacy = false;
          if (cloud.vaultContent.trim() && cloud.vaultContent.trim() !== '{}') {
            remote = await parseSyncPayload(cloud.vaultContent, syncConfig.passphrase);
          } else if (cloud.legacyContent.trim() && cloud.legacyContent.trim() !== '{}') {
            // 旧版单文件格式：能用当前口令读取则迁移到独立数据空间，读不动说明属于其他口令
            try {
              remote = await parseSyncPayload(cloud.legacyContent, syncConfig.passphrase);
              migrateLegacy = true;
            } catch (_) {
              remote = null;
            }
          }
          if (!remote && (cloud.hasOtherVaults || (cloud.legacyContent.trim() && cloud.legacyContent.trim() !== '{}'))) {
            // 云端已有其他口令的数据空间，但当前口令没有匹配的空间（可能口令输错）
            if (trigger !== 'manual') throw new Error('云端没有与此口令匹配的数据空间，请在云同步设置中确认口令');
            const createNew = await confirmInApp('云端没有与此口令匹配的数据空间（口令可能不正确）。\n\n可以用当前设备的数据新建一个独立空间，云端原有数据不会被改动，之后可随时换回原口令。是否新建？', { title: '云同步', confirmText: '新建空间' });
            if (!createNew) throw new Error('已取消：云端没有与此口令匹配的数据空间');
          }
          // 首次打开自动塞入的示例数据绝不参与云合并：示例的 updatedAt 就是"刚刚"，
          // 在 LWW 里会赢过云端真实记录，进而把星海科技之类的样例污染进 vault。
          // 因此只要走到云同步（无论云端有无数据），一律先丢弃本地示例；引导卡会随后提示开始记录。
          if (sampleDataMode) {
            records = [];
            setSampleMode(false);
            try { localStorage.setItem(STORAGE_KEY, '[]'); } catch (_) {}
          }
          const { mergedRecords, mergedTombstones } = mergeSyncState(remote);
          // 邮件已应用/已忽略状态：跨设备并集合并（远端处理过的，本机也不再显示），随后用合并态重新过滤建议
          if (remote && remote.mailState) {
            const mergedMail = unionMailState(mailState, remote.mailState);
            mailState.appliedIds = mergedMail.appliedIds;
            mailState.dismissedIds = mergedMail.dismissedIds;
            saveMailState();
            refilterMail();
          }
          // 简历整体 LWW：云端版本更新且非空则采用，随云同步拉取后同时下发插件
          if (remote && Number(remote.resumeSavedAt) > resumeSavedAt && remote.resume && !isResumeEmpty(remote.resume)) {
            resume = remote.resume;
            resumeSavedAt = Number(remote.resumeSavedAt);
            localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(resume));
            localStorage.setItem(RESUME_META_KEY, JSON.stringify({ savedAt: resumeSavedAt }));
            renderResumeEditor();
            pushResumeToPlugin();
          }
          const localChanged = !sameRecordSet(mergedRecords, records) || !sameTombstoneSet(mergedTombstones, tombstones);
          if (localChanged) {
            records = mergedRecords;
            tombstones = mergedTombstones;
            saveTombstones();
            saveRecords();
            render();
          }
          // 本地简历更新（或云端无简历而本地非空）时随下次推送上传
          const resumeNeedsPush = !isResumeEmpty(resume) && resumeSavedAt > Number(remote?.resumeSavedAt || 0);
          // 邮件已应用/已忽略状态：本地(并集合并后)与云端不一致就必须回推，
          // 否则仅改 mailState（忽略/应用）时 remoteChanged 恒为 false → 永不上传 → 别的设备看不到（同"只推不拉"陷阱）
          const remoteMail = remote && remote.mailState ? remote.mailState : null;
          const mailStateNeedsPush = !sameIdSet(mailState.appliedIds, remoteMail && remoteMail.appliedIds) || !sameIdSet(mailState.dismissedIds, remoteMail && remoteMail.dismissedIds);
          const remoteChanged = !remote || !sameRecordSet(mergedRecords, remote.records) || !sameTombstoneSet(mergedTombstones, remote.tombstones) || resumeNeedsPush || mailStateNeedsPush;
          if (remoteChanged) await pushSyncState(migrateLegacy);
          syncConfig.lastSyncAt = new Date().toISOString();
          saveSyncConfig();
          renderSyncStatus();
          if (trigger === 'manual') showToast(localChanged ? '云同步完成，已合并云端更新' : '云同步完成，各设备数据一致');
        } catch (error) {
          const message = error instanceof TypeError ? '无法连接 GitHub，请检查网络' : error.message;
          renderSyncStatus('error', message);
          if (trigger === 'manual') showToast(`云同步失败：${message}`);
          else console.warn('自动云同步失败', error);
        } finally {
          syncBusy = false;
          // 补推忙碌期间记下的变更（见 syncPushPending 声明处的说明）
          if (syncPushPending) { syncPushPending = false; scheduleSyncPush(); }
        }
      }

      function scheduleSyncPush() {
        if (!syncConfig.token) return;
        if (syncBusy) { syncPushPending = true; return; }
        clearTimeout(syncPushTimer);
        syncPushTimer = setTimeout(() => syncNow('auto'), 4000);
      }

      function initializeCloudSync() {
        renderSyncStatus();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'visible' || !syncConfig.token || syncBusy) return;
          const last = new Date(syncConfig.lastSyncAt || 0).getTime();
          if (Number.isNaN(last) || Date.now() - last > 5 * 60 * 1000) syncNow('auto');
        });
        if (syncConfig.token) setTimeout(() => syncNow('auto'), 1500);
      }

      function openSyncDialog() {
        $('#syncTokenInput').value = syncConfig.token;
        $('#syncPassphraseInput').value = syncConfig.passphrase;
        renderSyncStatus();
        $('#syncDialog').showModal();
      }

      function renderSyncStatus(state, message) {
        renderToolCards(); // 同步状态变化时同步刷新工具页卡片徽标（fire-and-forget，覆盖下方所有分支）
        const badge = $('#syncStateBadge');
        const detail = $('#syncStateDetail');
        if (!badge || !detail) return;
        const status = $('#syncStatus');
        const notice = $('#sideDataNotice');
        if (!syncConfig.token) {
          badge.textContent = '未配置';
          badge.className = 'safety-state warning';
          detail.textContent = '填写访问令牌后即可开启跨设备同步';
          if (notice) notice.innerHTML = '<strong>数据保存在本机</strong>无需账号，不上传投递记录';
          if (status) status.textContent = '填写令牌后点击“保存并同步”即可开启。';
          return;
        }
        if (notice) notice.innerHTML = `<strong>云同步已开启</strong>GitHub 私有 Gist${syncConfig.passphrase ? '，数据加密后上传' : ''}`;
        if (state === 'syncing') {
          badge.textContent = '同步中';
          badge.className = 'safety-state';
          detail.textContent = '正在与 GitHub 同步…';
          if (status) status.textContent = '正在同步，请稍候…';
          return;
        }
        if (state === 'error') {
          badge.textContent = '同步失败';
          badge.className = 'safety-state warning';
          detail.textContent = message || '上次同步未完成';
          if (status) status.textContent = `同步失败：${message || '未知错误'}`;
          return;
        }
        badge.textContent = '已开启';
        badge.className = 'safety-state';
        detail.textContent = syncConfig.lastSyncAt
          ? `上次同步 ${formatClock(syncConfig.lastSyncAt)} · 共 ${records.length} 条记录`
          : '已保存设置，尚未完成首次同步';
        if (status) status.textContent = syncConfig.lastSyncAt ? `上次同步：${formatClock(syncConfig.lastSyncAt)}` : '设置已保存，点击“保存并同步”完成首次同步。';
      }

      async function saveSyncSettings() {
        const token = $('#syncTokenInput').value.trim();
        const passphrase = $('#syncPassphraseInput').value.trim();
        if (!token) return showToast('请先填写 GitHub 访问令牌');
        if (token.length < 20) return showToast('令牌看起来不完整，请复制完整的令牌');
        // 换口令 = 切换数据空间，云端数据互不覆盖；只有换令牌才重新查找 Gist
        if (token !== syncConfig.token) {
          syncConfig.token = token;
          syncConfig.gistId = '';
          syncConfig.lastSyncAt = '';
        }
        syncConfig.passphrase = passphrase;
        saveSyncConfig();
        renderSyncStatus();
        showToast('设置已保存，开始同步');
        await syncNow('manual');
      }

      async function disconnectSync() {
        if (!syncConfig.token) return showToast('当前没有开启云同步');
        if (!await confirmInApp('断开后本机不再自动同步；云端 Gist 与数据会保留。\n确定断开吗？', { title: '断开云同步', danger: true, confirmText: '断开' })) return;
        clearTimeout(syncPushTimer);
        syncConfig = { token: '', passphrase: '', gistId: '', lastSyncAt: '' };
        saveSyncConfig();
        $('#syncTokenInput').value = '';
        $('#syncPassphraseInput').value = '';
        renderSyncStatus();
        showToast('已断开云同步，数据仍保存在本机');
      }

      function saveRecords(message) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
          if (message) showToast(message);
          const envelope = createEnvelope(records);
          persistenceQueue = persistenceQueue
            .then(() => persistSafetyLayers(envelope))
            .catch(error => console.warn('附加备份未完成', error));
          scheduleSyncPush();
        } catch (error) {
          alert('浏览器未能保存数据。请检查是否禁用了本地存储，或换一个浏览器重试。');
        }
      }

      // ================= 我的简历：加载 / 渲染 / 收集（编辑器从插件移植，存储键与插件一致） =================
      // DEFAULT_RESUME / RESUME_*_SECTIONS 定义见顶部常量区（避免 TDZ）

      function loadResumeData() {
        try {
          const parsed = JSON.parse(localStorage.getItem(RESUME_STORAGE_KEY) || 'null');
          // JSON 即真相：存储有合法对象则原样返回（不合并默认骨架，被删除的段保持删除）；仅空/损坏时用默认模板
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch (error) { console.warn('简历读取失败', error); }
        return JSON.parse(JSON.stringify(DEFAULT_RESUME));
      }

      function loadResumeMeta() {
        try { return Number(JSON.parse(localStorage.getItem(RESUME_META_KEY) || '{}').savedAt) || 0; }
        catch (_) { return 0; }
      }

      function isResumeEmpty(data) {
        if (!data || typeof data !== 'object') return true;
        // JSON 即真相：遍历实际存在的段；_rowName 是结构标签不计入内容
        return Object.values(data).every(sec => {
          if (Array.isArray(sec)) return !sec.some(item => Object.entries(item || {}).some(([k, v]) => k !== '_rowName' && Boolean(v)));
          if (sec && typeof sec === 'object') return !Object.values(sec).some(Boolean);
          return !Boolean(sec);
        });
      }

      // ================= 字段模板库：覆盖网申高频字段（名称即插件填表匹配名） =================
      const FIELD_LIBRARY = {
        '优先信息': [
          ['手机', 'text'], ['邮箱', 'text'], ['身份证', 'text'], ['证件类型', 'text'], ['微信号', 'text'],
          ['现居地', 'text'], ['求职意向', 'text'], ['期望薪资', 'text'], ['到岗时间', 'text'], ['政治面貌', 'text']
        ],
        '基本信息': [
          ['姓名', 'text'], ['性别', 'text'], ['出生日期', 'date'], ['民族', 'text'], ['籍贯', 'text'],
          ['婚姻状况', 'text'], ['身高', 'text'], ['体重', 'text'], ['健康状况', 'text'], ['邮编', 'text'],
          ['通讯地址', 'text'], ['紧急联系人', 'text'], ['紧急联系电话', 'text'], ['自我评价', 'longtext']
        ],
        '教育经历': [
          ['学校', 'text'], ['学院', 'text'], ['专业', 'text'], ['学历', 'text'], ['学位', 'text'],
          ['开始时间', 'date'], ['结束时间', 'date'], ['GPA', 'text'], ['专业排名', 'text'], ['导师', 'text'],
          ['核心课程', 'longtext'], ['荣誉奖项', 'longtext'], ['辅修专业', 'text'], ['培养方式', 'text']
        ],
        '实习经历': [
          ['单位', 'text'], ['部门', 'text'], ['岗位', 'text'], ['业务条线', 'text'], ['直属导师', 'text'],
          ['开始', 'date'], ['结束', 'date'], ['是否转正', 'text'], ['证明人', 'text'],
          ['岗位职责', 'longtext'], ['量化成果', 'longtext'], ['技术栈', 'text']
        ],
        '项目经历': [
          ['项目名称', 'text'], ['项目背景', 'longtext'], ['担任角色', 'text'], ['开始', 'date'], ['结束', 'date'],
          ['主要工作', 'longtext'], ['难点与攻克', 'longtext'], ['量化成果', 'longtext'],
          ['协作规模', 'text'], ['技术栈', 'text'], ['项目链接', 'url']
        ],
        '竞赛与技能': [
          ['英语水平', 'text'], ['计算机等级', 'text'], ['专业技能', 'longtext'], ['学术竞赛', 'longtext'],
          ['论文发表', 'longtext'], ['专利', 'text'], ['兴趣特长', 'text']
        ]
      };

      // 字段类型不入库，渲染时按字段名推断（保存后仍是纯 key/value，插件 flatmap 零影响）
      function inferFieldType(name) {
        if (/时间|日期/.test(name)) return 'date';
        if (/链接|网址/.test(name)) return 'url';
        if (/职责|描述|评价|成果|工作|背景|课程|奖项|竞赛|论文/.test(name)) return 'longtext';
        return 'text';
      }

      // 字段外壳（v4.11.0）：四个分支共用，这样「加删除按钮」只需要改一处。
      // 此前四个分支各写一遍 <div><label>…</label><input …></div>，而 kvRowHtml 一直带 ✕ ——
      // 两个渲染函数不对称，exp 卡片里字段库加进去的字段只能靠删掉整段卡片来去掉。
      // 「经历标签」_rowName 不会走到这里：它由 expCardHtml 单独硬编码渲染（是卡片标题与
      // expSummary 的来源，删了卡片就没名字），所以下面的过滤已经排除了它。
      function expFieldShell(keyAttr, fullW, controlHtml) {
        return `<div class="exp-field-wrap${fullW ? ' full-w' : ''}"><label>${keyAttr}</label>${controlHtml}<button type="button" class="exp-field-del" data-action="del-exp-field" data-key="${keyAttr}" title="删除此字段" aria-label="删除字段 ${keyAttr}">✕</button></div>`;
      }

      function expFieldHtml(key, value, presetType) {
        const type = presetType || inferFieldType(key);
        const val = escapeHtml(String(value ?? ''));
        const keyAttr = escapeHtml(key);
        if (type === 'longtext') {
          return expFieldShell(keyAttr, true, `<textarea class="control exp-field" data-key="${keyAttr}" rows="3" placeholder="填写内容...">${val}</textarea>`);
        }
        if (type === 'date') {
          return expFieldShell(keyAttr, false, `<input type="date" class="control exp-field" data-key="${keyAttr}" value="${val}">`);
        }
        if (type === 'url') {
          return expFieldShell(keyAttr, true, `<input type="url" class="control exp-field" data-key="${keyAttr}" value="${val}" placeholder="https://...">`);
        }
        return expFieldShell(keyAttr, false, `<input type="text" class="control exp-field" data-key="${keyAttr}" value="${val}" placeholder="填写内容...">`);
      }

      function expSummary(item) {
        return escapeHtml(item['学校'] || item['单位'] || item['项目名称'] || item['_rowName'] || '经历');
      }

      function renumberExpCards(container) {
        container.querySelectorAll('.exp-item-card').forEach((card, idx) => {
          const getValue = key => card.querySelector(`.exp-field[data-key="${CSS.escape(key)}"]`)?.value || '';
          const tag = getValue('_rowName') || '经历';
          const summary = getValue('学校') || getValue('单位') || getValue('项目名称') || tag;
          const h4 = card.querySelector('.exp-item-header h4');
          if (h4) h4.textContent = `#${idx + 1} ${tag} · ${summary}`;
        });
      }

      function countSectionFields(sec) {
        if (!Array.isArray(resume[sec])) {
          const entries = Object.entries(resume[sec] || {});
          return { filled: entries.filter(([, v]) => String(v || '').trim()).length, total: entries.length };
        }
        const list = Array.isArray(resume[sec]) ? resume[sec] : [];
        let filled = 0, total = 0;
        list.forEach(item => Object.entries(item).forEach(([k, v]) => {
          if (k === '_rowName') return;
          total += 1;
          if (String(v || '').trim()) filled += 1;
        }));
        return { filled, total };
      }

      function updateResumeCompletion() {
        let filled = 0, total = 0;
        Object.keys(resume).forEach(sec => {
          const stat = countSectionFields(sec);
          filled += stat.filled; total += stat.total;
          const countEl = document.querySelector(`.resume-block-count[data-section="${CSS.escape(sec)}"]`);
          if (countEl) countEl.textContent = stat.total ? `${stat.filled}/${stat.total}` : '—';
        });
        const pct = total ? Math.round((filled / total) * 100) : 0;
        const valueEl = $('#resumeProgressValue');
        const fillEl = $('#resumeProgressFill');
        if (valueEl) valueEl.textContent = `${pct}%`;
        if (fillEl) fillEl.style.width = `${pct}%`;
      }

      function sectionBody(sec) {
        const mount = document.getElementById('resume-sections');
        return mount ? mount.querySelector(`.resume-section-block[data-section="${CSS.escape(sec)}"] > .resume-block-body`) : null;
      }

      function kvRowHtml(sec, k, v) {
        const s = escapeHtml(sec);
        return `
          <div class="kv-row" data-section="${s}">
            <input type="text" class="control kv-key" value="${escapeHtml(k)}" placeholder="字段名称">
            <input type="text" class="control kv-val" value="${escapeHtml(v)}" placeholder="内容值">
            <button type="button" class="kv-del-btn" data-action="del-kv" title="删除字段">✕</button>
          </div>`;
      }

      function expCardHtml(sec, item, idx) {
        const s = escapeHtml(sec);
        return `
          <div class="exp-item-card" data-section="${s}">
            <div class="exp-item-header">
              <h4 data-action="toggle-exp" title="点击折叠 / 展开">#${idx + 1} ${escapeHtml(item._rowName || '经历')} · ${expSummary(item)}</h4>
              <div class="exp-card-tools">
                <button type="button" class="text-button" data-action="move-exp-up" title="上移">上移</button>
                <button type="button" class="text-button" data-action="move-exp-down" title="下移">下移</button>
                <button type="button" class="text-button" data-action="dup-exp" title="复制此段">复制</button>
                <button type="button" class="text-button danger" data-action="del-exp">删除</button>
              </div>
            </div>
            <div class="exp-fields-grid">
              <div>
                <label>经历标签</label>
                <input type="text" class="control exp-field" data-key="_rowName" value="${escapeHtml(item._rowName || '')}" placeholder="例如：硕士 / 腾讯">
              </div>
              ${Object.entries(item).filter(([k]) => k !== '_rowName').map(([k, v]) => expFieldHtml(k, v)).join('')}
            </div>
            <div class="exp-card-footer">
              <button type="button" class="btn btn-soft btn-small" data-action="open-lib" data-section="${s}" data-exp-card>＋ 添加字段（本段）</button>
            </div>
          </div>`;
      }

      // JSON 即真相：按 resume 实际有的段（含顺序）动态渲染；JSON 里没有的段不渲染
      function renderResumeEditor() {
        const mount = document.getElementById('resume-sections');
        if (!mount) return;
        mount.innerHTML = Object.entries(resume).map(([sec, val]) => {
          const isExp = Array.isArray(val);
          const s = escapeHtml(sec);
          const addBtn = isExp
            ? `<button class="btn btn-primary btn-small" data-action="add-exp" data-section="${s}" type="button">＋ 添加</button>`
            : `<button class="btn btn-small" data-action="add-kv" data-section="${s}" type="button">自定义</button>`;
          // 类型转换（v4.11.1）：新增区块时选错类型、或在这个能力上线**之前**建的区块，
          // 都需要这条逃生口。后者才是用户实际撞上的：那时新增区块被硬编码成空对象，
          // 而这里靠 Array.isArray(val) 分叉，键值型的区块结构上就拿不到「＋ 添加」按钮，
          // 于是「新增的区块没法加多条经历」对**已存在**的区块依然成立 —— 只修新增路径等于没修。
          const convertBtn = `<button class="btn btn-small" data-action="convert-section" data-section="${s}" type="button" title="列表型：可加多段经历，每段有多个字段，能上移 / 下移 / 复制 / 删除。键值型：一行一项。转换不丢字段；多段经历转键值型会被拒绝并提示">转为${isExp ? '键值' : '列表'}型</button>`;
          return `<div class="resume-section-block" data-section="${s}" data-type="${isExp ? 'exp' : 'kv'}">
            <div class="resume-block-head"><h3>${s}</h3><div class="resume-block-meta">
              <span class="resume-block-count" data-section="${s}">—</span>
              ${addBtn}
              <button class="btn btn-soft btn-small" data-action="open-lib" data-section="${s}" type="button">＋ 字段库</button>
              ${convertBtn}
              <button class="btn btn-small btn-danger" data-action="del-section" data-section="${s}" type="button">删除</button>
            </div></div>
            <div class="resume-block-body" data-body="${s}"></div>
          </div>`;
        }).join('') || '<div class="resume-empty-hint">简历为空。点右上「导入 JSON」或「添加区块」开始。</div>';
        Object.entries(resume).forEach(([sec, val]) => {
          const body = sectionBody(sec);
          if (!body) return;
          if (Array.isArray(val)) {
            body.innerHTML = val.map((item, idx) => expCardHtml(sec, item, idx)).join('')
              || '<div class="resume-empty-hint">还没有经历，点「＋ 添加」开始</div>';
          } else {
            body.innerHTML = Object.entries(val || {}).map(([k, v]) => kvRowHtml(sec, k, v)).join('')
              || '<div class="resume-empty-hint">从字段库添加常用字段，或直接自定义</div>';
          }
        });
        updateResumeCompletion();
      }

      function addKvField(sec, presetKey) {
        const container = sectionBody(sec);
        if (!container) return;
        const hint = container.querySelector('.resume-empty-hint');
        if (hint) hint.remove();
        const row = document.createElement('div');
        row.className = 'kv-row';
        row.setAttribute('data-section', sec);
        row.innerHTML = `
          <input type="text" class="control kv-key" value="${escapeHtml(presetKey || '')}" placeholder="新字段名称">
          <input type="text" class="control kv-val" placeholder="内容值">
          <button type="button" class="kv-del-btn" data-action="del-kv" title="删除字段">✕</button>
        `;
        container.appendChild(row);
        const keyInput = row.querySelector('.kv-key');
        if (!presetKey) keyInput?.focus();
        else row.querySelector('.kv-val')?.focus();
      }

      function addExperienceRow(sec) {
        const container = sectionBody(sec);
        if (!container) return;
        const hint = container.querySelector('.resume-empty-hint');
        if (hint) hint.remove();
        const presets = {
          '教育经历': [['学校', 'text'], ['学院', 'text'], ['专业', 'text'], ['学历', 'text'], ['开始时间', 'date'], ['结束时间', 'date']],
          '实习经历': [['_rowName', 'text'], ['单位', 'text'], ['岗位', 'text'], ['开始', 'date'], ['结束', 'date'], ['岗位职责', 'longtext']],
          '项目经历': [['_rowName', 'text'], ['项目名称', 'text'], ['担任角色', 'text'], ['开始', 'date'], ['结束', 'date'], ['主要工作', 'longtext']]
        }[sec] || [];
        const rowNamePreset = sec === '教育经历' ? '教育经历' : '';
        const card = document.createElement('div');
        card.className = 'exp-item-card';
        card.setAttribute('data-section', sec);
        const count = container.querySelectorAll('.exp-item-card').length + 1;
        card.innerHTML = `
          <div class="exp-item-header">
            <h4 data-action="toggle-exp" title="点击折叠 / 展开">#${count} 新增${sec.replace('经历', '')}经历</h4>
            <div class="exp-card-tools">
              <button type="button" class="text-button" data-action="move-exp-up" title="上移">上移</button>
              <button type="button" class="text-button" data-action="move-exp-down" title="下移">下移</button>
              <button type="button" class="text-button" data-action="dup-exp" title="复制此段">复制</button>
              <button type="button" class="text-button danger" data-action="del-exp">删除</button>
            </div>
          </div>
          <div class="exp-fields-grid">
            <div>
              <label>经历标签</label>
              <input type="text" class="control exp-field" data-key="_rowName" value="${rowNamePreset}" placeholder="例如：硕士 / 腾讯">
            </div>
            ${presets.map(([k, t]) => expFieldHtml(k, '', t)).join('')}
          </div>
          <div class="exp-card-footer">
            <button type="button" class="btn btn-soft btn-small" data-action="open-lib" data-section="${sec}" data-exp-card>＋ 添加字段（本段）</button>
          </div>
        `;
        container.appendChild(card);
        card.querySelector('.exp-field')?.focus();
      }

      // ================= 字段库弹层 =================
      let fieldLibraryContext = null; // { section, expCard? }

      function openFieldLibrary(section, expCard) {
        fieldLibraryContext = { section, expCard: expCard || null };
        const title = $('#fieldLibraryTitle');
        if (title) title.textContent = `添加字段 · ${section}`;
        renderFieldLibrary();
        $('#fieldLibraryDialog').showModal();
      }

      function renderFieldLibrary() {
        const grid = $('#fieldLibraryGrid');
        if (!fieldLibraryContext || !grid) return;
        const { section, expCard } = fieldLibraryContext;
        const existing = new Set();
        if (expCard) {
          expCard.querySelectorAll('.exp-field').forEach(f => existing.add(f.getAttribute('data-key')));
        } else {
          (sectionBody(section)?.querySelectorAll('.kv-key') || []).forEach(input => {
            if (input.value.trim()) existing.add(input.value.trim());
          });
        }
        const items = FIELD_LIBRARY[section] || [];
        grid.innerHTML = items.map(([name, type]) => `
          <button type="button" class="field-library-item ${existing.has(name) ? 'is-added' : ''}" data-field="${escapeHtml(name)}" ${existing.has(name) ? 'disabled' : ''}>
            <span>${escapeHtml(name)}</span><span class="field-library-type">${type}</span>
          </button>
        `).join('') || '<div class="resume-empty-hint">该区块暂无预设，请使用自定义字段</div>';
        const status = $('#fieldLibraryStatus');
        if (status) status.textContent = expCard ? '字段将添加到当前这段经历' : `字段将添加到「${section}」区块`;
      }

      function applyFieldFromLibrary(name, type) {
        if (!fieldLibraryContext) return;
        const { section, expCard } = fieldLibraryContext;
        if (expCard) {
          expCard.classList.remove('is-collapsed');
          const gridEl = expCard.querySelector('.exp-fields-grid');
          gridEl.insertAdjacentHTML('beforeend', expFieldHtml(name, '', type));
          expCard.querySelector(`.exp-field[data-key="${CSS.escape(name)}"]`)?.focus();
        } else {
          addKvField(section, name);
        }
        renderFieldLibrary();
      }

      // JSON 即真相：按 DOM 中实际存在的区块重建 resume（保留顺序；被删除的段不再回写）
      function collectResumeFromDom() {
        const updated = {};
        const mount = document.getElementById('resume-sections');
        if (!mount) return updated;
        mount.querySelectorAll(':scope > .resume-section-block').forEach(block => {
          const sec = block.getAttribute('data-section');
          if (!sec) return;
          if (block.getAttribute('data-type') === 'exp') {
            const list = [];
            block.querySelectorAll('.exp-item-card').forEach(card => {
              const item = {};
              card.querySelectorAll('.exp-field').forEach(field => {
                const k = field.getAttribute('data-key');
                if (k) item[k] = field.value.trim();
              });
              if (Object.keys(item).length > 1 || item._rowName) list.push(item);
            });
            updated[sec] = list;
          } else {
            const obj = {};
            block.querySelectorAll('.kv-row').forEach(row => {
              const k = row.querySelector('.kv-key')?.value.trim();
              const v = row.querySelector('.kv-val')?.value.trim();
              if (k) obj[k] = v || '';
            });
            updated[sec] = obj;
          }
        });
        return updated;
      }

      // B3 桥接下发：把最新简历推给同页面的插件 content script（06-bridge 监听 RESUME_PUSH）
      function pushResumeToPlugin() {
        window.postMessage({ source: 'AUTUMN_TRACKER', type: 'RESUME_PUSH', resume }, '*');
      }

      function persistResume() {
        localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(resume));
        resumeSavedAt = Date.now();
        localStorage.setItem(RESUME_META_KEY, JSON.stringify({ savedAt: resumeSavedAt }));
        // 简历也在 envelope 里（createEnvelope 含 resume / resumeSavedAt），所以本地保存同样要写
        // 快照层：saveRecords 一直有调，这里漏了 → localStorage 一旦损坏，从 IndexedDB 恢复出来的
        // 会是**旧简历**。必须在 resumeSavedAt 更新之后再取 envelope。
        const envelope = createEnvelope(records);
        persistenceQueue = persistenceQueue
          .then(() => persistSafetyLayers(envelope))
          .catch(error => console.warn('附加备份未完成', error));
        pushResumeToPlugin();
        scheduleSyncPush();
      }

      async function collectAndSaveResume() {
        resume = collectResumeFromDom();
        persistResume();
        renderResumeEditor();
        showToast('简历已保存，已下发浏览器插件并纳入云同步');
      }

      function createEnvelope(sourceRecords = records) {
        return {
          schemaVersion: SCHEMA_VERSION,
          appVersion: APP_VERSION,
          savedAt: new Date().toISOString(),
          recordCount: sourceRecords.length,
          records: sourceRecords.map(record => ({ ...record })),
          resume: JSON.parse(JSON.stringify(resume)),
          resumeSavedAt,
          // 邮件已应用/已忽略状态跨设备同步（只同步这两个 ID 列表；encKey/lastReadAt 仅本机，不上传）
          mailState: { appliedIds: mailState.appliedIds.slice(), dismissedIds: mailState.dismissedIds.slice() }
        };
      }

      function openSafetyDb() {
        if (!('indexedDB' in window)) return Promise.reject(new Error('当前浏览器不支持恢复快照'));
        if (safetyDbPromise) return safetyDbPromise;
        safetyDbPromise = new Promise((resolve, reject) => {
          const request = indexedDB.open(SAFETY_DB_NAME, 1);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
            if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots');
            if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error('无法打开恢复存储'));
        });
        return safetyDbPromise;
      }

      async function dbGet(storeName, key) {
        const db = await openSafetyDb();
        return new Promise((resolve, reject) => {
          const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }

      async function dbPut(storeName, value, key) {
        const db = await openSafetyDb();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(storeName, 'readwrite');
          transaction.objectStore(storeName).put(value, key);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
      }

      async function dbDelete(storeName, key) {
        const db = await openSafetyDb();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(storeName, 'readwrite');
          transaction.objectStore(storeName).delete(key);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
      }

      async function dbGetAll(storeName) {
        const db = await openSafetyDb();
        return new Promise((resolve, reject) => {
          const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
        });
      }

      // 快照计数缓存刷新：仅在首次渲染或无法确定时全量读取，平时由 saveBrowserSnapshot 写入时维护
      async function refreshSnapshotCount() {
        try {
          const snapshots = await dbGetAll('snapshots');
          cachedSnapshotCount = Math.min(snapshots.length, 25);
        } catch (_) {
          cachedSnapshotCount = null;
        }
        return cachedSnapshotCount;
      }

      async function saveBrowserSnapshot(envelope) {
        const previous = await dbGet('state', 'latest');
        await dbPut('state', envelope, 'latest');
        if (previous && JSON.stringify(previous.records || []) === JSON.stringify(envelope.records)) return;
        const snapshotKey = `${envelope.savedAt}-${cryptoId()}`;
        await dbPut('snapshots', envelope, snapshotKey);
        const db = await openSafetyDb();
        const keys = await new Promise((resolve, reject) => {
          const request = db.transaction('snapshots', 'readonly').objectStore('snapshots').getAllKeys();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
        });
        const oldKeys = keys.sort().reverse().slice(25);
        await Promise.all(oldKeys.map(key => dbDelete('snapshots', key)));
        cachedSnapshotCount = Math.min(keys.length, 25); // 写入后即时更新缓存
      }

      async function filePermission(handle, request = false) {
        if (!handle) return 'denied';
        const options = { mode: 'readwrite' };
        if ((await handle.queryPermission(options)) === 'granted') return 'granted';
        if (request && (await handle.requestPermission(options)) === 'granted') return 'granted';
        return 'prompt';
      }

      async function writeBackupFile(envelope, requestPermission = false) {
        if (!backupFileHandle) return false;
        if (await filePermission(backupFileHandle, requestPermission) !== 'granted') return false;
        const writable = await backupFileHandle.createWritable();
        await writable.write(JSON.stringify(envelope, null, 2));
        await writable.close();
        lastFileBackupAt = envelope.savedAt;
        updateSafetyStatus();
        return true;
      }

      async function persistSafetyLayers(envelope) {
        await saveBrowserSnapshot(envelope);
        if (backupFileHandle) await writeBackupFile(envelope, false);
      }

      async function initializeDataSafety() {
        try {
          const latest = await dbGet('state', 'latest');
          if (primaryLoadState !== 'valid' && Array.isArray(latest?.records)) {
            records = latest.records.map(normalizeRecord);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
            primaryLoadState = 'valid';
            setSampleMode(false); // 恢复出来的是真实数据，不再是示例
            render();
            showToast(`已从安全快照恢复 ${records.length} 条记录`);
          } else {
            await saveBrowserSnapshot(createEnvelope(records));
          }
          backupFileHandle = await dbGet('handles', 'backupFile') || null;
          if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
        } catch (error) {
          console.warn('数据安全层初始化失败', error);
        }
        updateSafetyStatus();
      }

      async function updateSafetyStatus() {
        const snapshotState = $('#snapshotState');
        const fileState = $('#fileBackupState');
        if (!snapshotState || !fileState) return;
        const count = cachedSnapshotCount == null ? await refreshSnapshotCount() : cachedSnapshotCount;
        if (count == null) {
          snapshotState.textContent = '当前不可用';
          snapshotState.className = 'safety-state warning';
        } else {
          snapshotState.textContent = `${count} 个快照`;
          snapshotState.className = 'safety-state';
        }
        if (!backupFileHandle) {
          fileState.textContent = '尚未设置';
          fileState.className = 'safety-state warning';
          return;
        }
        const permission = await filePermission(backupFileHandle, false).catch(() => 'prompt');
        if (permission === 'granted') {
          fileState.textContent = lastFileBackupAt ? `已同步 ${formatClock(lastFileBackupAt)}` : '已连接';
          fileState.className = 'safety-state';
        } else {
          fileState.textContent = '需要重新授权';
          fileState.className = 'safety-state warning';
        }
      }

      function formatClock(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
      }

      function openSafetyDialog() {
        $('#safetyDialog').showModal();
        updateSafetyStatus();
      }

      async function setupAutomaticBackup() {
        if (!window.showSaveFilePicker) {
          alert('当前浏览器不支持自动写入备份文件。你仍可使用“导出投递记录”和“导入备份文件”。建议使用最新版 Chrome 或 Edge。');
          return;
        }
        try {
          backupFileHandle = await window.showSaveFilePicker({
            suggestedName: '秋招投递自动备份.json',
            types: [{ description: 'JSON 备份文件', accept: { 'application/json': ['.json'] } }]
          });
          await dbPut('handles', backupFileHandle, 'backupFile');
          await writeBackupFile(createEnvelope(records), true);
          if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
          showToast('自动备份文件已设置并完成首次同步');
        } catch (error) {
          if (error?.name !== 'AbortError') alert('没有完成自动备份设置，请重新选择一个可写入的位置。');
        }
        updateSafetyStatus();
      }

      async function backupNow() {
        if (!backupFileHandle) return setupAutomaticBackup();
        try {
          const written = await writeBackupFile(createEnvelope(records), true);
          if (written) showToast(`已把 ${records.length} 条记录同步到备份文件`);
        } catch (error) {
          alert('备份文件无法写入，可能已被移动或删除。请重新设置自动备份文件。');
        }
        updateSafetyStatus();
      }

      function downloadPayload(payload, filename) {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      async function importBackupFile(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        try {
          const parsed = JSON.parse(await file.text());
          const incoming = Array.isArray(parsed) ? parsed : parsed.records;
          if (!Array.isArray(incoming) || incoming.some(item => !item || typeof item !== 'object')) throw new Error('文件中没有有效记录');
          if (!await confirmInApp(`备份中有 ${incoming.length} 条记录。\n\n继续后将替换当前 ${records.length} 条记录，系统会先下载一份“导入前备份”。是否继续？`, { title: '导入备份', danger: true, confirmText: '继续导入' })) return;
          downloadPayload(createEnvelope(records), `秋招投递-导入前备份-${localDateInput(new Date())}.json`);
          const importedIds = new Set(incoming.map(item => String(item.id || '')));
          markDeleted(records.filter(item => !importedIds.has(item.id)).map(item => item.id));
          records = incoming.map(normalizeRecord);
          // 备份携带简历时一并导入（整体替换，随云同步上传并下发插件）
          if (parsed && parsed.resume && typeof parsed.resume === 'object' && !Array.isArray(parsed.resume)) {
            resume = parsed.resume;
            resumeSavedAt = Number(parsed.resumeSavedAt) || Date.now();
            localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(resume));
            localStorage.setItem(RESUME_META_KEY, JSON.stringify({ savedAt: resumeSavedAt }));
            renderResumeEditor();
            pushResumeToPlugin();
          }
          saveRecords(`已导入并保护 ${records.length} 条记录`);
          render();
          updateSafetyStatus();
        } catch (error) {
          alert(`导入失败：${error.message || '这不是有效的秋招投递备份文件。'}`);
        }
      }

      async function restorePreviousSnapshot() {
        try {
          const snapshots = (await dbGetAll('snapshots')).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
          const current = JSON.stringify(records);
          const previous = snapshots.find(snapshot => Array.isArray(snapshot.records) && JSON.stringify(snapshot.records.map(normalizeRecord)) !== current);
          if (!previous) {
            alert('暂时没有与当前数据不同的历史快照。');
            return;
          }
          if (!await confirmInApp(`将恢复 ${formatClock(previous.savedAt)} 的快照，共 ${previous.records.length} 条记录。\n系统会先下载当前数据备份。是否继续？`, { title: '恢复快照', danger: true, confirmText: '恢复' })) return;
          downloadPayload(createEnvelope(records), `秋招投递-恢复前备份-${localDateInput(new Date())}.json`);
          const snapshotIds = new Set(previous.records.map(item => String(item.id || '')));
          markDeleted(records.filter(item => !snapshotIds.has(item.id)).map(item => item.id));
          records = previous.records.map(normalizeRecord);
          saveRecords(`已恢复 ${previous.records.length} 条记录`);
          render();
          updateSafetyStatus();
        } catch (error) {
          alert('暂时无法读取历史快照，请使用导入备份文件恢复。');
        }
      }

      function escapeHtml(value) {
        return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
      }

      function parseLocal(value) {
        if (!value) return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
      }

      function formatDate(value, withYear = true) {
        if (!value) return '—';
        const d = new Date(`${value}T00:00:00`);
        if (Number.isNaN(d.getTime())) return value;
        return new Intl.DateTimeFormat('zh-CN', { year: withYear ? 'numeric' : undefined, month: 'short', day: 'numeric' }).format(d);
      }

      function formatDateTime(value) {
        const d = parseLocal(value);
        if (!d) return '暂未安排';
        return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
      }

      function isActive(record) {
        return !['待投递', 'Offer', '已结束'].includes(record.stage);
      }

      function getVisibleRecords() {
        const keyword = els.search.value.trim().toLocaleLowerCase('zh-CN');
        const stage = els.filter.value;
        const filtered = records.filter(record => {
          const matchesText = !keyword || `${record.company} ${record.orgUnit || ''} ${record.position}`.toLocaleLowerCase('zh-CN').includes(keyword);
          return matchesText && (stage === 'all' || record.stage === stage);
        });
        // v4.11.0：这里不再有 company-group 分支。「按公司聚合」从排序选项变成了独立开关，
        // 聚拢动作挪到 renderTable 的 clusterByCompanyGroup —— 排序只管顺序，分组只管插组头，
        // 两件事正交。原先它俩挤在一个下拉里，想收纳就用不了「最近安排优先」。
        filtered.sort((a, b) => {
          if (els.sort.value === 'applied-desc') return (b.applicationDate || '').localeCompare(a.applicationDate || '');
          if (els.sort.value === 'updated-desc') return b.updatedAt - a.updatedAt;
          if (els.sort.value === 'company') return a.company.localeCompare(b.company, 'zh-CN');
          // 默认「最近安排优先」：分层比较，避免用 Number.MAX_SAFE_INTEGER 相加超过 2^53 丢精度
          // tier 0 = 未来安排（按时间升序，最近的最靠前）；tier 1 = 无安排（居中）；tier 2 = 已过期（置底）
          const now = Date.now();
          const rankOf = (rec) => {
            const t = parseLocal(rec.scheduleAt)?.getTime();
            if (t == null) return { tier: 1, time: 0 };
            return t >= now ? { tier: 0, time: t } : { tier: 2, time: t };
          };
          const ra = rankOf(a), rb = rankOf(b);
          if (ra.tier !== rb.tier) return ra.tier - rb.tier;
          if (ra.tier === 1) return 0;
          return ra.time - rb.time;
        });
        return filtered;
      }

      function render() {
        renderStats();
        refreshStageFilter();
        renderDistribution();
        renderInsights();
        renderRecordsView();
        renderUpcoming();
      }
      function renderStats() {
        const now = new Date();
        const sevenDays = new Date(now.getTime() + 7 * 86400000);
        els.total.textContent = records.length;
        els.today.textContent = records.filter(r => r.applicationDate === localDateInput(now)).length;
        els.active.textContent = records.filter(isActive).length;
        els.week.textContent = records.filter(r => { const d = parseLocal(r.scheduleAt); return d && d >= now && d <= sevenDays; }).length;
        els.offer.textContent = records.filter(r => r.stage === 'Offer').length;
      }

      function renderDistribution() {
        const counts = {};
        records.forEach(r => { const s = r.stage || '待投递'; counts[s] = (counts[s] || 0) + 1; });
        // 动态阶段集：仅展示有记录的阶段（含自定义），按 stageOrder 排序；空态回退到核心预设占位
        let stages = Object.keys(counts).sort((a, b) => stageOrder(a) - stageOrder(b) || a.localeCompare(b, 'zh-CN'));
        if (!stages.length) stages = ['待投递', '已投递', '一面', 'Offer', '已结束'];
        const max = Math.max(1, ...stages.map(s => counts[s] || 0));
        els.stageGrid.innerHTML = stages.map(stage => `
          <div class="stage-cell" data-stage="${escapeHtml(stage)}" title="${escapeHtml(stage)}：${counts[stage] || 0} 条">
            <div class="stage-meta"><span>${escapeHtml(stage)}</span><strong>${counts[stage] || 0}</strong></div>
            <div class="bar"><div class="bar-fill" data-stage="${escapeHtml(stage)}" style="width:${(counts[stage] || 0) / max * 100}%"></div></div>
          </div>`).join('');
      }

      // ===== 洞察面板（v4.4.0）：漏斗 / 节奏 / 停留 / 指标 / 卡点，全部由 records+timeline 派生 =====
      let funnelScope = 'record'; // 'record'（按投递记录）| 'company'（按公司去重）

      function renderInsights() {
        const body = $('#insightsBody');
        if (!body) return;
        // 精简/完整的按钮文案与折叠态先同步：首启引导分支会提前 return，
        // 放在后面会导致引导期间的按钮文案停留在 HTML 默认值「精简」而实际已是完整模式
        applyInsightsCompact();
        const guide = $('#firstRunGuide');
        // 首启引导：台账为空、或当前是自动塞入的示例数据时，用三步引导替换洞察内容（可「不再显示」）
        const showGuide = (records.length === 0 || sampleDataMode) && !uiPrefs.hideGuide;
        if (guide) guide.hidden = !showGuide;
        body.hidden = showGuide;
        if (showGuide) {
          const note = $('#guideNote'), actions = $('#guideActions');
          if (note) {
            note.innerHTML = sampleDataMode
              ? `<strong>当前是示例数据</strong>下面台账里的 ${records.length} 条（星海科技 / 山岚智能 / 青禾互娱 …）是首次打开自动放入的样例，只用于认识界面，不是你的投递记录。`
              : '<strong>开始记录你的秋招</strong>台账还是空的，新增第一条投递后，这里会自动算出转化漏斗、投递节奏与卡点提醒。';
          }
          if (actions) {
            actions.innerHTML = sampleDataMode
              ? `<button class="btn btn-primary btn-small" type="button" data-guide="clear">清空示例并开始记录</button>
                 <button class="btn btn-small" type="button" data-guide="keep">保留示例继续体验</button>
                 <button class="btn btn-small" type="button" data-guide="hide">不再显示</button>`
              : `<button class="btn btn-primary btn-small" type="button" data-guide="add">新增第一条投递</button>
                 <button class="btn btn-small" type="button" data-guide="demo">载入示例数据体验</button>
                 <button class="btn btn-small" type="button" data-guide="hide">不再显示</button>`;
          }
          return;
        }
        const now = new Date();
        const funnel = computeFunnel(records);
        const steps = funnelScope === 'company' ? funnel.byCompany : funnel.byRecord;
        $('#funnelNote').textContent = records.length ? (funnelScope === 'company' ? '公司去重口径' : '记录口径') : '还没有记录';
        const scopeBtn = $('#funnelScopeBtn');
        if (scopeBtn) scopeBtn.textContent = funnelScope === 'company' ? '切换为记录口径' : '切换为公司去重口径';
        $('#funnelRow').innerHTML = steps.map((step, index) => `
          <div class="funnel-step">
            <div class="funnel-label">${escapeHtml(step.label)}</div>
            <div class="funnel-value">${step.count}<span class="funnel-rate">${index === 0 ? '基准' : `${Math.round(step.rate * 100)}%`}</span></div>
            <div class="funnel-bar"><div class="funnel-bar-fill" style="width:${Math.max(step.rate * 100, step.count ? 3 : 0)}%"></div></div>
          </div>${index < steps.length - 1 ? '<div class="funnel-arrow" aria-hidden="true">→</div>' : ''}`).join('');

        const daily = computeDailyApplications(records, 14, now);
        const spark = sparklinePath(daily, 280, 46);
        $('#sparkSummary').textContent = records.length ? `共 ${spark.total} 条 · 单日最多 ${spark.max}` : '暂无数据';
        $('#sparkSvg').innerHTML = spark.line
          ? `<path d="${spark.area}" fill="var(--accent-soft)"></path><polyline points="${spark.line}" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"></polyline>${spark.dots.filter(dot => dot.count > 0).map(dot => `<circle cx="${dot.x}" cy="${dot.y}" r="2.1" fill="var(--accent)"><title>${escapeHtml(dot.date)}：${dot.count} 条</title></circle>`).join('')}`
          : '';
        $('#sparkStart').textContent = daily.length ? daily[0].date.slice(5).replace('-', '/') : '—';
        $('#sparkEnd').textContent = daily.length ? daily[daily.length - 1].date.slice(5).replace('-', '/') : '—';

        const dwell = computeStageDwell(records, 5);
        $('#dwellList').innerHTML = dwell.length
          ? dwell.map(item => `<div class="dwell-row"><span class="badge badge-sm" data-stage="${escapeHtml(item.stage)}">${escapeHtml(item.stage)}</span><strong class="dwell-days">${item.avgDays.toFixed(1)} 天</strong><span class="dwell-count">${item.count} 次流转</span></div>`).join('')
          : '<div class="insight-empty">至少要有两个带日期的阶段，才能算出停留时长</div>';

        const groups = groupRecordsByCompany(records);
        const multiCompanies = groups.filter(group => group.records.length > 1).length;
        const inFlow = records.filter(isActive);
        const flowDays = inFlow
          .map(record => { const d = parseDay(record.applicationDate); return d ? Math.max(0, -daysUntil(d, now)) : null; })
          .filter(value => value != null);
        const avgFlowDays = flowDays.length ? Math.round(flowDays.reduce((a, b) => a + b, 0) / flowDays.length) : 0;
        const alerts = collectAlerts(records, now, 5);
        const stalledCount = findStalled(records, now, 14).length;
        const cityStats = computeCityStats(records);
        const namedCities = cityStats.filter(row => row.city);
        const unknownCity = cityStats.find(row => !row.city);
        const offerCount = records.filter(record => record.stage === 'Offer').length;
        $('#insightMetrics').innerHTML = [
          { label: '覆盖公司', value: groups.length, sub: multiCompanies ? `${multiCompanies} 家投了多个岗位` : '每家一个岗位', tip: 'companies' },
          {
            label: '覆盖城市', value: namedCities.length,
            sub: namedCities.length
              ? `最多 ${namedCities[0].city} · ${namedCities[0].total} 条${unknownCity ? `，${unknownCity.total} 条没填` : ''}`
              : (unknownCity ? `${unknownCity.total} 条都还没填城市` : '还没填城市'),
            tip: 'cities'
          },
          { label: '在流程中', value: inFlow.length, sub: flowDays.length ? `平均已 ${avgFlowDays} 天` : '暂无进行中', tip: 'flow' },
          { label: '停滞 >14 天', value: stalledCount, sub: stalledCount ? '建议主动跟进' : '节奏正常', tip: 'stalled' },
          { label: '已拿 Offer', value: offerCount, sub: offerCount && records.length ? `占投递的 ${Math.round(offerCount / records.length * 100)}%` : '还没有 Offer', tip: 'offers' },
          // 卡点清单现在排在指标条上方（② 行动紧跟 ① 概览），文案不能再写「见下方」
          { label: '需要关注', value: alerts.length, sub: alerts.length ? '见上方清单' : '暂无卡点', tip: 'alerts' }
        ].map(metric => `<div class="insight-metric" tabindex="0" data-tip-kind="metric" data-tip-key="${escapeHtml(metric.tip)}" aria-label="${escapeHtml(metric.label)} ${metric.value}，查看口径说明">
            <div class="insight-metric-label">${escapeHtml(metric.label)}</div>
            <div class="insight-metric-value">${metric.value}</div>
            <div class="insight-metric-sub">${escapeHtml(metric.sub)}</div>
          </div>`).join('');

        $('#alertCount').textContent = alerts.length ? `${alerts.length} 条` : '';
        $('#alertList').innerHTML = alerts.length
          ? alerts.map(alert => `<button class="alert-item ${escapeHtml(alert.level)}" data-id="${escapeHtml(alert.id)}" type="button">${escapeHtml(alert.text)}</button>`).join('')
          : '<div class="insight-empty">没有逾期、临期或停滞的投递</div>';

        renderCityStats();
        renderCompanyTypeStats();
        renderOfferMatrix();
        renderMultiCompanies();
      }

      // 城市分布：行式条形（城市 | 双色条 | 投递 N | Offer M），Offer 段用 Offer 绿。
      // 明细挂在悬浮层上（data-tip-kind="city"），行本身不承载长清单，避免面板被撑高。
      function renderCityStats() {
        const list = $('#cityList'), note = $('#cityNote');
        if (!list) return;
        const stats = computeCityStats(records);
        const named = stats.filter(row => row.city);
        const unknown = stats.find(row => !row.city);
        if (!stats.length) { list.innerHTML = '<div class="insight-empty">还没有记录</div>'; if (note) note.textContent = '—'; return; }
        const max = Math.max(...named.map(row => row.total), 1);
        const rows = named.map(row => `
          <div class="city-row" tabindex="0" data-tip-kind="city" data-tip-key="${escapeHtml(row.city)}" role="button" aria-label="${escapeHtml(row.city)}：投递 ${row.total} 条，Offer ${row.offers} 条，查看明细">
            <span class="city-name">${escapeHtml(row.city)}</span>
            <span class="city-bar"><i class="city-bar-total" style="width:${Math.round(row.total / max * 100)}%"></i><i class="city-bar-offer" style="width:${Math.round(row.offers / max * 100)}%"></i></span>
            <span class="city-num">${row.total}</span>
            <span class="city-offer ${row.offers ? 'has' : ''}">${row.offers ? `Offer ${row.offers}` : '—'}</span>
          </div>`).join('');
        // 「没填城市」不是一座城市：灰显单列，并给出可执行的提示（补填后才能按城市看转化）
        const unknownRow = unknown && unknown.total
          ? `<div class="city-row is-unknown" tabindex="0" data-tip-kind="city" data-tip-key="" role="button" aria-label="${unknown.total} 条记录没填城市，查看明细">
              <span class="city-name">没填城市</span>
              <span class="city-bar"></span>
              <span class="city-num">${unknown.total}</span>
              <span class="city-offer">${unknown.offers ? `Offer ${unknown.offers}` : '—'}</span>
            </div>`
          : '';
        list.innerHTML = rows + unknownRow;
        if (note) {
          note.textContent = named.length
            ? `${named.length} 个城市 · 一条记录写了多个城市会各计一次`
            : (unknown && unknown.total ? `${unknown.total} 条都还没填城市` : '—');
        }
      }

      // 企业性质：一条 100% 堆叠比例条 + 图例数字。固定 4 段（含未设置），
      // 未设置占比高本身就是有用信息——它在提醒你去补填，否则这一维统计不出来。
      function renderCompanyTypeStats() {
        const bar = $('#ctypeBar'), legend = $('#ctypeLegend'), note = $('#ctypeNote');
        if (!bar || !legend) return;
        const stats = computeCompanyTypeStats(records);
        const total = stats.reduce((sum, row) => sum + row.total, 0);
        if (!total) {
          bar.innerHTML = '';
          legend.innerHTML = '<div class="insight-empty">还没有记录</div>';
          if (note) note.textContent = '—';
          return;
        }
        bar.innerHTML = stats.filter(row => row.total).map(row => `
          <i class="ctype-seg" data-ct="${escapeHtml(row.type)}" style="width:${(row.total / total * 100).toFixed(2)}%"
             tabindex="0" role="button" data-tip-kind="ctype" data-tip-key="${escapeHtml(row.type)}"
             aria-label="${escapeHtml(row.label)}：${row.total} 条，占 ${Math.round(row.total / total * 100)}%，查看公司清单"></i>`).join('');
        legend.innerHTML = stats.map(row => `
          <div class="ctype-legend-row ${row.total ? '' : 'is-empty'}" data-ct="${escapeHtml(row.type)}">
            <span class="ctype-dot"></span>
            <span class="ctype-label">${escapeHtml(row.label)}</span>
            <span class="ctype-num">${row.total} 条</span>
            <span class="ctype-offer ${row.offers ? 'has' : ''}">${row.offers ? `Offer ${row.offers}` : '—'}</span>
          </div>`).join('');
        const unset = stats[stats.length - 1];
        if (note) {
          note.textContent = unset && unset.total
            ? `${unset.total} 条未设置（占 ${Math.round(unset.total / total * 100)}%），编辑记录即可补填`
            : '全部记录都已标注';
        }
      }

      // 精简 / 完整切换：明细块（城市 / 企业性质 / 节奏 / 停留 / 多岗位 / Offer 对比）整体折叠。
      // 明细仍然照常渲染（只是容器 hidden），切回完整时不需要重算，也不会出现半渲染状态。
      function toggleInsightsCompact() {
        uiPrefs.insightsCompact = !uiPrefs.insightsCompact;
        saveUiPrefs();
        renderInsights();
      }
      function applyInsightsCompact() {
        const details = $('#insightDetails'), button = $('#insightsCompactBtn');
        const compact = !!uiPrefs.insightsCompact;
        if (details) details.hidden = compact;
        if (button) {
          button.textContent = compact ? '完整' : '精简';
          button.title = compact
            ? '展开完整洞察：城市分布 / 企业性质 / 投递节奏 / 各阶段停留 / 多岗位公司 / Offer 对比'
            : '精简模式只保留概览、需要关注与转化漏斗，把明细折起来';
        }
      }

      // ---- 悬浮明细浮层（v4.6.0）----
      // 全站共用一个浮层，内容在显示时按需构建：不预生成 DOM，记录变多也不会拖慢渲染。
      // 为什么不用原生 title：外观不可控、无法显示结构化明细（阶段徽章 / 两列键值）、
      // 有约 1 秒延迟、且移动端完全不生效——而城市与企业性质的明细正是多行结构。
      let tipTarget = null;
      function showTipFor(target) {
        const layer = $('#tipLayer');
        if (!layer || !target || !target.dataset) return;
        const kind = target.dataset.tipKind;
        if (!kind) return;
        const content = tipContentFor(records, kind, target.dataset.tipKey || '');
        // 没有明细可显示时不要弹一个空壳（例如未设置那一档一条都没有）
        if (!content) { hideTip(); return; }
        if (tipTarget && tipTarget !== target && tipTarget.removeAttribute) tipTarget.removeAttribute('aria-describedby');
        tipTarget = target;
        layer.innerHTML = content;
        layer.hidden = false;
        if (target.setAttribute) target.setAttribute('aria-describedby', 'tipLayer');
        // 必须在 hidden=false 之后量尺寸，否则拿到的是 0×0
        positionTip(target.getBoundingClientRect ? target.getBoundingClientRect() : null);
      }
      function hideTip() {
        if (tipTarget && tipTarget.removeAttribute) tipTarget.removeAttribute('aria-describedby');
        tipTarget = null;
        const layer = $('#tipLayer');
        if (!layer) return;
        layer.hidden = true;
        layer.innerHTML = '';
      }
      // 定位：默认贴在触发元素下方、左对齐；右侧或下方放不下时翻转/夹紧到视口内。
      // 用 fixed + getBoundingClientRect，因此不受洞察面板所在滚动容器的影响。
      function positionTip(rect) {
        const layer = $('#tipLayer');
        if (!layer || !rect) return;
        const gap = 8, edge = 8;
        const viewWidth = window.innerWidth || 1440;
        const viewHeight = window.innerHeight || 900;
        const box = layer.getBoundingClientRect ? layer.getBoundingClientRect() : { width: 0, height: 0 };
        let left = rect.left;
        let top = rect.bottom + gap;
        if (left + box.width > viewWidth - edge) left = Math.max(edge, viewWidth - edge - box.width);
        if (top + box.height > viewHeight - edge) top = Math.max(edge, rect.top - gap - box.height);
        layer.style.left = `${Math.round(left)}px`;
        layer.style.top = `${Math.round(top)}px`;
      }
      // 触屏没有 hover：点击切换显隐（再点一次同一个则关闭）
      function isCoarsePointer() {
        return !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
      }

      // Offer 对比矩阵：手里有 ≥2 个 Offer 时才出现，按意向度降序、同分按签约截止近的先
      function renderOfferMatrix() {
        const wrap = $('#offerMatrixWrap'), table = $('#offerMatrix');
        if (!wrap || !table) return;
        const offers = records.filter(record => record.stage === 'Offer');
        if (offers.length < 2) { wrap.hidden = true; table.innerHTML = ''; return; }
        const sorted = offers.slice().sort((a, b) => (Number(b.intent) || 0) - (Number(a.intent) || 0)
          || String(a.deadline || '9999-12-31').localeCompare(String(b.deadline || '9999-12-31')));
        wrap.hidden = false;
        table.innerHTML = `<thead><tr><th>公司 / 岗位</th><th>城市</th><th>薪资 / 待遇</th><th>意向度</th><th>签约截止</th><th>最新备注</th></tr></thead>
          <tbody>${sorted.map(record => {
            const dl = deadlineInfo(record.deadline);
            const notes = Array.isArray(record.notes) ? record.notes : [];
            const lastNote = notes.length ? notes[notes.length - 1].text : (record.nextAction || '—');
            return `<tr class="offer-row" data-id="${escapeHtml(record.id)}">
              <td data-label="公司 / 岗位"><div class="company">${escapeHtml(record.company)}${record.orgUnit ? `<span class="company-unit"> · ${escapeHtml(record.orgUnit)}</span>` : ''}${companyTypeChipHtml(record.companyType)}</div><div class="position">${escapeHtml(record.position || '—')}</div></td>
              <td data-label="城市">${escapeHtml(record.city || '—')}</td>
              <td data-label="薪资 / 待遇">${escapeHtml(record.salary || '—')}</td>
              <td data-label="意向度">${intentDotsHtml(record.intent) || '<span class="muted-text">未设</span>'}</td>
              <td data-label="签约截止">${record.deadline ? `<span class="deadline-hint ${dl ? dl.level : ''}">${escapeHtml(formatDate(record.deadline))}${dl ? ` · ${escapeHtml(dl.text.replace('截止 · ', ''))}` : ''}</span>` : '—'}</td>
              <td data-label="最新备注"><div class="next-action">${escapeHtml(lastNote)}</div></td>
            </tr>`;
          }).join('')}</tbody>`;
      }

      // 多岗位公司清单：一家公司投了 ≥2 个岗位时列出，每个岗位可直接点开详情抽屉。
      // 回答「这家公司我投了哪几个岗、各自到哪一步」——只有计数不够，得能看到明细。
      function renderMultiCompanies() {
        const wrap = $('#multiCompanyWrap'), list = $('#multiCompanyList'), note = $('#multiCompanyNote');
        if (!wrap || !list) return;
        const multi = groupRecordsByCompany(records).filter(group => group.records.length > 1);
        if (!multi.length) { wrap.hidden = true; list.innerHTML = ''; return; }
        wrap.hidden = false;
        if (note) note.textContent = `${multi.length} 家公司投了多个岗位`;
        list.innerHTML = multi.map(group => {
          const items = group.records.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          return `<div class="multi-company" style="--company-color:${companyColor(group.key)}">
            <div class="multi-company-head"><strong>${escapeHtml(group.label)}</strong><span class="multi-company-count">${group.records.length} 个岗位</span></div>
            <div class="multi-company-items">${items.map(record => `<button class="multi-company-item" type="button" data-id="${escapeHtml(record.id)}" data-tip-kind="record" data-tip-key="${escapeHtml(record.id)}" aria-label="${escapeHtml(record.company)} · ${escapeHtml(record.position || '未填岗位')}，悬浮看详情，点击打开抽屉">
              <span class="multi-company-pos">${escapeHtml(record.position || '未填岗位')}${record.orgUnit ? ` · ${escapeHtml(record.orgUnit)}` : ''}</span>
              <span class="badge badge-sm" data-stage="${escapeHtml(record.stage)}">${escapeHtml(record.stage)}</span>
            </button>`).join('')}</div>
          </div>`;
        }).join('');
      }

      // 空状态三态：首启（价值主张 + 双 CTA）/ 筛选无结果（回显条件 + 清除）/ 有数据（隐藏）
      function renderEmptyState(visibleCount) {
        const host = els.empty;
        if (!host) return;
        if (visibleCount > 0) { host.hidden = true; host.innerHTML = ''; return; }
        host.hidden = false;
        if (!records.length) {
          host.innerHTML = `<div class="empty-icon" aria-hidden="true"><svg><use href="#i-stack"/></svg></div>
            <div class="empty-title">还没有投递记录</div>
            <div class="empty-text">新增第一条投递，之后每次「推进」都会沉淀成里程碑时间线——转化率、停留天数与卡点提醒都由它算出来。</div>
            <div class="empty-actions">
              <button class="btn btn-primary" type="button" data-empty-action="add">新增投递</button>
              <button class="btn" type="button" data-empty-action="demo">载入示例数据体验</button>
            </div>`;
          return;
        }
        const bits = [];
        const keyword = els.search.value.trim();
        if (keyword) bits.push(`关键词「${keyword}」`);
        if (els.filter.value !== 'all') bits.push(`阶段「${els.filter.value}」`);
        host.innerHTML = `<div class="empty-icon" aria-hidden="true">⌕</div>
          <div class="empty-title">没有符合条件的记录</div>
          <div class="empty-text">当前筛选：${bits.length ? escapeHtml(bits.join(' + ')) : '无'} · 台账共 ${records.length} 条</div>
          <div class="empty-actions"><button class="btn" type="button" data-empty-action="clear">清除筛选条件</button></div>`;
      }

      // 清空示例数据：写 tombstone 后再清空，避免已开云同步时下次合并又把示例拉回来
      function clearSampleData() {
        const ids = records.map(record => record.id);
        if (ids.length) markDeleted(ids);
        records = [];
        setSampleMode(false);
        saveRecords('已清空示例数据');
        render();
        showToast('示例数据已清空，现在记录你自己的投递');
        openDialog(null);
      }
      // 载入示例数据体验：只在台账为空时允许，绝不覆盖真实记录
      function loadDemoRecords() {
        if (records.length) { showToast('台账已有记录，为避免覆盖不载入示例'); return; }
        records = exampleRecords().map(item => normalizeRecord(item));
        setSampleMode(true);
        saveRecords('已载入示例数据（可随时清空）');
        render();
      }

      // 台账单行 HTML（表格视图）；companyIndex/groupKeyById 用于「同公司多岗位」chip 与公司配色
      function recordRowHtml(record, recordNo, companyIndex, groupKeyById) {
        const scheduleDate = parseLocal(record.scheduleAt);
        const overdue = scheduleDate && scheduleDate < new Date() && !['Offer', '已结束'].includes(record.stage);
        const canAdvance = record.stage !== '已结束';
        const dl = deadlineInfo(record.deadline);
        const dlHtml = dl && !['Offer', '已结束'].includes(record.stage)
          ? `<div class="deadline-hint ${dl.level}">${escapeHtml(dl.text)}</div>` : '';
        const companyHtml = record.applicationUrl
          ? `<a class="company-link" href="${escapeHtml(record.applicationUrl)}" target="_blank" rel="noopener noreferrer" title="打开投递网页">${escapeHtml(record.company)} ↗</a>`
          : escapeHtml(record.company);
        // 同公司多岗位：chip 显示该公司在台账里的岗位数，title 列出岗位与阶段。
        // 用聚类的规范键（不是查专用的激进 slug），避免「星海科技 / 星海互娱」被并成一家。
        const key = (groupKeyById && groupKeyById.get(record.id)) || companyGroupKey(record);
        const siblings = (companyIndex && companyIndex.get(key)) || [];
        const chipHtml = siblings.length > 1
          ? `<span class="company-chip" style="--company-color:${companyColor(key)}" title="${escapeHtml(siblings.map(item => `${item.position || '未填岗位'}${item.orgUnit ? `（${item.orgUnit}）` : ''} · ${item.stage}`).join('\n'))}">+${siblings.length - 1} 岗位</span>`
          : '';
        return `<tr data-id="${escapeHtml(record.id)}" data-is-offer="${record.stage === 'Offer'}" data-company="${escapeHtml(key)}">
          <td data-label="编号"><span class="record-no">#${recordNo.get(record.id) || '0000'}</span></td>
          <td data-label="公司 / 岗位"><div class="company">${companyHtml}${record.orgUnit ? `<span class="company-unit"> · ${escapeHtml(record.orgUnit)}</span>` : ''}${chipHtml}${companyTypeChipHtml(record.companyType)}</div><div class="position">${escapeHtml(record.position)}</div></td>
          <td data-label="城市">${escapeHtml(record.city)}</td>
          <td data-label="投递日期">${escapeHtml(formatDate(record.applicationDate))}</td>
          <td data-label="当前阶段"><span class="badge" data-stage="${escapeHtml(record.stage)}" title="${escapeHtml((record.timeline || []).map(m => `${m.stage}${m.at ? ' · ' + m.at : ''}${m.note ? '（' + m.note + '）' : ''}`).join('  →  ') || record.stage)}">${escapeHtml(record.stage)}</span></td>
          <td class="schedule" data-label="最近安排"><div class="schedule-time ${overdue ? 'overdue' : ''}">${escapeHtml(formatDateTime(record.scheduleAt))}${overdue ? ' · 已到期' : ''}</div><div class="schedule-text">${escapeHtml(record.recentSchedule || '—')}</div>${dlHtml}</td>
          <td data-label="下一步行动"><div class="next-action">${escapeHtml(record.nextAction || '—')}</div></td>
          <td data-label="操作"><div class="row-actions">
            ${canAdvance ? `<button class="btn btn-soft btn-small" data-action="advance" data-id="${escapeHtml(record.id)}" type="button">推进</button>` : ''}
            <button class="text-button" data-action="edit" data-id="${escapeHtml(record.id)}" type="button">编辑</button>
            <button class="text-button danger" data-action="delete" data-id="${escapeHtml(record.id)}" type="button">删除</button>
          </div></td>
        </tr>`;
      }

      // 收纳开启时把同一企业的记录**聚拢**：组间顺序 = 该企业第一条记录在当前排序里的位置，
      // 组内保持当前排序的相对顺序（Map 保留插入序，所以一次遍历就够）。
      // 不做这一步的话，非公司类排序（如默认的「最近安排优先」）下同企业的记录本来就不相邻，
      // 逐行遍历会为同一家企业插出好几个重复组头 —— 这正是「分组」与「排序」解耦后必须补的一环。
      function clusterByCompanyGroup(list, groupKeyById) {
        const buckets = new Map();
        for (const record of list) {
          const key = groupKeyById.get(record.id) || companyGroupKey(record);
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(record);
        }
        return [...buckets.values()].flat();
      }

      // 企业组头行。colspan=8 与表头列数一致，改列数要同步改这里（漏改会让组头只占一列宽）。
      function companyGroupRowHtml(key, company, count, isCollapsed) {
        return `<tr class="company-group-row" data-group="${escapeHtml(key)}"><td colspan="8">
          <button class="group-toggle" type="button" data-group-toggle="${escapeHtml(key)}" aria-expanded="${String(!isCollapsed)}">
            <span class="group-caret" aria-hidden="true">${isCollapsed ? '▸' : '▾'}</span>
            <span class="group-label" style="--company-color:${companyColor(key)}">${escapeHtml(company)}</span>
            <span class="group-count">${count} 个岗位</span>
          </button>
        </td></tr>`;
      }

      // 机构（orgUnit）**不单独成层**：它已经印在每一行的公司名后面（recordRowHtml 的
      // .company-unit），再套一层可折叠的机构组头只是把明细往右推、多一次点击，信息量为零。
      // 所以这里只有企业组头一个层级；机构的价值在查重（公司+机构+岗位三要素）与逐行辨识上。
      function renderTable() {
        const visible = getVisibleRecords();
        // 台账编号 = 「这是我第几次投递」：按投递日期**升序**，最早的 = #0001。
        // 刻意不用 updatedAt——编辑任何一条记录都会刷新它，用它编号会让被编辑的那条跳到 #0001、
        // 其余全部顺移（旧实现正是这样，注释却写着「编辑不会重排」，与实现互相矛盾）。
        // applicationDate 是用户填的投递日期，改备注/推进阶段都不会动它，所以编号真正稳定。
        // 日期是 YYYY-MM-DD 字符串，localeCompare 等价于时间序，不需要 parseDay。
        // 同一天多次投递用 id 字典序兜底，保证同一份数据每次渲染编号一致。
        // 编号是**派生值、不存储**，所以换算法不需要数据迁移，也不影响云同步。
        const recordNo = new Map(
          [...records].sort((a, b) => String(a.applicationDate || '').localeCompare(String(b.applicationDate || ''))
            || String(a.id).localeCompare(String(b.id)))
            .map((record, index) => [record.id, String(index + 1).padStart(4, '0')])
        );
        // 公司索引按**全量台账**统计（不是只按筛选结果），chip 才能回答「我在这家一共投了几个岗」
        const groups = groupRecordsByCompany(records);
        const companyIndex = new Map(groups.map(group => [group.key, group.records]));
        const groupKeyById = companyGroupIndex(records);
        // v4.11.0：分组由独立开关决定，不再看排序下拉（两者正交，见 getVisibleRecords 的注释）
        const grouped = !!uiPrefs.groupByCompany;
        const ordered = grouped ? clusterByCompanyGroup(visible, groupKeyById) : visible;
        const collapsed = new Set(uiPrefs.collapsedGroups);
        const rows = [];
        let lastKey = null;
        for (const record of ordered) {
          const key = groupKeyById.get(record.id) || companyGroupKey(record);
          if (grouped && key !== lastKey) {
            lastKey = key;
            const siblings = companyIndex.get(key) || [];
            rows.push(companyGroupRowHtml(key, record.company, siblings.length, collapsed.has(key)));
          }
          if (grouped && collapsed.has(key)) continue;   // 该企业已折叠：跳过它的全部明细行
          rows.push(recordRowHtml(record, recordNo, companyIndex, groupKeyById));
        }
        els.body.innerHTML = rows.join('');
        els.empty.hidden = visible.length !== 0;
        $('#recordsTableScroll').hidden = visible.length === 0;
      }

      function renderUpcoming() {
        // 统一事件流：安排时间 + 截止日期一起排（逾期置顶），最多 6 项
        const events = collectScheduleEvents(records, new Date(), 6);
        if (!events.length) {
          els.upcoming.innerHTML = '<div class="side-empty">近期还没有安排或截止<br>新增 / 编辑记录时填写「安排时间」或「截止日期」</div>';
          return;
        }
        els.upcoming.innerHTML = events.map(ev => {
          const r = ev.record;
          const d = ev.at;
          const diff = daysUntil(d);
          const isDeadline = ev.type === 'deadline';
          const when = ev.overdue
            ? `已过期${diff < 0 ? ` ${-diff} 天` : ''}`
            : (diff === 0 ? '就是今天' : (diff > 0 && diff <= 3 ? `还剩 ${diff} 天` : (ev.allDay ? formatDate(localDateInput(d)) : formatDateTime(r.scheduleAt))));
          return `<article class="schedule-item${isDeadline ? ' is-deadline' : ''}${ev.overdue ? ' is-overdue' : ''}" data-id="${escapeHtml(r.id)}" role="button" tabindex="0" title="查看详情">
            <div class="date-tile"><div class="date-month">${d.getMonth() + 1} 月</div><div class="date-day">${d.getDate()}</div></div>
            <div class="schedule-body">
              <div class="side-company">${escapeHtml(r.company)} · ${escapeHtml(r.position)} <span class="badge badge-sm" data-stage="${escapeHtml(r.stage)}">${escapeHtml(r.stage)}</span></div>
              <div class="side-detail"><span class="side-kind">${isDeadline ? '截止' : '安排'}</span>${escapeHtml(isDeadline ? (r.deadline || '') : (r.recentSchedule || r.nextAction || '待处理安排'))}</div>
              <div class="side-time${ev.overdue ? ' overdue' : ''}">${escapeHtml(when)}</div>
            </div>
          </article>`;
        }).join('');
      }

      // 记录聚焦入口：未来安排卡片 / 看板卡片 / ⌘K 命令面板 / 洞察卡点清单统一走这里，
      // 避免多处各写一套打开逻辑。v4.4.0 起打开详情抽屉（而不是直接进编辑弹窗）。
      function openRecordFocus(id) {
        const record = records.find(item => item.id === id);
        if (!record) return;
        openRecordDrawer(record.id);
      }

/*__MODULE:core__*/
