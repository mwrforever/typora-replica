# 10 设置快捷键 模块级调研

- 调研日期：2026-08-13
- 调研对象：Typora 官方公开文档（12.1-12.7 约 55 个设置项逐项核对 + keyBinding 机制 + S3 字数统计）+ 开源生态（tauri-plugin-store/ProseMirror keymap）
- 上游依据：`docs/specs/00-typora-full-feature-research.md`；01-07 各调研（设置项分散核对结论）
- 下游用途：「10 设置快捷键」模块 spec 的撰写依据

---

## 0. 调研方法与边界声明

**clean-room 行为级调研**：Typora 官方公开文档（15 篇源文件逐字核对）+ Tauri/ProseMirror 官方文档与开源源码。未接触安装包/闭源代码。

## 1. 来源清单

官方 15 页：Shortcut-Keys（keyBinding）、Advance-Config（conf.user.json）、Auto-Save（autoSaveTimer）、Word-Count（S3）、Custom-Font、Dark-Mode、About-Themes、Code-Fences、Math、Draw-Diagrams、Strict-Mode、Auto-Pair、Line-Break、Spellcheck、Launch-Options、Languages-Support、Export。
生态：tauri-plugin-store 文档、prosemirror-keymap 源码、01 调研 keymapCtx 结论、package.json（无 UI 库确认）。

## 2. 官方核对结论（关键项）

### 2.1 偏好面板分区（S1，用户实测修正）

**分区顺序（Windows）**：General → Editor → Image → Appearance → Markdown → Export；**Save & Recover 在 General 分区内部（非独立分区，用户实测修正调研初判）**；官方另载明偏好面板内置 **Ctrl+F 搜索设置项**。

### 2.2 关键默认值（官方原文 + 用户实测合并）

- monocolorEmoji 默认 false（彩色，官方载明）
- **autoHideMenuBar = true 才启用自动隐藏**（官方原文 false 为笔误，用户实测裁决）
- Image Insert 三路径开关默认全关（07 调研）；Allow copy 默认关（对齐 Typora 行为推测，02 调研）
- Auto pair 两开关默认开；Default Line Ending 默认 LF；Inline Math 默认关（01 调研实测）
- Whitespace/LineBreak 默认「编辑保留、打印/导出忽略」（官方载明）
- autoSaveTimer 默认 5（Double，分钟，官方 Auto-Save 页示例含 // 注释）
- Export 默认值（09 调研回填）：A4、页眉页脚空、h1 分页关、Include Outline 关
- **启动行为默认选项官方未载明**（用户未实测）→ 自定：新建文件

### 2.3 keyBinding 机制（C1/12.7）

- Windows/Linux：conf.user.json 的 keyBinding（键=菜单命令名、值=快捷键组合字符串，**重启生效**）；macOS 走系统设置（无文件）
- **文件名裁决：conf.user.json**（用户实测；Advance-Config 页 config.user.json 为笔误）
- 菜单显示快捷键：每个菜单项右侧（官方载明）
- **JSON 注释：官方明文支持 `//`**（Advance-Config 页原文 + Auto-Save 示例）

### 2.4 S3 字数统计（归 11 状态栏，本调研裁决）

- 统计逻辑 + 状态栏 UI + 点击弹面板归 **11 状态栏**；Reading Speed 设置项归 10（12.1 Appearance 分区）
- 官方口径：字数不含格式符号、字符数含；中文一字一词；选中统计；**点击面板可切换计数单位**（00 遗漏）；**默认显示字数；代码块文本计入字数**（用户实测）

## 3. 与全量 spec 的差异点（9 处，写 spec 时回改 00 号）

1. S1 分区清单：六分区顺序修正 + Save & Recover 在 General 内部（非独立分区）+ 面板内 Ctrl+F 搜索
2. S1 子区结构：Markdown 分区含 Math/Code Fences/Whitespace/LineBreak 子区
3. S2 文件名 conf.user.json 裁决；JSON // 注释官方出处
4. S3 补「点击面板切换计数单位」；统计逻辑归 11（模块边界明确）
5. C1 菜单项右侧显示快捷键；macOS keyBinding 系统机制存档
6. 12.1 monocolorEmoji 默认彩色；autoHideMenuBar true 启用
7. 12.2 Image Insert 三开关默认全关（扩 00 的仅 ./ prefix）
8. 12.3 Whitespace/LineBreak 默认值写入
9. 12.7 autoSaveTimer 出处 Auto-Save 页；searchService 右键第三方搜索（06 已改）

## 4. 开源生态边界

- **双层设置方案**：
  1. 面板设置（各分区 GUI 值）→ tauri-plugin-store（严格 JSON，autoSave 防抖 100ms）
  2. 高级设置（defaultFontFamily/autoHideMenuBar/searchService/keyBinding/monocolorEmoji/flags/autoSaveTimer）→ 独立 conf.user.json，**自研「注释剥离解析 + 行级键值合并写回」**（解析剥 // 注释（跳过字符串内边界）→ serde_json；写回只替换目标键行、保留用户注释与格式）
- **设置面板**：手写 Vue 组件（无 UI 库）；左侧分区导航 + 右侧表单；面板内 Ctrl+F 搜索；云上传项禁用占位；重启生效类设置 UI 标注
- **keyBinding 注入**：prosemirror-keymap 无热更新机制（静态表）→ 对齐官方「重启生效」：启动时读 keyBinding → 01 keymap 注册表 create() 前合并注入；热更新列为备选非首版
- **设置快照接口**：两文件合并为单一设置 store 供各模块消费；生效时机区分「即时/重启」两类

## 5. 用户实操回填（2026-08-13）

| #   | 事项                 | 结果                                                                                         |
| --- | -------------------- | -------------------------------------------------------------------------------------------- |
| 1   | 高级配置文件名       | ✅ conf.user.json                                                                            |
| 2   | autoHideMenuBar 语义 | ✅ true 启用（官方 false 笔误）                                                              |
| 3   | 偏好面板分区顺序     | ✅ General → Editor → Image → Appearance → Markdown → Export；Save & Recover 在 General 内部 |
| 4   | 字数按钮默认显示     | ✅ 字数；代码块文本计入（标记符不计）                                                        |
| 5   | 启动行为默认         | 未实测 → 自定新建文件                                                                        |

## 6. 待确认残留项（自定策略，spec 中标注）

- 启动行为默认选项：新建文件（自定）
- Show Status Bar/Font Size/Reading Speed 默认值：状态栏开、字号跟随主题（自定）
- Diagrams/Strict Mode/Highlight/Sup/Sub 默认值：关（官方开关类默认关的惯例，自定）
- Code Fences 各选项默认：行号关/长行换行关/Shift+Tab 缩进选中行（官方载明）/缩进宽度 4/默认语言无（自定）
- Legacy inline math parsing：官方 Math 页无此选项记载 → 首版不做该设置项（存疑项删除，避免死配置）
- defaultFontFamily 子键清单：仅 sansSerif 示例 → 自定简洁键结构
- 阅读时间取整：向上取整
- 自定义导出项快捷键：首版保留（Export 菜单装配归 12，keyBinding 解析归 10）
