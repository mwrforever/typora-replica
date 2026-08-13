# 05 大纲 模块级调研

- 调研日期：2026-08-13
- 调研对象：Typora 官方公开文档（F16-F23 逐点核对） + Milkdown/ProseMirror 开源生态（heading 锚点/事件/定位 API）
- 上游依据：`docs/specs/00-typora-full-feature-research.md`；`docs/specs/research/01-编辑核心-research.md`
- 下游用途：「05 大纲」模块 spec 的撰写依据

---

## 0. 调研方法与边界声明

**clean-room 行为级调研**：Typora 官方公开文档（直连超时，原文改经官方公开文档仓库 typora/support.typora.io gh-pages 源文件读取，同源）+ Milkdown/ProseMirror 开源仓库（MIT）。未接触安装包/闭源代码。中文镜像无 Outline 专题页（如实标注）。

## 1. 来源清单

官方 7 页：Outline（核心，2023-04 创建/2025-01 维护）、Shortcut-Keys、File-Management、TOC、TOC-levels、Markdown-Reference、Links、Export、What's-New-1.5。
生态：Milkdown preset-commonmark 源码（heading.ts / sync-heading-id-plugin.ts）、plugin-listener 源码、@milkdown/kit 插件清单、ProseMirror 视图 API 文档。

## 2. 功能点核对结论

| #   | 功能                     | 官方证据结论                                                                                                                            | 与全量 spec 差异                  |
| --- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| F16 | 大纲面板开关             | Ctrl+Shift+1；打开途径：View 菜单 / Windows 左下角按钮 / macOS 右上角按钮                                                               | 补 UI 按钮位置                    |
| F17 | 层级缩进                 | 按标题级别决定缩进与继承关系（官方原文）                                                                                                | 无                                |
| F18 | 点击跳转                 | 点击条目导航到目标标题（官方配演示视频）                                                                                                | 无                                |
| F19 | 当前标题高亮             | **滚动与编辑两种场景都触发**（官方原文），双向导航                                                                                      | 细化双通道实现                    |
| F20 | Highlight Current Header | **语义为「操作过大纲面板（过滤/滚动）后找不到当前标题」的找回手段**，右键菜单项                                                         | 细化触发场景                      |
| F21 | 大纲过滤                 | 关键词搜索过滤标题（过滤框位置/触发方式官方未载明）                                                                                     | 细节待确认                        |
| F22 | 扁平/可折叠              | 配置入口三处：View 菜单 + 偏好设置 Appearance 分区（「大纲视图允许折叠和展开」，用户实测）+ 大纲面板右键菜单                            | 补配置入口；默认 Flat（用户实测） |
| F23 | 文档内 TOC               | `[toc]` 生成、随文档自动更新；CSS `.md-toc-h6` 控制层级；**PDF 导出自动生成大纲书签；HTML 导出含大纲可配置且形态跟随 Flat/Collapsible** | 补导出联动细节                    |

关联项：Articles = File List（同一面板两个名字）；大纲点击跳转与 TOC/跨文件链接**共用同一套 heading id**。

## 3. 与全量 spec 的差异点（6 处，写 spec 时回改 00 号）

1. F22 补三处配置入口（Appearance 分区 + View 菜单 + 大纲右键菜单）
2. F23/X1/X2 补导出联动（HTML 含大纲跟随 Flat/Collapsible；**PDF 自动生成大纲书签**）
3. F20 语义细化为「操作过大纲面板后的找回手段」
4. **锚点规则三方不一致（关键决策，用户已拍板对齐 Typora）**：Typora 重复标题从 `-1` 起编号；Milkdown 默认 `-#2`（硬编码不可配）；需自写插件替代 sync-heading-id 的编号逻辑
5. Articles = File List 语义澄清
6. 实现机制修正：大纲数据流走 `updated(doc)` 节点遍历 + `selectionUpdated`（不走 markdownUpdated 字符串解析）

## 4. 开源生态边界

- **Milkdown 无大纲插件**（@milkdown/kit 清单确认）→ 侧栏自研 Vue 组件（中工作量，纯前端常规逻辑）
- **heading id 机制**：heading schema 的 id attr 落在 `<h{level} id>` DOM 上，锚点跳转免费；默认 id 生成器 = 小写 + 空白折叠为 `-`、**保留中文**（与用户实测 Typora 一致）；sync-heading-id-plugin 自动重算（不污染撤销历史、IME 组合期跳过）；**重复后缀硬编码 `-#2` 不可配 → 对齐 Typora `-1` 起编号需自写插件替代（用户已拍板）**
- **事件源**：`updated`（200ms 防抖，Doc 参数）/`selectionUpdated`（即时无防抖）是 F19 双通道高亮的理想事件源；**需要 01 模块补充暴露 `updated`/`selectionUpdated`**（Crepe on() 原生支持，改动微小）
- **定位 API**：domAtPos/scrollIntoView/coordsAtPos 均可用；F19 推荐「模式 A」：滚动用标题 DOM top ≤ 视口阈值的最后一个，编辑用 selection.$head 上溯最近 heading
- **规模**：万行文档典型标题 < 数百，普通递归渲染足够，虚拟列表仅作性能预案

## 5. 用户实操回填（2026-08-13）

| #   | 事项                                                               | 结果                                                                               |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 1   | 重复标题锚点实际格式                                               | ✅ 对齐 Typora `-1` 起编号（用户拍板，自写插件实现）                               |
| 2   | 中文标题锚点形态                                                   | ✅ 保留中文、空格转 `-`（与 Milkdown 默认一致，id 生成器无需改）                   |
| 3   | Front Matter title / 文首 H1                                       | ✅ FM title 不入大纲；文首 H1 入大纲                                               |
| 4   | Flat/Collapsible 默认形态                                          | ✅ 默认 Flat；可折叠需在「偏好设置 → 外观 → 侧边栏」勾选「大纲视图允许折叠和展开」 |
| 5   | 其余（过滤框 UI/右键菜单位置/行内样式/空态/面板宽度/高亮判定细节） | 官方未载明 → 自定策略（见第 6 节）                                                 |

## 6. 待确认残留项（自定策略，spec 中标注）

- 过滤框：面板顶部输入框、输入即滤、过滤时保留层级缩进（业界惯例自定）
- Highlight Current Header 右键位置：大纲面板空白处右键（自定）
- 大纲条目行内样式：条目文本提取用纯 textContent（代码等行内标记不渲染样式）
- 空文档大纲：显示空态提示文案
- 当前标题判定：滚动时取「最后一个 top ≤ 视口阈值」的标题（业界惯例）
- 大纲面板宽度拖拽：不做（首版固定宽度）
- HTML 导出「Include Outline」默认值：关（自定，09 模块消费）
