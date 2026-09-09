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
