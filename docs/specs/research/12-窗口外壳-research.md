# 12 窗口外壳 模块级调研

- 调研日期：2026-08-14
- 调研对象：Typora 官方公开文档（源码模式/F8/F9/全屏缩放/置顶/New Window/菜单栏，含 What's-New 26 篇全量检索）+ Tauri 2 官方仓库源码
- 上游依据：`docs/specs/00-typora-full-feature-research.md`；04 调研（窗口策略/退出聚合）；10 调研（autoHideMenuBar）
- 下游用途：「12 窗口外壳」模块 spec 的撰写依据

---

## 0. 调研方法与边界声明

**clean-room 行为级调研**：Typora 官方公开文档（官方公开文档仓库源文件，含 What's-New 0.9.54-1.12 全量检索）+ Tauri 官方仓库源码签名核实。未接触安装包/闭源代码，无图片数据。

## 1. 来源清单

官方：Shortcut-Keys、Markdown-Reference（源码模式检索无果）、Focus-and-Typewriter-Mode、Change-Styles-in-Focus-Mode、Zoom、Advance-Config、About-Themes、Typora-on-Windows、File-Management、What's-New 26 篇。
生态：tauri-apps/tauri 源码（window.ts/webview.ts/menu/*.ts）、tauri-docs window-menu、plugins-workspace window-state、Milkdown 仓库、flymd（GPL-3.0，仅行为先例禁抄码）。

## 2. 官方核对结论（关键项）

### 2.1 源码模式（Ctrl+/）

- 官方称谓：所见即所得模式 = **hybrid editing mode**；源码模式切换**需恢复光标位置**（0.9.90 修复条目，核心验收点）；**源码模式有 markdown 语法高亮**（1.5）；Shift+Tab 反向缩进（1.5）；官方主题选择器 `#typora-source .CodeMirror-*`（官方基于 CodeMirror 类组件，公开行为证据）；双向同步机制官方未载明 → 自定

### 2.2 Focus（F8）/ Typewriter（F9）

- Focus：fade out 非当前行/块；**官方 DOM 契约类名**（on-focus-mode/md-focus/md-focus-container/md-end-block/--blur-text-color）——**同名实现以复用 Typora 主题 CSS**；源码模式下 Focus 亦生效（可叠加）
- Typewriter：输入时滚动保持光标居中；**默认「鼠标点击也居中」**，偏好面板开关（关闭后仅输入时滚动）
- 首次进入弹提示（0.9.59，可省）

### 2.3 全屏/缩放/置顶/New Window

- 全屏 F11；**进入全屏自动隐藏菜单栏**（0.9.58）；**重启恢复窗口全屏/最大化状态**（1.10）
- 缩放：Actual Size Ctrl+Shift+0 / Zoom In Ctrl+Shift+= / Zoom Out Ctrl+Shift+-；缩放提示面板 + 1.8 Ctrl+滚轮（可选项）；缩放作用于**整个界面含侧栏**（1.10 佐证）；**范围官方未载明 → 自定 50%-200%**
- Always on Top：View 菜单项、默认无快捷键（可通过 keyBinding 自定义，命令名 "Always On Top"）；多窗口语义未载明 → 自定仅当前窗口
- New Window Ctrl+Shift+N：初始内容未载明 → **自定空文档**

### 2.4 菜单栏

- 五菜单全表与 00 spec 逐项一致（权威确认）；View 表官方未列 Search 但 0.9.61 佐证 Ctrl+Shift+F
- Themes 动态菜单需运行时重建；autoHideMenuBar（true 启用，10 调研裁决）+ Alt 键切换

## 3. 与全量 spec 的差异点（8 处，写 spec 时回改 00 号）

1. 11.5 源码模式：切换恢复光标（0.9.90）、语法高亮与 Shift+Tab（1.5）、官方称谓 hybrid editing mode
2. 11.5 Zoom：缩放提示面板、1.8 Ctrl+滚轮开关
3. 11.5 Toggle Fullscreen：全屏自动隐藏菜单栏（0.9.58）、重启恢复窗口状态（1.10）
4. F27：官方 DOM/CSS 契约类名同名实现（复用 Typora 主题）
5. F28：默认「鼠标点击也居中」+ 偏好开关官方名称
6. 11.5 Always on Top：无默认快捷键、Windows 页名 Pin Window
7. 11.6 Themes：官方重启生效（T3 热刷新为差异化增强）
8. 12.1 autoHideMenuBar true 启用（官方 false 笔误，10 调研裁决）

## 4. 开源生态边界

- **菜单方案（关键决策）**：Tauri 原生菜单（桌面惯例）+ **菜单项一律不设原生 accelerator**（原生 accelerator 在 OS 层拦截按键、ProseMirror keymap 收不到事件）——快捷键全部走前端统一注册（01 keymap 注册表 + 窗口级 keydown），菜单 label 文本显示快捷键（"Strong\tCtrl+B"），菜单 action 与快捷键触发同一命令函数
- **autoHideMenuBar**：前端监听 Alt 单按切换 setAsWindowMenu(menu)/null；与前端快捷键体系不冲突
- **窗口控制**：setFullscreen/setAlwaysOnTop/setZoom（WebView 整窗缩放，关闭 zoomHotkeys 防误触）/onCloseRequested + preventDefault（确认后必须 destroy() 而非 close() 防死循环）；window-state 插件（StateFlags 含 FULLSCREEN）实现重启恢复
- **源码模式方案 A（推荐）**：Crepe 与 CodeMirror 6 双实例保活 + v-show 切换（保留 undo 与光标，与 04 v-show 同构）；文本偏移 ↔ PM 位置映射按 doc.textBetween 累加；MVP 验收「往返切换光标落在同一行/字符附近」
- **F27/F28**：selectionUpdated + domAtPos 向上找块级元素加类；Typewriter 用 coordsAtPos + scrollTop 调整居中
- **布局装配**：原生菜单栏 + 左侧栏容器（03/05/06 三面板 v-show）+ 中央（04 标签条 + 01 编辑器/源码层）+ 状态栏（11）；侧栏宽度可拖拽并持久化；12 是纯装配器
- **退出聚合**：onCloseRequested 拦截 → useTabsStore 聚合脏标签 → **列表式一次性确认（自定拍板）**→ 逐标签写盘 → destroy()；弹窗期间暂停自动保存定时器

## 5. 用户实操确认（2026-08-14）

4 项决策按推荐自定（用户未答复，spec 标注把关可改）：缩放 50%-200%、New Window 空文档、退出列表式确认；11 的字符数口径渲染级（跨模块引用）。

## 6. 待确认残留项（自定策略，spec 中标注）

- 源码模式形态：行号关/自动换行开/等宽字体（自定）
- 全屏后 Alt 唤出菜单栏：支持（Alt 显隐机制统一）
- Always on Top：仅当前窗口（自定）
- Focus 淡化强度：主题 CSS 的 --blur-text-color 默认值（自定，内置主题提供）
- Ctrl+Tab 跨窗口语义：首版仅标签内切换（04 已定）
