# 秋招求职与简历助手（Chrome/Edge 扩展 v5.0.0）

网申页采集端浏览器扩展（Manifest V3）：**简历字段点击速填 + 岗位一键收录 + 暂存箱**。与网页版 [秋招投递管理器](https://github.com/ZixuanYan/autumn-recruitment-tracker) 配套使用，插件负责采集与速填，网页版负责管理与跨设备同步。

> 本目录是 monorepo `autumn-recruitment-tracker` 的浏览器扩展部分（网页版管理器在仓库根目录）。安装：Chrome/Edge 扩展页开启开发者模式 →「加载已解压的扩展程序」→ 选择本 `extension/` 文件夹。

> **v5.0.0 重大调整**：完整 UI 从「注入网页的全高抽屉」搬到 **Chrome 原生 Side Panel**（侧边面板）。抽屉浮在页面之上、位置写死不能移动，正在填的网申表单被挡住一半；Side Panel 由浏览器管理，压缩页面宽度而不是覆盖页面，于是「一边看表单、一边点字段填入」第一次真正成立。页面上只保留一个**可拖拽吸边的收录胶囊**。同时整套样式重做为设计令牌体系，去掉了渐变、毛玻璃、彩色阴影与 18 处 emoji 图标。

> v3.0.0 重大调整：本扩展聚焦为纯采集端。投递看板、简历编辑器、OCR 与云同步已移除，统一由网页版管理器承担；简历在网页版编辑后自动下发到本扩展供填表使用。

## UI 形态：三层职责

| 载体 | 入口 | 职责 | 遮挡页面吗 |
| --- | --- | --- | --- |
| **Side Panel**（侧边面板） | 点浏览器工具栏的扩展图标，或快捷键 `Ctrl/⌘+Shift+F` | 完整功能：一键收录、暂存箱、简历字段库速填、打开网页版 | **不遮挡**（浏览器压缩页面宽度），宽度可拖分隔条调整，跨标签页保持打开 |
| **收录胶囊 + 迷你卡片** | 页面上那个可拖拽的小标签，点它弹出紧凑表单 | 只做收录：识别当前页 → 核对/补填 → 存入 | 卡片仅 300px 宽，且**位置跟随胶囊**——把胶囊拖到页面空白处，表单就落在空白处 |
| Shadow DOM 隔离 | — | 胶囊与迷你卡片都渲染在 `attachShadow` 里 | 与任意招聘网站的 CSS 完全隔离，互不污染 |

胶囊位置会记住（存 `chrome.storage.local`），刷新页面、换个网站都保持在你上次放的地方；拖动支持鼠标与触摸，松手自动吸附到更近的左/右边缘。

> 为什么胶囊不能用来打开 Side Panel：`chrome.sidePanel.open()` 要求 user gesture，从页面里的点击转发到 background 再调用会**丢失手势**而失败。所以胶囊只承担收录，面板入口是工具栏图标与浏览器级快捷键（`chrome.commands` 的触发算手势，可以直接调 `open()`）。

## 核心特性

1. **简历字段点击速填**（在 Side Panel 里）
   - **左键点字段** → 填入你最后聚焦的输入框（原生 value Setter + `input`/`change` 事件，兼容 React/Vue 受控组件；无聚焦框时回退到复制剪贴板并如实告知）
   - **右键点字段** → 复制该字段内容到剪贴板
   - 顶部**搜索框**按字段名/内容即时过滤，命中的分组自动展开
   - 面板顶部有**当前页状态条**：切到浏览器内部页或网页版管理器时会禁用速填并说明原因，不会让你对着错误的页面点半天
   - 只填入你在简历中真实填写的内容，**跨站通用、零误填风险、纯离线**（不依赖标签识别/自动匹配）
2. **岗位一键智能收录**
   - 内置北森、Moka、大易、用友、24Talent 五家国内主流招聘系统专有解析器，外加 BOSS直聘 / 牛客 / 实习僧 / 猎聘 四家招聘平台解析器，以及 JSON-LD / OpenGraph / 面包屑 / logo 通用兜底
   - **候选打分调度**：同一字段可能来自多个来源，按可信度取最高（结构化数据 > ATS 解析器 > 官方域名 > 页面 Logo > 语义元素 > 面包屑 > 主标题 > 网页标题），而不是「先到先得」
   - **宁空勿错**：识别不出的字段留空，收录表单会用告警提示条明确列出「未能识别：公司名称 / 目标城市」并要求人工补填，同时标注每个已识别字段来自页面哪里
   - **岗位名保留括号修饰**：`后端开发工程师（深圳）`、`客户端开发（iOS）`、`产品经理（提前批）` 原样保留——括号里是同一家公司多个岗位的关键区分维度，删掉会导致第二个岗位被判成重复而录不进去
   - 收录时自动查重：同链接或「同公司 + 同岗位」的记录更新而非重复堆积；同公司的**另一个**岗位正常入库
   - **企业性质可直接选**（v4.2.0）：收录表单有「央国企 / 民企 / 外企」下拉，选完随记录一起进网页端台账，网页端洞察的「企业性质」统计就有数据了。**刻意不做自动识别**——页面上没有可靠依据判断企业性质，猜错比留空更糟；因此识别全中时提示条会写「企业性质需手动选一次」，免得用户注意不到这个下拉。暂存箱条目会显示已选的性质，回填表单时带回，重复收录同一条岗位时「这次没选」不会冲掉上次选好的值
   - **两个入口同一份表单**：迷你卡片与 Side Panel 共用 `common/capture-form.js` 的模板、下拉生成、置信提示与保存链路，不会出现「一边改了另一边漏改」
3. **暂存箱**（在 Side Panel 里）
   - 网页版管理器未打开时，收录的岗位自动进入暂存箱排队
   - 打开网页版管理器后逐条弹出确认，人工核对后入库并云同步
   - 可随时展开查看、丢弃或点击回填修改；迷你卡片存进去的记录会**自动刷新**到面板（监听同一份 `chrome.storage.local`）

> v4.0.0 起已**移除**「整页一键自动填充」与「AI 辅助填写」：网申站点结构千差万别，整页自动填充命中率不稳且有误填风险，AI 亦需联网/配置/隐私成本。改为上面这套**用户主导、逐字段、跨站通用、零误填**的点击速填（左键填入 / 右键复制 / 搜索）。

## 工作流

```
网申页                                  网页版管理器                手机（PWA）
──────────────────────────────         ──────────────             ──────────
① 点侧边面板里的字段 → 填入表单
   （面板不遮挡，表单全程可见）
② 提交后收录岗位：
   点页面胶囊 → 迷你卡片核对/补填
   或 侧边面板 →「识别当前页面」
    │ 管理器已打开 → 实时推送
    │ 管理器未打开 → 进暂存箱（面板可查看/丢弃/回填）
    └──────────────────────────→  弹窗人工确认入库
                                     │ 自动保存 + 快照
                                     │ Gist 云同步（可加密）
                                     └──────────→  打开即同步，数据一致
```

## 安装（Chrome / Edge 通用）

1. 下载或克隆本仓库
2. 打开浏览器扩展管理页：Chrome 输入 `chrome://extensions/`，Edge 输入 `edge://extensions/`
3. 右上角开启**开发者模式**
4. 点击**加载已解压的扩展程序**，选择本 `extension/` 文件夹（含 `manifest.json`）
5. 打开侧边面板：点浏览器工具栏上的扩展图标，或按 `Ctrl/⌘+Shift+F`（可在 `edge://extensions/shortcuts` 改绑）

**浏览器版本**：Side Panel 需要 Chrome / Edge **114 或更新**。更低版本上侧边面板入口无效，但**胶囊与迷你收录卡片仍然完整可用**（收录功能不受影响，代码里对 `chrome.sidePanel` 做了特性检测）。

更新插件：`git pull`（或重新下载解压）后在扩展管理页点击"重新加载"。数据保存在浏览器存储中，不受更新影响；胶囊位置也会保留。

> 重载后如果页面上的胶囊点了没反应，刷新一下网页即可——旧的内容脚本在扩展重载后会失去 `chrome.runtime` 句柄，这是浏览器机制，代码里已把失败收敛成一次性提示而不是刷屏报错。

## 代码结构

```
extension/
├── manifest.json              MV3 清单：sidePanel 权限、content_scripts 注入顺序、快捷键
├── background.js              Service Worker：暂存箱队列与查重、简历存取、网页版标签页中继、
│                              Side Panel 入口（openPanelOnActionClick / commands）、
│                              panel ↔ content 的消息中转与错误收敛
├── panel/                     Side Panel（扩展页面，v5.0.0 新增）
│   ├── panel.html             结构：顶栏 / 当前页状态条 / 三段折叠 / 底栏
│   ├── panel.css              组件样式（只引用 var(--aja-*)，零渐变零阴影零 emoji）
│   └── panel.js               逻辑：纯函数挂 window.AJAPanel 便于单测，init() 只在 DOM 就绪时跑
├── common/                    两端共用（content script 与 Side Panel）
│   ├── constants.js           AJA 命名空间：版本、阶段/企业性质枚举、存储键、消息类型
│   ├── tokens.js              设计令牌：圆角/间距/字号/动效 + light/dark 调色板 + 主题订阅
│   ├── icons.js               13 个内联 SVG 图标（currentColor，替代 18 处 emoji）
│   ├── capture-form.js        收录表单的模板 + 样式 + 下拉生成 + 置信提示 + 保存链路 + 暂存回填
│   ├── company-key.js         公司/岗位归一化键（网页版判重逻辑的镜像副本，两处必须同步）
│   └── default-resume.js      默认简历骨架（不预置个人信息）
└── content/                   注入网页的内容脚本（同一 isolated world，按序加载）
    ├── 01-core.js             Shadow Root、设计令牌样式、胶囊拖拽吸边与持久化、
    │                          光标追踪、fillFocusedField 填入引擎、Side Panel 的远程调用入口
    ├── 03-parsers.js          岗位解析引擎（ATS/平台/JSON-LD/打分调度/字段清洗）
    ├── 05-capture.js          迷你收录卡片（惰性构建，首次点胶囊时才创建）
    └── 06-bridge.js           与网页版管理器的 postMessage 桥接（只在管理器页面生效）
```

**加载顺序有硬依赖**，改 `manifest.json` 的 `content_scripts.js` 或 `panel.html` 的 `<script>` 时必须保持：
`constants`（AJA 命名空间）→ `tokens` / `icons` → `capture-form`（模板要用 `AJA.svg`）→ `01-core`（顶层就调用 `tokensToCssVars`）→ `03-parsers` → `05-capture`（调用 `extractPageJobData`）→ `06-bridge`（依赖 `05-capture` 的 `safeSendMessage`）。
`autumn-mail-sync/test/extension-ui.js` 有断言盯着这个顺序。

## 与网页版管理器的配合

- 网页版地址：<https://zixuanyan.github.io/autumn-recruitment-tracker/>
- **简历**：在网页版"我的简历"标签页编辑，保存后自动下发到本扩展（需在本设备打开过网页版）；面板监听 `storage.onChanged`，下发后无需手动刷新
- **投递记录**：确认入库后由网页版统一管理，并同步到你 GitHub 私有 Gist（可选口令加密），手机 PWA 数据一致
- 本扩展完全离线运行，不访问 GitHub，不发出任何网络请求（收录/填表均在本地完成）

## 数据与隐私

- 简历、暂存记录与胶囊位置 100% 保存在本机浏览器（`chrome.storage.local`），不上传任何服务器
- 投递记录的云端同步仅发生在网页版管理器（GitHub 私有 Gist，可口令加密），详见网页版仓库说明

## 来源说明

本项目基于以下开源项目修改而来：

- [ljkss/autumn-job-assistant-tracker](https://github.com/ljkss/autumn-job-assistant-tracker)（秋招网申填写与投递管理助手 v2.0）
- [songxue0614-lgtm/autumn-recruitment-tracker](https://github.com/songxue0614-lgtm/autumn-recruitment-tracker)（秋招投递管理器，数据结构与同步协议源头）

## 版本

- 扩展：v5.0.0（Side Panel + 可拖拽胶囊 + 设计令牌化样式；采集端定位与速填机制不变）
- 存储键：`autumnRecruitmentTracker.resume.v1` / `autumnRecruitmentTracker.pending.v1` / `autumnRecruitmentTracker.ui.v1`（胶囊位置）

### v5.0.0 UI 重构要点

- **Side Panel 拿不到宿主页 DOM**，这是整个架构的约束来源：解析当前页与填入字段都必须走 `panel → background → chrome.tabs.sendMessage → content`（消息类型 `SCAN_CURRENT_PAGE` / `FILL_FOCUSED_FIELD`）。简历数据与暂存箱本来就是 `runtime.sendMessage` 读 `storage.local`，扩展页面直接复用，零改动
- **失败必须翻译成人话**：中转链上任何一环断了都只有一个 `reason` 字符串，`panel.js` 的 `reasonText` 把它们翻成「当前页面还没注入插件脚本，请刷新页面后重试」这类可操作提示。否则用户只会看到「点了没反应」——这是 Side Panel 形态最容易出的体验问题
- **保存记录的链接必须取目标页 URL**（`SCAN_CURRENT_PAGE` 的返回），不能用面板自己的 `location.href`——那是 `chrome-extension://` 地址，存进记录就是废数据
- **焦点为什么不会坏**：点面板时宿主输入框确实失焦，但 `lastFocusedEl` 只在宿主页面的 `focusin`/`click`/`keyup`/`select` 里更新，点面板不会清空它，因此「点输入框 → 点面板字段 → 填入 → 再点下一个字段」可以连续做
- **`openPanelOnActionClick` 与 `chrome.action.onClicked` 互斥**：设了前者，后者永不触发。旧版的 `onClicked` 监听已删除，留着就是死代码
- **设计令牌是唯一事实源**（`common/tokens.js`）：组件 CSS 只允许 `var(--aja-*)`，不写死颜色与圆角；`prefers-color-scheme` 变化时重建令牌段。强调色刻意**不**沿用网页版的蓝紫 `--accent`——蓝紫渐变正是旧版「AI 感」的主要来源
- **反 AI 感有静态守卫**（`autumn-mail-sync/test/extension-ui.js`，51 项）：零渐变、零毛玻璃、零 emoji、圆角只允许 2/3/4/6px、动效不超过 150ms、`:hover` 不得改盒模型、`box-shadow` 不得硬编码颜色、29 个旧配色值黑名单、`[hidden]` 守卫齐全。这些缺陷运行时不报错、人工复核也看不出来，只能靠断言钉住
- **桩 DOM 跑真实 `init()`**（`autumn-mail-sync/test/extension-panel.js`，23 项）：静态断言与纯函数单测都发现不了「取错元素 id」「事件绑到 undefined」「文案模板插错变量」这类只有执行才暴露的错误——本次就靠它抓到一个会显示成「已填 true 项」的渲染 bug

### v4.2.0 企业性质字段要点

- **两端枚举必须逐值相同**：`AJA.COMPANY_TYPES`（`common/constants.js`）与网页版 `COMPANY_TYPES`（`index.html`）是同一份约定。网页端 `normalizeRecord` 做白名单校验，插件里多写或写错一个字，用户选了也等于没选（静默落回「未设置」），且洞察统计永远缺这一档。`autumn-mail-sync/test/extension-bridge.js` 有逐值一致性契约断言（同时覆盖一直缺失的 `AJA.STAGES` vs `STAGE_PRESETS`）
- **收录链路 6 环，断一环就等于功能没做**：收录表单下拉 → 保存 payload → 暂存箱条目与回填 → `background.js` 的 `staged` 与「重复收录合并」两处 → 网页端 `handleCaptureMessage` 的 seed → `openDialog` 回填字段清单。上述测试对这 6 环逐条断言（v5.0.0 起前 3 环的落点在 `common/capture-form.js`）
- **插件侧不做白名单校验**：只做透传与类型收敛（`String(... || '')`），唯一真相源是网页端 `normalizeRecord`；插件再维护一份枚举只会增加漂移面
- **表单布局约束**：迷你卡片宽 300px、Side Panel 宽度由用户拖动决定（可能窄到 200px 左右），`.form-row` 两列布局，塞不下第三列。新增字段要与既有字段配对成行（企业性质与投递日期一行），不要往现有行里加第三列；`.form-group` 带 `min-width: 0` 以防窄面板下溢出

### v4.1.0 解析与判重规则要点

- **域名库改为后缀匹配**：`host === d || host.endsWith('.' + d)`，不再是子串正则。修复了 `studionio.com`→蔚来、`hdji.com`→大疆、`bjd.com`→京东、`163.com.phishing.site`→网易 这类误判（20 个探针域名错 9 个）
- **招聘语境门禁**：域名库命中还要求页面处于招聘语境（招聘子域 / 招聘路径 / 标题含招聘词），因此在 `item.jd.com` 购物、`help.aliyun.com` 查文档时点收录不会得到「京东」「阿里巴巴」
- **公司名标题识别改为角色识别**：按分隔符切段后逐段打分（命中已知品牌 +100 / 含法人行业后缀 +40 / 含岗位词 −60 / 平台噪声 −30 / 存在岗位段时的对位段 +25 / 长度 ±），并把**已识别出的岗位名直接排除**。旧逻辑无条件取第一段，而中文招聘站标题序几乎全是「岗位名-公司名」，实测 10 个标题错 8 个
- **两个清洗器共用同一份平台噪声表**：`软件工程师 - 北森`、`算法工程师|猎聘`、`游戏策划_米哈游`、`后端开发工程师_腾讯科技招聘官网` 都能剥干净；剥净为空或整段是噪声时返回空串，不再硬塞「待确认岗位」
- **属性提取与文本提取分离**：`alt`/`title` 优先原本只为 logo `<img>` 设计，此前被无差别用到 `h1` 与岗位标题上，导致带 tooltip 的元素取到属性而非用户看到的文本
- **城市按文本出现位置选取**：城市库 31 → 100；排除页脚总部地址与城市切换器；全文兜底改为「工作地点/办公地点/base」后 40 字窗口
- **暂存箱去重与网页端同源**：`common/company-key.js` 是网页版 `companyGroupKey` / `normalizePositionSlug` / `loosePositionSlug` / `sameCompanyGroup` 的镜像副本，**两处必须同步修改**（`autumn-mail-sync/test/company-dedup.js` 有逐值一致性断言，漂移即失败）
- **与 background 的通信一律走 `safeSendMessage`**：扩展被重新加载后，页面上旧内容脚本的 `chrome.runtime` 已成失效句柄，直接调用会同步抛 `Extension context invalidated.` 冒到网页控制台。封装先用 `chrome.runtime.id` 探测、再 `try/catch` 兜底（v5.0.0 起定义在 `05-capture.js` 顶层，`06-bridge.js` 与 `panel.js` 各自复用同签名实现）。失败时经 postMessage 上报一次 `BRIDGE_BROKEN`，由网页版弹「刷新页面即可恢复」提示（带刷新按钮）；上报去重，但每次留 `console.warn`。**新增任何 `chrome.runtime.*` 调用都必须走封装**，`autumn-mail-sync/test/extension-bridge.js` 有一条静态守卫会拦截裸调用
