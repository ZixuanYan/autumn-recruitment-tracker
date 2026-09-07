# autumn-mail-sync

把 QQ 邮箱里的招聘邮件（面试 / 笔试 / 测评 / Offer / 拒信）自动解析成**结构化建议**，写进你自己的私有 Gist 文件 `mail-suggestions.json`。网页端 **[秋招投递管理](../autumn-recruitment-tracker)** 在云同步时顺带读取它，在新增的「邮件提醒」视图里**逐字段人工复核**后并入投递台账。

> 本仓库必须建成 **私有仓库**：QQ 授权码、AI Key、Gist PAT 都放在这里的 Secrets，**永不进浏览器、永不进网页 localStorage、永不进 vault**。

## 架构（A2）

```
定时/手动 GitHub Action（本私有仓库）
  → IMAP 增量拉 QQ 邮箱（imap.qq.com:993 TLS + RFC2971 ID 命令破 "Unsafe Login"）
  → 关键词预筛（降噪、省 token）
  → AI（DeepSeek / OpenAI 兼容）判定归属 + 阶段 + 细节
  → 只 PATCH 用户现有私有 Gist 的独立文件 mail-suggestions.json（永不读写 vault）
网页端 syncNow 顺带读取该文件
  → 第 5 视图「邮件提醒」#/mail
  → 用本地台账模糊匹配（公司名归一化 + Dice 相似度）
  → 人工逐字段勾选复核
  → setTimeline / saveRecords 落库（触发快照 + 云同步）
```

**不变量**：① 一切更新经人工复核，无免复核自动写入；② AI 不编造，阶段仅限 14 个 `STAGE_PRESETS`；③ 密钥只在私有仓库 Secrets；④ Action 与网页按文件分别 PATCH 同一 Gist，互不覆盖；⑤ 授权码失效等失败写进 `meta.lastError` 并在网页上屏提示。

## 你需要做的 M0 步骤（人工闸门，Agent 无法代做）

M0 目的：在投入真实联调前，验证最脆弱的假设——**QQ 授权码能否从 GitHub-hosted runner（境外 Azure IP）经 IMAP 登录成功**。

1. **建私有仓库**：在 GitHub 新建 **private** 仓库 `autumn-mail-sync`，把本目录代码推上去（`git init && git remote add origin … && git push`，由你手动执行）。
2. **QQ 邮箱开启 IMAP 并生成授权码**：
   - 登录 QQ 邮箱网页版 → 设置 → 账户 → 开启「IMAP/SMTP 服务」；
   - 按提示用手机发短信验证，得到一个 **16 位授权码**（不是 QQ 密码）；
   - ⚠️ 改 QQ 密码后授权码会失效，需重新生成。
3. **准备 AI Key**：一个 DeepSeek（`https://platform.deepseek.com`）或阿里百炼（DashScope 兼容模式）的 API Key。
4. **拿到现有同步 Gist 的 GIST_ID**：网页端「工具 → 云同步」里能看到，或从 Gist URL `https://gist.github.com/<user>/<GIST_ID>` 取。必须与网页端用的是**同一个** Gist。
5. **准备一个 gist 权限的 PAT**：GitHub → Settings → Developer settings → Personal access tokens → 勾选 **gist**。
6. **在本私有仓库配置 Secrets**（Settings → Secrets and variables → Actions → New repository secret）：

   | Secret | 说明 | 示例 |
   |---|---|---|
   | `QQ_EMAIL` | QQ 邮箱地址 | `123456789@qq.com` |
   | `QQ_AUTHCODE` | 16 位 IMAP 授权码 | `abcdefghijklmnop` |
   | `AI_BASE_URL` | OpenAI 兼容基址 | `https://api.deepseek.com` |
   | `AI_API_KEY` | AI 密钥 | `sk-…` |
   | `AI_MODEL` | 模型名 | `deepseek-chat`（百炼填 `qwen-plus`） |
   | `GIST_ID` | 现有同步 Gist 的 ID | `a1b2c3…` |
   | `GIST_PAT` | 有 gist 权限的 PAT | `ghp_…` |
   | `MAIL_ENC_KEY` | （可选）加密 `mail-suggestions.json` 的密钥；网页端「设置」填**完全相同**的密钥才能解密。留空=明文 | 随机长串（网页可「生成」）|

   > 换百炼：`AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`、`AI_MODEL=qwen-plus`。
   > 不配 `AI_API_KEY` 也能跑（M1 占位启发式：粗提取公司、不判阶段、confidence=0），配了才启用 M2 真实 AI 分析。

