# Tauri + Vue + TypeScript

This template should help get you started developing with Vue 3 and TypeScript in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## 功能说明：主题（08 模块）

- **内置主题**：`Markwell Light`（亮色）/ `Markwell Dark`（暗色），原创编写，基于 Milkdown Crepe 的 23 个 `--crepe-*` 变量（17 色 + 基准字号 + 3 字体 + 2 阴影）。
- **明暗联动**：亮/暗模式分别记忆所选主题，跟随系统明暗自动切换；主题内 `prefers-color-scheme` media query 自适应支持。
- **主题目录**：`%APPDATA%\com.markwell.app\themes`。启动时自动预置内置主题；放入新 `.css` 无需重启即出现在主题列表（热刷新）。
- **命名规则**：仅小写字母与连字符（如 `my-first-theme.css`）；数字与大写不安装（对齐官方规则）。菜单标签 = 连字符分词后每词首字母大写（`My First Theme`）。
- **主题编写约定**：变量作用域写作 `.milkdown, .markwell-dark .milkdown { ... }`；字号一律用 rem（配合字号偏好）。
- **自定义追加 CSS**：`base.user.css` 对所有主题生效；`<主题名>.user.css` 仅对应主题生效（文件名大小写敏感）。加载顺序：基础样式 → 主题 CSS → base.user.css → {theme}.user.css。
- **自定义字体**：字体文件放主题目录 `fonts/` 子目录，主题 CSS 内以相对路径引用（如 `url(./fonts/x.woff2)`，相对基准 = 主题目录；建议文件名用小写字母与连字符）。
- **Typora 主题兼容**：官方常用变量（`--bg-color`/`--text-color`/`--primary-color` 等）经映射层尽力转换；DOM 结构差异导致的还原度损失属预期。
- **DevTools**：`Shift+F12` 开合（debug 构建默认可用；release 构建需启用 `devtools` cargo feature）。

## 功能说明：偏好设置与快捷键（10 模块）

- **偏好面板**：`Ctrl+,` 开合；7 分区导航（General 含 Save & Recover 内部区 → Editor → Image → Appearance → Markdown → Export）；面板内 `Ctrl+F` 搜索设置项。
- **双层设置**：面板偏好存于应用数据目录（store 插件，即时生效项改后即用）；高级键存于 `%APPDATA%\com.markwell.app\conf.user.json`（JSON 支持 `//` 注释；面板写值保留注释与格式；一般重启生效）。
- **高级键**：defaultFontFamily / autoHideMenuBar（true 启用自动隐藏）/ searchService / monocolorEmoji / flags / autoSaveTimer / keyBinding。General 分区提供「打开高级设置」与「重置高级设置」。
- **自定义快捷键**：conf.user.json 的 keyBinding（键 = 菜单命令名、值 = 组合串，如 `"Always on Top": "Ctrl+Shift+P"`），重启生效；非法组合自动忽略；与内置冲突时自定义优先。
- **autoSaveTimer 双写**：面板「Save & Recover」的保存间隔与 conf.user.json 同步双写；手工改文件后重启以文件为准。

## 功能说明：状态栏（11 模块）

- **字数统计**：窗口底部状态栏右区计数按钮显示全文行数 / 字数 / 字符数（默认「N 词」）；计词口径为汉字逐字计数、拉丁字母与数字连续串计一词；统计渲染级文本（代码块文字计入，Markdown 标记符不计）。
- **选中统计**：有选中文字时按钮显示「选中 N / 总 N」，两个数值恒按当前单位同口径换算。
- **统计详情面板**：点击计数按钮弹出面板，列出行数 / 字数 / 字符数全文三值；点击单位条目切换按钮默认计数单位（当前单位带 ✓ 标记）。
- **阅读时间**：面板底部显示估计阅读时间（分钟，向上取整），按偏好设置的阅读速度（词/分钟，默认 200）折算；阅读速度 ≤ 0 时隐藏该行。
- **侧栏开关**：状态栏左区 ☰ 按钮切换文件侧栏显隐。
- **显隐开关**：状态栏显隐跟随偏好设置 Appearance 分区的「显示状态栏」。

## 功能说明：窗口布局（12 模块·W1 布局装配）

- **三区布局**：应用窗口 = 左侧栏容器（文件树/列表/大纲/搜索面板）+ 中央区（标签条 + 编辑器）+ 底部状态栏。
- **侧栏开合与面板切换**：Ctrl+Shift+L 切换侧栏显隐；Ctrl+Shift+1/2/3 切换大纲/列表/文件面板（隐藏态下面板键自动展开侧栏）；Ctrl+Shift+F 打开全局搜索入口。
- **侧栏宽度拖拽**：拖动侧栏右缘分隔条调整宽度（180~480px 自动收敛），松开即持久化，重启应用恢复上次宽度。

## 功能说明：原生菜单栏（12 模块·W2 菜单装配）

- **七菜单**：文件 / 编辑 / 段落 / 格式 / 视图 / 主题 / 帮助；菜单项不设系统级快捷键注册（防系统层抢键），快捷键以文本显示在菜单项右侧。
- **动态子菜单**：文件 → 最近打开（打开文件后自动更新，「清除列表」清空）；文件 → 导出（实时反映导出项设置）；主题（主题目录热刷新后自动更新，勾选当前主题，附「打开主题文件夹」）。
- **菜单栏自动隐藏**：偏好设置高级键 `autoHideMenuBar` 设为 `true` 后，单按 Alt 切换菜单栏显隐（默认 false，Alt 不响应）。
- **打开与另存快捷键**：Ctrl+O 打开文件对话框、Ctrl+Shift+S 另存为（与菜单项同一命令入口）。

## 功能说明：窗口控制（12 模块·W3）

- **全屏**：F11 进入/退出全屏；进入全屏自动隐藏菜单栏，退出恢复显示；全屏期间 `autoHideMenuBar` 开启时单按 Alt 仍可唤出菜单。全屏状态随应用退出保存，重启自动恢复（恢复的全屏态下菜单栏同样保持隐藏）。
- **界面缩放**：Ctrl+Shift+= 放大一档、Ctrl+Shift+- 缩小一档、Ctrl+Shift+0 恢复原始尺寸；档位 50% / 67% / 75% / 90% / 100% / 110% / 125% / 150% / 175% / 200%，整窗缩放（含侧栏与状态栏）。
- **窗口置顶**：菜单「视图 → 窗口置顶」切换当前窗口置顶（无默认快捷键，可经 `conf.user.json` 的 keyBinding 以命令名 `Always on Top` 自定义）。
- **新建窗口**：Ctrl+Shift+N 打开新窗口（初始空文档；各窗口标签、侧栏、菜单状态相互独立）。窗口位置/尺寸/最大化同样随退出保存、按窗口分别恢复。
