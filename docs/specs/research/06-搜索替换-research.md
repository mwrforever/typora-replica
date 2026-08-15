# 06 搜索替换 模块级调研

- 调研日期：2026-08-13
- 调研对象：Typora 官方公开文档（F24-F26 + Edit/View 菜单 + 12.7 searchService）+ 开源生态（prosemirror-search / Rust regex 系 crate）
- 上游依据：`docs/specs/00-typora-full-feature-research.md`；03 调研（F12 联动）；01/02/04 模块 spec 接口
- 下游用途：「06 搜索替换」模块 spec 的撰写依据

---

## 0. 调研方法与边界声明

**clean-room 行为级调研**：Typora 官方公开文档（原文经官方公开文档仓库 gh-pages 源文件逐字核对）+ ProseMirror 官方 search 模块 + Rust crate 公开资料。未接触安装包/闭源代码。

## 1. 来源清单

官方：Search（核心）、Shortcut-Keys、File-Management（Global Search 节）、Advanced-Config、Add-Search-Service、What's New 13 篇交叉检索。
生态：prosemirror-search 1.1.1（npm + 源码）、crates.io（regex/ignore/grep-searcher/encoding_rs/encoding_rs_io/memchr）。

## 2. 功能点核对结论

| #    | 功能          | 官方证据结论                                                                                                                                                                                                                                       | 与全量 spec 差异     |
| ---- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| F24  | 当前文件查找  | Ctrl+F 开关 Find 面板、Ctrl+H 开关 Find+Replace 面板（两个独立面板态）；**查找从当前光标位置开始**（0.9.54）；**Find 命令不改变现有选区**（0.9.80）；查找结果高亮样式独立于 `==高亮==`（1.4）；大文档防挂起（1.4）                                 | 补 3 个行为点        |
| F25  | 正则替换      | 替换串 `$0`/`$1`/`$2`… 捕获组（官方原文 `$3` 疑为 `$2` 笔误）；修复过非捕获组漏匹配                                                                                                                                                                | 无差异（照实引用）   |
| F26  | 跨文件搜索    | 入口：侧栏顶部搜索框（Win/Linux）+ View → Search + Ctrl+Shift+F；三开关（大小写/全词/正则）；**结果存在行数上限**（1.4 增加上限，具体值用户实测约 50 行截断）；结果可 reveal 文件位置（1.2）；**官方全部记载只有搜索、无跨文件替换**（推断不支持） | 补开关表述与结果上限 |
| 11.2 | Find 菜单     | Find Ctrl+F、Replace Ctrl+H、Find Next F3/Enter、Find Previous Shift+F3/Shift+Enter（macOS 为 Cmd+G/Cmd+Shift+G）                                                                                                                                  | 补 macOS 差异        |
| 11.5 | View → Search | Search 页载明菜单项；Ctrl+Shift+F 出处为 File-Management 页（Shortcut-Keys 页未收录）                                                                                                                                                              | 与 F12 互相印证      |
| 12.7 | searchService | **语义澄清：右键菜单第三方搜索引擎列表**（`%s` 占位，默认 Google 搜索），与内置查找无关，归 10 设置模块                                                                                                                                            | 澄清误读             |

## 3. 与全量 spec 的差异点（6 处，写 spec 时回改 00 号）

1. F24 实现机制：改为「**官方 prosemirror-search 模块 + 自研面板 UI**」
2. F26 实现机制：细化为「ignore 并行遍历 + regex/grep-searcher 行扫描 + encoding_rs_io 转码 + 结果上限流式返回」
3. 12.7 searchService 语义澄清（第三方搜索服务列表，非内置搜索配置）
4. 11.2 补 macOS 差异；11.5 Ctrl+Shift+F 出处注记
5. 补行为点：查找从光标位置开始、Find 不改选区、高亮样式独立
6. 官方 `$3` 笔误注记（实现以 $0/$1/$2 为准）

## 4. 开源生态边界

- **查找引擎采用官方 `prosemirror-search` 1.1.1**（Marijn 本人维护，2026-05 仍发布；原 GitHub 仓库 2026-04 归档为托管迁移非废弃；旧社区插件仓库已 404 不可选）——原生支持大小写/全词/正则/`$n` 替换/replaceAll 防死循环；替换走原生 replaceStep 自动进 undo（单次替换一个 undo 步、replaceAll 一次全撤）
- **Milkdown 无 search 插件**（npm 404、Crepe 依赖不含）→ 装配路径：`editor.use(search(...))` 直挂 ProseMirror 插件 + 自研面板 UI（面板形态/计数/按钮是 UI 工作量，非查找算法）
- **Rust 跨文件**：ignore 0.4.33（并行 walk + gitignore/hidden 过滤）+ regex 1.13.1（线性时间无灾难回溯）+ grep-searcher（二进制 NUL 检测）+ encoding_rs_io（GBK 流式转 UTF-8 后在解码文本上搜索，策略 A）
- **跨模块链路**：点击结果 → useTabsStore.openFile → **需 01 新增 `revealRange(from, to)` 定位接口**（用户已拍板「标签内定位高亮」）；跨文件无替换
- **Rust command 草案**：`search_in_folder(root, query, opts)` 流式事件 + 取消

## 5. 用户实操回填（2026-08-13）

| #   | 事项                                                    | 结果                                                        |
| --- | ------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | 匹配计数与实时高亮                                      | ✅ 显示计数（如 3/10）；输入时实时高亮全部匹配              |
| 2   | Replace All                                             | ✅ 有「全部」按钮（替换框最右侧）                           |
| 3   | 结果条形态                                              | ✅ 文件名 + 行号 + 匹配行上下文；同文件多匹配默认折叠可展开 |
| 4   | 结果打开定位                                            | ✅ 标签内定位高亮（用户拍板）                               |
| 5   | 结果行数上限                                            | ✅ 约 50 行截断（超出不显示）                               |
| 6   | 跨文件替换                                              | 官方无记载，推断不支持 → 首版不做跨文件替换                 |
| 7   | 隐藏/二进制跳过、面板生命周期（记忆/ESC）、中文全词语义 | 自定策略（见第 6 节）                                       |

## 6. 待确认残留项（自定策略，spec 中标注）

- 遍历策略：跳过隐藏文件与二进制（NUL 探测）；结果上限 50 条/文件（对齐用户实测的全局截断语义）
- 面板生命周期：记忆上次关键词；面板关闭后 F3 不再继续（重新打开恢复）；ESC 关闭面板焦点回编辑器；再次 Ctrl+F 关闭
- 全词语义：中文连续文本无空格——全词开关对中文按「两侧均为非 CJK 字符」界定（自定，实现阶段验证）
- 结果点击后定位处临时高亮：3 秒后消失（自定）
