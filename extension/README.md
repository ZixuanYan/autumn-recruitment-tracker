# 秋招求职与简历助手（Chrome/Edge 扩展 v3.2.0）

网申页采集端浏览器扩展（Manifest V3）：**简历表单快速填报 + 岗位一键收录 + 暂存箱**。与网页版 [秋招投递管理器](https://github.com/ZixuanYan/autumn-recruitment-tracker) 配套使用，插件负责采集，网页版负责管理与跨设备同步。

> 本目录是 monorepo `autumn-recruitment-tracker` 的浏览器扩展部分（网页版管理器在仓库根目录）。安装：Chrome/Edge 扩展页开启开发者模式 →「加载已解压的扩展程序」→ 选择本 `extension/` 文件夹。

> v3.0.0 重大调整：本扩展聚焦为纯采集端。投递看板、简历编辑器、OCR 与云同步已移除，统一由网页版管理器承担；简历在网页版编辑后自动下发到本扩展供填表使用。

## 核心特性

1. **页面级简历快速填报**
   - Shadow DOM 封装侧边栏，与任意招聘网站 CSS 完全隔离
   - 右侧常驻胶囊按钮；快捷键 `Ctrl/⌘+Shift+F`（浏览器级注册，也可在 `edge://extensions/shortcuts` 改绑）；点击扩展图标同样唤起
   - 点击字段自动触发原生 Setter 与 `input/change` 事件设值，带剪贴板兜底
   - 一键填充只写入你在简历中真实填写（及安全衍生）的字段，不注入任何捏造默认值
2. **岗位一键智能收录**
   - 内置北森、Moka、大易、用友、24Talent 五家国内主流招聘系统专有解析器，外加 JSON-LD / OpenGraph / 正则通用兜底
   - 收录时自动查重：同链接或同公司同岗位的记录更新而非重复堆积
3. **暂存箱**
   - 网页版管理器未打开时，收录的岗位自动进入暂存箱排队
   - 打开网页版管理器后逐条弹出确认，人工核对后入库并云同步
   - 侧边栏可随时展开暂存箱查看、丢弃或回填修改
4. **AI 辅助填写（可选，默认关闭）**
   - 规则匹配先行；对规则没填中的字段，可调用你自配的 OpenAI 兼容接口（API URL / 模型 / Key）由 AI 判断该填什么
   - AI 返回值经“选项成员 + 语义正则”校验防幻觉；证件类型 / 外语等级 / 年月 / 学历等高风险字段不交给 AI 猜
   - AI 填充项琥珀高亮，务必人工复核后再提交；绝不自动提交表单
   - 隐私：API Key 只存插件本机 `chrome.storage.local`，绝不进网页 / 云同步 / 导出备份；开启后未命中字段与相关简历值会发往你配置的 AI 接口
   - 在侧边栏「AI 辅助填写」折叠区配置（含测试连接）；部分算法参考 MIT 项目 Resume Pro（TshyGO/resume-form-assistant-plugin）

## 工作流

```
网申页（本扩展）                      网页版管理器                       手机（PWA）
──────────────                      ──────────────                    ──────────
填写表单（一键填充）
    │
提交后一键收录岗位
    │ 管理器已打开 → 实时推送
    │ 管理器未打开 → 进暂存箱
    └──────────────→  弹窗人工确认入库
                         │ 自动保存 + 快照
                         │ Gist 云同步（可加密）
                         └──────────────→  打开即同步，数据一致
```

## 安装（Chrome / Edge 通用）

1. 下载或克隆本仓库
2. 打开浏览器扩展管理页：Chrome 输入 `chrome://extensions/`，Edge 输入 `edge://extensions/`
3. 右上角开启**开发者模式**
4. 点击**加载已解压的扩展程序**，选择本仓库根目录（含 `manifest.json` 的文件夹）

更新插件：`git pull`（或重新下载解压）后在扩展管理页点击"重新加载"。数据保存在浏览器存储中，不受更新影响。

## 与网页版管理器的配合

- 网页版地址：<https://zixuanyan.github.io/autumn-recruitment-tracker/>
- **简历**：在网页版"我的简历"标签页编辑，保存后自动下发到本扩展（需在本设备打开过网页版）
- **投递记录**：确认入库后由网页版统一管理，并同步到你 GitHub 私有 Gist（可选口令加密），手机 PWA 数据一致
- 本扩展完全离线运行，不访问 GitHub，不发出任何网络请求（收录/填表均在本地完成）

## 数据与隐私

- 简历与暂存记录 100% 保存在本机浏览器（`chrome.storage.local`），不上传任何服务器
- 投递记录的云端同步仅发生在网页版管理器（GitHub 私有 Gist，可口令加密），详见网页版仓库说明

## 来源说明

本项目基于以下开源项目修改而来：

- [ljkss/autumn-job-assistant-tracker](https://github.com/ljkss/autumn-job-assistant-tracker)（秋招网申填写与投递管理助手 v2.0）
- [songxue0614-lgtm/autumn-recruitment-tracker](https://github.com/songxue0614-lgtm/autumn-recruitment-tracker)（秋招投递管理器，数据结构与同步协议源头）

## 版本

- 扩展：v3.2.0（采集端形态）
- 存储键：`autumnRecruitmentTracker.resume.v1` / `autumnRecruitmentTracker.pending.v1`
