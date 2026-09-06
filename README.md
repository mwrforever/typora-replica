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