7. **手动跑连通性验证**：Actions → `connectivity-test` → Run workflow（`workflow_dispatch`）。
   - ✅ 日志出现「登录成功 + INBOX 邮件数 + 最近 3 封主题」→ **闸门通过**，可手动跑 `mail-sync` 进入真实联调。
   - ❌ 报 `Unsafe Login` / 异地登录 / 验证失败 → **闸门不通过**，见下方「M0 失败怎么办」。

## M0 失败怎么办（QQ 风控挡住境外 IP）

脚本**宿主无关**，登录被挡时可整体搬到国内宿主，代码几乎不用改：

- **自建 runner**：给本仓库挂一台国内机器作 self-hosted runner，workflow 里 `runs-on: self-hosted`。
- **阿里云函数计算 / 腾讯云 SCF**：把 `index.js` 的 `run()` 包成定时函数入口，用同样的 env 注入密钥。
- **国内 VPS + cron**：`npm i` 后 `crontab` 每小时 `node index.js`。
- 或**退回 B 手动导入**方案（不用本仓库）。

## 用法

```bash
npm install                 # 安装 imapflow + mailparser
node src/connectivity-test.js   # M0 连通性（需 QQ_EMAIL/QQ_AUTHCODE）
node index.js               # 跑一轮同步（需全部 Secrets）
node index.js --report-error    # 兜底：把 meta 标记为 error（workflow failure() 调用）
npm run check               # node --check 全部脚本
npm test                    # 纯函数单测（不触网、不依赖 IMAP/AI）
```

- **定时**：`mail-sync.yml` 用 `cron: '23 */12 * * *'`（每 12 小时：UTC 00:23 与 12:23）。招聘高峰可改回每小时 `'23 * * * *'`（风控与实时性权衡）。GitHub 的 schedule 在高峰期常延迟 2–4 小时，属平台侧行为，改 cron 无法解决。
- **手动**：`workflow_dispatch` 可传 `SINCE_DAYS` / `MAX_PER_RUN` / `UID_FROM` 覆盖默认值。
- **回溯**：填 `UID_FROM`（如 `1877`）会**忽略云端水位**、从该 UID 起重新扫描，用于捞回被误杀、水位已永久越过的邮件；建议同时把 `MAX_PER_RUN` 调大（否则一次只重扫 30 封）。网页端状态栏的丢弃明细里带每封邮件的编号，照着填即可。
- **保活**：GitHub Actions 对 **60 天无活动**的仓库会**停用定时 workflow**，需偶尔手动 dispatch 一次保活。

## 建议文件契约 `mail-suggestions.json`

```jsonc
{
  "meta": {
    "version": 1, "lastRunAt": "ISO", "lastStatus": "ok|error", "lastError": "",
    "lastUidValidity": 0, "lastUid": 0, "newCount": 0, "pendingCount": 0,
    // v0.3.0 新增：本次丢弃统计。网页端状态栏据此显示「丢弃 N 封」并可展开明细。
    // 老文件没有该字段时网页端静默降级（不显示该段）；--report-error 兜底时保留上一次的值。
    "lastDropped": {
      "total": 0,
      "noiseFrom": 0,      // 发件人命中 FROM_NOISE_PATTERN
      "noiseSubject": 0,   // 主题命中 SUBJECT_NOISE_PATTERN
      "noKeyword": 0,      // 主题+正文都没命中 KEYWORDS
      "aiNotRecruit": 0,   // AI 明确判定 isRecruitment=false
      "lowConf": 0,        // AI 置信度低于 MIN_CONFIDENCE
      "aiError": 0,        // AI 调用失败（同时写进 lastError）
      "recent": [{ "uid": 0, "from": "", "subject": "(≤60)", "reason": "noise-from|…" }]  // 上限 20 条，按 uid 倒序
    }
  },
  "suggestions": [{
    "id": "uid-<sourceUid>", "sourceUid": 0, "receivedAt": "ISO", "from": "", "subject": "",
    "emailType": "测评|笔试|机试|面试邀请|Offer|拒信|其它",
    "isRecruitment": true,   // v0.3.0 新增，落盘备查；能入队的一律为 true
    "company": "", "position": "", "stage": "(STAGE_PRESETS 之一或空)",
    "scheduleAt": "YYYY-MM-DDTHH:mm|空", "location": "", "round": "",
    "summary": "(≤60)", "confidence": 0,
    "proposed": {
      "milestone": { "stage": "", "at": "YYYY-MM-DD", "note": "邮件·<类型>" },
      "scheduleAt": "", "recentSchedule": "", "nextAction": ""
    }
  }]
}
```

