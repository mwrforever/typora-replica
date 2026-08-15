# 08 主题 模块级调研

- 调研日期：2026-08-13
- 调研对象：Typora 官方公开文档（T1-T9 + Themes 菜单 + Appearance 设置项）+ 开源生态（Milkdown Crepe 主题体系/Tauri asset 协议）
- 上游依据：`docs/specs/00-typora-full-feature-research.md`；01 调研（Crepe 主题 CSS 手动 import 结论）
- 下游用途：「08 主题」模块 spec 的撰写依据

---

## 0. 调研方法与边界声明

**clean-room 行为级调研**：Typora 官方公开文档（10 篇源文件逐字核对 + 官方主题站 Write-Custom-Theme 页）+ Milkdown/Tauri 官方文档与开源仓库源码。未接触安装包/闭源代码，图片一律文字转述。

## 1. 来源清单

官方：About-Themes（核心）、Add-Custom-CSS、Dark-Mode、Custom-Font、Debug-Themes、Advance-Config、Change-Background、Word-Count、Shortcut-Keys、Typora-on-Windows、theme.typora.io/doc/Write-Custom-Theme。
生态：Milkdown crepe 主题目录源码（6 主题文件逐一核对）、Tauri asset-protocol/config/convertFileSrc/setTheme 文档、wry webview2 源码。

## 2. 功能点核对结论

| #   | 功能       | 官方证据结论                                                                                                                             | 与全量 spec 差异                                    |
| --- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| T1  | 主题即 CSS | 主题 = 主题目录下单个 .css；Themes 菜单列出全部；官方内置 6 个（GitHub/Gothic（默认）/Newsprint/Night/Pixyll/Whitey，用户实测）          | 补内置主题名                                        |
| T2  | 主题目录   | macOS 路径载明；Windows 仅入口（Appearance 分区 Open Theme Folder 按钮）；路径可推断 %AppData%\Typora\themes                             | Windows 路径官方未直接载明                          |
| T3  | 安装主题   | 复制 css+资源 → **重启后出现在菜单**（官方原文 Restart）；用户实测确认必须重启                                                           | spec「复制即用+热刷新」= 差异化增强（热刷新已拍板） |
| T4  | 命名规则   | 禁大写与非字母字符（`-` 除外）；空白转 `-`；菜单标签 = 连字符分词+每词首字母大写；**数字属非字母字符，含数字的文件名不安装（用户实测）** | spec「小写字母数字连字符」需修正为**数字禁用**      |
| T5  | 明暗分离   | 亮/暗分别指定 + 系统色系变化联动 + 主题内 prefers-color-scheme media query；官方无 -dark 后缀约定                                        | 无硬性后缀规则                                      |
| T6  | 自定义 CSS | 4 层加载顺序（基础样式→主题 CSS→base.user.css→{theme}.user.css）；大小写敏感                                                             | 无差异                                              |
| T7  | DevTools   | View → Toggle DevTools；快捷键 **Shift+F12**（用户实测裁决两页冲突）                                                                     | 按 Shift+F12                                        |
| T8  | 自定义字体 | fonts/ 子目录 + 相对路径基准为主题目录；**主题须用 rem 字号单位**配合字号偏好                                                            | 补 rem 硬约束                                       |
| T9  | 主题市场   | 官方 Gallery 存在；不做属范围决策                                                                                                        | 无                                                  |

## 3. 与全量 spec 的差异点（7 处，写 spec 时回改 00 号）

1. T3 区分「官方基线（重启可见）」与「差异化增强（热刷新）」
2. T4 数字禁用（官方规则），菜单标签转换算法补上
3. T5 无 -dark 后缀硬规则（保持不硬性）
4. T7 按 Shift+F12（与 11.5 一致，无需改 00）
5. T8 补 rem 硬约束
6. 12.1 autoHideMenuBar 语义：**true 启用**（官方原文 false 为笔误，用户实测裁决）
7. 实现机制：Typora 主题无法 100% 复刻于 Crepe——内置主题按 Crepe 22 变量原生编写 + 用户 Typora 主题走变量映射层兜底（用户拍板）

## 4. 开源生态边界

- **Crepe 主题体系**：6 主题（crepe/crepe-dark/nord/nord-dark/frame/frame-dark）为纯变量定义层，作用域 `.milkdown`，全系统一 **22 个 `--crepe-*` 变量**（17 色 + 3 字体 + 2 阴影）；common 层全部消费变量
- **Crepe 无运行时主题切换 API** → 切换主题 = 换 CSS 文件（重挂 link）；覆盖层方案成立：在 `.milkdown` 上重定义 22 变量即完整换肤
- **Typora 变量映射层**：官方变量体系仅 15 个常用变量（--bg-color/--text-color/--primary-color/--side-bar-bg-color 等，官方明言可能变化）；映射层 `--crepe-color-background: var(--bg-color)` 兜底，DOM 结构选择器（#write 等）无法兼容属预期
- **CSS 注入（方案 A 推荐）**：asset 协议 `<link>`（convertFileSrc）+ assetProtocol scope + CSP style-src/font-src/img-src 放行；CSS 内相对 url() 按主题文件自身 URL 解析（./fonts/ 语义与 Typora 一致）
- **热刷新**：Rust notify 监视 themes 目录 → 前端重挂 link（?t= 防缓存）
- **明暗切换**：走 Tauri Theme 设置链路（Rust set_theme → WebView2 PreferredColorScheme），前端 matchMedia 选择注入对应主题 CSS；纯前端 class 切换不改变 media query
- **DevTools**：debug 构建默认开、release 需 feature flag

## 5. 用户实操回填（2026-08-13）

| #   | 事项            | 结果                                                   |
| --- | --------------- | ------------------------------------------------------ |
| 1   | 数字文件名      | ✅ 含数字不安装（T4 修正为数字禁用）                   |
| 2   | 重启可见        | ✅ 必须重启（热刷新为差异化增强，已拍板做）            |
| 3   | DevTools 快捷键 | ✅ Shift+F12                                           |
| 4   | 内置 6 主题     | ✅ GitHub/Gothic（默认）/Newsprint/Night/Pixyll/Whitey |
| 5   | autoHideMenuBar | ✅ true 启用（归 10 设置模块，此处存档）               |
| 6   | 主题兼容策略    | ✅ 内置原生 + 映射层兜底（拍板）                       |

## 6. 待确认残留项（自定策略，spec 中标注）

- Windows 主题目录：自定 app 数据目录 themes/（不抄 %AppData% 路径）
- base.user.css/{theme}.user.css 生效时机：官方未载明 → 与主题热刷新同机制（即刷）
- 暗色主题配对：不设 -dark 后缀硬规则，明暗主题独立指定
- 我们内置主题：以 Typora 6 主题为风格参考原创编写（clean-room：原创 CSS，不复制 Typora 主题文件）
