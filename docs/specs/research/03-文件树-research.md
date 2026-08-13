# 03 文件树 模块级调研

- 调研日期：2026-08-13
- 调研对象：Typora 官方公开文档（F2-F9/F12 + View 菜单） + 开源生态（Rust crate/Tauri 插件/前端组件策略）
- 上游依据：`docs/specs/00-typora-full-feature-research.md`；`docs/specs/research/02-文档管理-research.md`（Rust command 方案）
- 下游用途：「03 文件树」模块 spec 的撰写依据

---

## 0. 调研方法与边界声明

**clean-room 行为级调研**：仅 Typora 官方公开文档（support.typora.io 及公开文档仓库原文，核心证据 File-Management 页 last_modified 2025-01-17）+ 开源生态公开资料（docs.rs、crates.io、GitHub 开源仓库、Tauri/Vue 官方文档）。中文镜像 zh/File-Management 不存在（404）已如实标注。未接触安装包/闭源代码。

## 1. 来源清单

官方：File-Management（核心）、Shortcut-Keys、Search、Launch-Options、Advanced-Config、What's-New 1.9（交叉证据）；官方文档仓库原文逐字核对。
生态：crates.io（trash / notify / walkdir / natord）、Tauri opener/dialog/fs 插件文档、Vue SFC 递归组件官方文档。

## 2. 功能点核对结论

| #   | 功能         | 官方证据结论                                                                                                                                                                  | 与全量 spec 差异                                       |
| --- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| F2  | 侧边栏切换   | 三面板 Outline/File Tree/File List；Ctrl+Shift+L 开关；**Windows/Linux 侧栏开关入口在状态栏**（macOS 在菜单栏）                                                               | 补状态栏入口                                           |
| F3  | 文件树过滤   | 只显示受支持类型（「Markdown file, text file, etc」未列全）                                                                                                                   | **扩展名清单经用户实测定稿（第 5 节 14 种）**          |
| F4  | 右键菜单     | 官方清单含 **Open / Open in New Window / Undo File Operations / New File/Folder / Duplicate / Rename / Delete(Move to Trash) / Copy File Path / Reveal**（官方以「...」结尾） | spec 缺 4 项；新建文件「输入文件名后免确认」（1.9 起） |
| F5  | 自动刷新     | 监视目录变更自动刷新 + 侧栏手动 Refresh 兜底                                                                                                                                  | 无差异                                                 |
| F6  | 排序         | 四种排序（字母/自然序/修改时间/创建时间）**各有升降序**；**文件夹置前 = Group by Folder 开关**（默认态经用户实测 = 开）                                                       | spec 写「文件夹置前」为固定行为，修正                  |
| F7  | 拖拽         | 树内移动 + 与系统文件管理器双向互拖（延后）+ 拖入写作区插入链接（对象含文件**和文件夹**）                                                                                     | 补对象范围                                             |
| F8  | 撤销文件操作 | 仅最近一次；**Windows/Linux 上 delete 不可撤销**；撤销可能失败需提示                                                                                                          | 补平台差异（延后，存档）                               |
| F9  | 最近位置     | 侧栏列表 + hover 移除/Pin；**固定文件夹联动出现在 Open Recent 菜单与 Open Quickly**                                                                                           | 补联动                                                 |
| F12 | 全局搜索入口 | **快捷键 Ctrl+Shift+F**；Windows/Linux 入口为「滚动到侧栏顶部显示搜索框」（macOS 为侧栏图标）                                                                                 | spec 缺快捷键、入口表述需平台修正                      |

## 3. 与全量 spec 的差异点（8 处，写 spec 时回改 00 号）

1. 11.5 节补官方 **View → Search** 菜单项
2. F12 补快捷键 **Ctrl+Shift+F**；入口按平台修正
3. F4 补 4 项右键（Open/Open in New Window/Duplicate/Undo File Operations）+ 新建免确认
4. F6「文件夹置前」修正为 **Group by Folder 可切换开关**（默认开，用户实测）；4 种排序均可升降序
5. F8 补平台差异：delete 撤销仅 macOS（延后，存档）
6. F9 补 pinned 联动 Open Recent/Open Quickly
7. F7 补对象范围：文件与文件夹均可拖入插链接
8. F2 补侧栏开关入口（Windows/Linux 状态栏）

## 4. 开源生态边界

- **trash 5.2.6 成熟可用**：Windows 实现为 IFileOperation COM 接口（含 WANTNUKEWARNING/部分中止检测），删除进回收站无需自调 win32 API
- **tauri-plugin-fs 的 remove 是永久删除**（std::fs）→ 文件树增删改查全部走 Rust command + trash crate，不采用 plugin-fs
- **opener 的 reveal 在 Windows 用 SHOpenFolderAndSelectItems**（比 explorer /select 更规范）
- plugin-dialog 无「新建文件」对话框 → 自定义内联输入（对标 1.9「输入文件名后免确认」）
- 自然序 = walkdir（遍历/剪枝）+ natord 比较器（walkdir 自带排序仅字母序）
- notify 8 的 Windows 后端为 ReadDirectoryChangesW，需配防抖层（notify-debouncer）
- 前端手写 Vue 递归树（SFC 按文件名隐式自引用），不引重量级组件
- 接口关系：03 不消费 markdownUpdated（归 05 大纲）；「拖入插链接」需 01 新增编辑器接口；打开文件命令依赖 02 的 Rust command

## 5. 用户实操回填（2026-08-13）

| #   | 事项                   | 结果                                                                                                                                                                  |
| --- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 文件树扩展名完整清单   | ✅ **14 种**：.md/.markdown/.mdown/.mmd/.text/.txt/.rmarkdown/.mkd/.mdwn/.mdtxt/.rmd/.qmd/.mdtext/.mdx；隐藏文件不显示；无扩展名不显示                                |
| 2   | 右键菜单完整清单       | ✅ New File / New Folder / Rename / Duplicate / Delete / Reveal / Copy Path / Refresh Folder / Sort / Open Folder / Search / Recent locations（Duplicate 命名待确认） |
| 3   | 侧栏底部菜单清单       | ✅ + 按钮 = Create New File；⋯ 菜单 = Create New File / Search / Reveal / Open Folder / Refresh Folder / Sort（5 种）/ Recent locations                               |
| 4   | Group by Folder 默认态 | ✅ 默认开（文件夹置前）                                                                                                                                               |
| 5   | Ctrl+Shift+F           | ✅ 打开全局搜索；侧栏是否自动切到文件树未实测 → 自定：自动切到 File Tree 面板                                                                                         |
| 6   | 最近文件/位置上限      | ⚠️ 未实测 → 自定 10 条                                                                                                                                                |

## 6. 待确认残留项（自定策略，spec 中标注）

- Duplicate 命名：自定 `{原名} copy.{ext}`，冲突追加 `-1`
- Recent Locations 上限：自定 10 条
- Ctrl+Shift+F 时侧栏自动切到 File Tree 面板（自定）
- 拖入编辑器链接文本规则：相对路径（含扩展名），实现阶段用 1-2 例实测校准