- **增量**：`meta.lastUidValidity/lastUid` 是高水位，按 **UID**（邮件序号）而非时间戳判断新旧；`UIDVALIDITY` 变化则回退到 `SINCE_DAYS` 全量重扫并重置水位。`receivedAt` 只用于 prune 与排序，不参与增量判断。
- **水位会推过被丢弃的邮件**：`computeWatermark` 取本次已抓取的最大 UID，不论是否成为候选。这是刻意的（避免非候选邮件被反复重扫），但意味着**被误杀的邮件不会自动回来**，只能用 `UID_FROM` 回溯。
- **去重**：按 `sourceUid` 合并，`id` 稳定为 `uid-<sourceUid>`，网页端的「已应用/已忽略」按 id 记忆，建议被重新分析也不会复活。
- **重扫即重新裁决**（v0.3.0）：合并时会拿到本轮扫描过的 UID 集合——本轮扫过、但重新判定后未入选的旧建议会被**移除**（否则用 `UID_FROM` 回溯只能新增建议、无法纠正已入库的营销邮件）；本轮没扫到的一律保留，不下结论。
- **prune**：只保留近 30 天、最多 100 条。
- **隐私**：`lastDropped.recent` 含发件人与主题，与 `suggestions` 里已有的字段属同类数据，不新增暴露面；配了 `MAIL_ENC_KEY` 时一并加密。

## 预筛规则与取舍（v0.3.0 重构）

预筛的目的是**省 token**，不是保证准确性——准确性由 AI 与网页端人工复核把关。两类错误的代价严重不对称：

| 错误 | 代价 |
|---|---|
| 误放行一封营销邮件 | 几分钱 token；后面还有 AI 的 `isRecruitment` 判定、`MIN_CONFIDENCE` 阈值、网页端人工复核三道拦截 |
| 误杀一封真面邀 | **不可逆**：水位推过就永不回看，且用户无从察觉（v0.3.0 之前连日志都没有） |

所以规则按「宁可多放行」设计，判定顺序如下（`src/prefilter.js` 的 `classifyMail`）：

1. 主题命中 `STRONG_SIGNAL_PATTERN`（面试邀请 / 笔试通知 / 录用通知 / 测评通知 / 意向书 / 校园招聘 / offer …）→ **无条件放行**，不看任何噪声表
2. 发件人命中 `FROM_NOISE_PATTERN`（只有 `postmaster` / `mailer-daemon` / `newsletter` / `unsubscribe` / `list-subscribe` 这类确定性垃圾标记）→ 丢
3. 主题命中 `SUBJECT_NOISE_PATTERN`（营销 / 推广 / 广告 / 退订 / 限时 / 优惠 / 信用卡 / 理财 / 定期存款 …）→ 丢
4. 主题或正文命中 `KEYWORDS` → 放行；否则丢

两张噪声表**刻意不含** noreply 家族与「服务通知 / 通知中心」：

- `noreply` / `no-reply` / `donotreply` 是招聘系统通知的常态发件人（Moka、北森、牛客、各大厂校招门户都是），旧版把它当噪声导致 21 个真实招聘地址误杀 18 个
- 「服务通知 / 通知中心」是招聘门户常用的主题前缀

`test/run.js` 里有一条守卫断言逐个检查这 21 个真实地址必须全部通过预筛——任何人再把 noreply 加回噪声表都会立刻测试失败。

## 默认值（可调）

`SINCE_DAYS=30`、`MAX_PER_RUN=30`、`MIN_CONFIDENCE=0.3`、`UID_FROM=`（留空=正常按水位增量）、`IMAP_HOST=imap.qq.com`、`IMAP_PORT=993`、`KEYWORDS=面试|笔试|机试|测评|录用|应聘|招聘|校招|网申|入职|简历|interview`（已收紧：去掉了易命中营销/理财邮件的 `评估|offer|assessment`；如需微调，可新增一个 `KEYWORDS` Secret 覆盖，留空则用此默认值）。低于 `MIN_CONFIDENCE` 的建议直接丢弃；`0.3~0.6` 之间的仍进队列但网页端标黄（你要人工复核）。AI 明确判定 `isRecruitment=false` 的也直接丢弃（v0.3.0 之前这道过滤不存在）。邮件正文解析上限 8000 字。

## 网页端可视化配置（mail-config.json）

网页「邮件提醒 → 设置」可把**非密钥**的可调项写进你 Gist 的 `mail-config.json`（明文），Action 每次运行先读它、覆盖默认值：

- `keywords`（预筛关键词）、`minConfidence`、`sinceDays`、`maxPerRun`
- `enabled`（false → Action 直接跳过，**0 token**）
- `minIntervalHours`（距上次运行不足该小时数则跳过，**0 token**）——用它变相控制拉取频率，无需改 cron
- `promptExtra`（在内置系统提示词后**追加**你的要求，如"只关注互联网/国企"；不替换、不破坏"仅返回 JSON"契约）

优先级：`mail-config.json` > 环境变量/Secret（如 `KEYWORDS`）> 代码默认值。密钥类（QQ/AI/PAT/MAIL_ENC_KEY）**不在**此文件，只能在 Secrets。

## 邮件建议加密（MAIL_ENC_KEY）

GitHub 的 **secret gist 并非真私有**——凭 URL 即可访问。为避免 `mail-suggestions.json`（明文含发件人/主题/摘要）被凭 Gist ID 读到，可启用加密：

1. 网页「设置 → 邮件解密密钥」点「生成」得到一串密钥；
2. 把**同一串**填进本仓库 `MAIL_ENC_KEY` Secret，并在网页保存；
3. 之后 Action 用 AES-GCM-PBKDF2（与网页 vault 同款算法/格式，见 `src/crypto.js`）加密写入，网页用同一把密钥解密查看。

留空 `MAIL_ENC_KEY` = 明文（向后兼容）。密钥只存仓库 Secret 与网页本机 localStorage，**绝不写进 Gist**。

## 作为模板供他人自托管（BYO）

本仓库代码**不含任何密钥**，可作为模板让他人 fork 自托管（网页端读的是"当前用户自己的 Gist"，天然多租户，无需改网页）：

1. fork / 复制本仓库 → **务必设为 private**（⚠️ 公开仓库的 workflow 运行日志是公开的，而 `connectivity-test` 会打印真实邮件主题/发件人）；
2. 在自己的私有仓库配 8 个 Secrets（含可选 `MAIL_ENC_KEY`）；
3. 先跑 `connectivity-test`（M0）验证能登录，再启用 `mail-sync` 定时；
4. 打开同一个公开网页 → 云同步填自己的 PAT → 「邮件提醒」即读自己的 Gist。

> 维护提示：他人实例与本模板代码需各自维护；如本仓库升级，fork 方自行同步。

## 故障排查

| 现象 | 原因 / 处理 |
|---|---|
| `Unsafe Login` | QQ 风控。已发 ID 命令仍被挡 → 转国内宿主（见上）。 |
| 网页「邮件提醒」显示授权码可能失效 | 改了 QQ 密码 → 重新生成 16 位授权码，更新 `QQ_AUTHCODE` Secret。 |
| `GIST_ID 不存在` / 401 | `GIST_PAT` 无 gist 权限或过期；`GIST_ID` 与网页端不是同一个 Gist。 |
| AI HTTP 4xx/超额 | 检查 `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL`；软失败会写进 `meta.lastError` 上屏，不影响已抓取。 |
| 定时不触发 | 仓库 60 天无活动被停用；手动 dispatch 保活，或检查 Actions 是否被禁用。 |
| **感觉漏了某封招聘邮件** | 先看网页端「邮件提醒」状态栏的**丢弃 N 封**明细（发件人 / 主题 / 原因 / 邮件编号），或看 Actions 日志里的 `[sync] 丢弃 uid=… reason=…` 逐条记录。确认是误丢后，手动运行 `mail-sync` 并填 `UID_FROM=<该邮件编号>` + 调大 `MAX_PER_RUN` 回溯重扫——常规增量运行不会回头看已被水位越过的邮件。若原因反复是 `no-keyword`，在网页「邮件提醒 → 设置」里给 `keywords` 补词即可（无需改代码）。 |
| 建议队列里有营销/理财邮件 | v0.3.0 起有三道拦截：主题噪声表（限时/优惠/信用卡/理财…）、AI 的 `isRecruitment` 判定、`MIN_CONFIDENCE` 阈值。仍漏进来的话，用 `UID_FROM` 回溯重扫即可清掉——重扫是「重新裁决」，本轮扫过但未入选的旧建议会被移除。 |

## 隐私

- 邮件正文只发往**你自己配置**的 AI 端点（`AI_BASE_URL`）用于解析；建议结果明文存于**你的私有 Gist**（不加密，避免把同步口令放进 CI）。
- 本仓库永不读取或写入网页端的 vault 文件；两者按文件分别 PATCH 同一 Gist，互不覆盖。
