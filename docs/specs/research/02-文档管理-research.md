# 02 文档管理 模块级调研

- 调研日期：2026-08-13
- 调研对象：Typora 官方公开文档（F1/F13/F14/F30/F31/C3 + File 菜单 + 设置项） + 开源生态（Tauri 插件/Rust crate）
- 上游依据：`docs/specs/00-typora-full-feature-research.md`；`docs/specs/research/01-编辑核心-research.md`（编辑器接口约定）
- 下游用途：「02 文档管理」模块 spec 的撰写依据

---

## 0. 调研方法与边界声明

**clean-room 行为级调研**：仅 Typora 官方公开文档（support.typora.io，原文经官方公开文档仓库 typora/support.typora.io 逐字核对）+ 开源生态公开资料（Tauri 官方文档、crates.io）。未接触安装包/闭源代码。

## 1. 来源清单

官方文档 10 项：Auto-Save、Typora-on-Windows、Shortcut-Keys、**File-Management（核心，last_modified 2025-01-17）**、Launch-Options、Launch-Arguments、Advanced-Settings、Version-Control、Trouble-Shooting、官方文档仓库全文检索（encoding/GBK/UTF-8 关键词）。

生态资料：tauri-plugin-fs / dialog / opener / store / persisted-scope 官方文档、docs.rs tauri scope API、crates.io（encoding_rs / notify / walkdir）、01 调研 4.4 节（getMarkdown 性能）。

## 2. 功能点核对结论

| #   | 功能       | 官方证据结论                                                                                                                                          | 与全量 spec 差异                                                                    |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| F1  | 打开文件夹 | File → Open 对话框可选文件夹；打开单文件其父目录自动加载；侧栏底部菜单可切换文件夹（spec 遗漏此入口）                                                 | 补充侧栏切换入口                                                                    |
| F13 | 最近文件   | 四个入口：File → Open Recent 菜单 / Open Quickly / 侧栏 Action Panel / 任务栏右键；Clear Items 清除（固定项默认保留）                                 | **11.1 菜单缺 Open Recent（含 Clear Items）**                                       |
| F14 | 启动行为   | 四选项：新建/恢复上次文件夹/恢复上次文件与文件夹/自定义文件夹；命令行参数 `--new` 与 `--reopen-file`                                                  | 无差异；补参数名                                                                    |
| F30 | 自动保存   | 偏好面板**开关型功能**；默认每 5 分钟（autoSaveTimer 分钟）；官方仅载明定时保存                                                                       | **「编辑防抖」官方未载明 → 用户实测已确认存在（停笔防抖 + 定时双条件，见第 5 节）** |
| F31 | 草稿恢复   | 崩溃/异常退出未保存可找回（与自动保存开关无关）；命名 `{date}-{filename}.md`；未命名文档以首标题/首句命名；**恢复入口是偏好面板手动按钮，非启动扫描** | **spec「启动时扫描」语义不符**；Windows 目录官方未载明                              |
| C3  | 编码       | **官方全库无编码记载**                                                                                                                                | spec「UTF-8 无 BOM + GBK 兼容」官方无据，需自定                                     |

## 3. 与全量 spec 的差异点（8 处行为级，写 spec 时回改 00 号）

1. 11.1 File 菜单缺 **Open Recent**（含 Clear Items/清除固定项）
2. F4 右键菜单缺 **Duplicate** 与 **Open in New Window**
3. F6「文件夹置前」是 **Group by Folder 开关**（非固定行为），四种排序各有升/降序
4. F30「编辑防抖」官方未载明——**用户实测确认存在**（保留，双条件）
5. F31「启动时扫描」→ 修正为「偏好面板手动按钮 Recover Unsaved Drafts」；重启不自动弹提示（用户实测）
6. F31 草稿目录自定（Typora 为 %AppData%\Typora\draftsRecover，我们用自定 app 数据目录）
7. C3 官方无记载：Typora 无编码探测（GBK 乱码即所见、保存即转 UTF-8）；我们可做 GBK 探测差异化增强
8. 全局搜索快捷键 **Ctrl+Shift+F** 未收录（属 F12/F26，补录）

## 4. 开源生态边界

- **Tauri 2 fs 插件默认拒绝所有未声明路径**（静态 scope），打开任意文件夹是最大约束；`tauri::scope::fs::Scope` 支持运行期动态扩展，persisted-scope 可持久化
- **推荐方案 C**：目录遍历/监视/编码探测/写盘全部走 Rust 自定义 command（walkdir 2.5.0 + notify 8.2.0 稳定版 + encoding_rs 0.8.35），绕开 fs scope 纠缠；最近文件/启动状态用 tauri-plugin-store（自带 autoSave 防抖）；「在资源管理器中显示」用已引入的 opener；打开对话框用 dialog 插件
- notify 锁 8.2.0（9.0 仍 RC）；encoding_rs 自带 BOM 嗅探（C3 探测方案基础）
- 自动保存链路：markdownUpdated → 防抖合并（停笔约 1s ∪ autoSaveTimer 5 分钟定时）→ getMarkdown() O(n) 全量 → Rust 原子写盘（临时文件+重命名，UTF-8 无 BOM、LF/CRLF 按 Default Line Ending 设置）

## 5. 用户实操回填（2026-08-13）

| #   | 事项                  | 结果                                                                              |
| --- | --------------------- | --------------------------------------------------------------------------------- |
| 1   | 自动保存触发条件      | ✅ 停笔防抖 + 定时双条件存在                                                      |
| 2   | GBK 打开表现          | ✅ 无编码探测：GBK 乱码即所见、保存即转 UTF-8（若需兼容历史 GBK 需外部转码）      |
| 3   | 崩溃重启恢复提示      | ✅ 不自动弹出；入口在偏好设置 → Save & Recover 分区 → Recover Unsaved Drafts 按钮 |
| 4   | 草稿目录与命名        | ✅ %AppData%\Typora\draftsRecover；`{YYYY-MM-DD}-{filename}.md`                   |
| 5   | 自动保存开关默认态    | ✅ Typora 默认**关闭**（我们作为差异化可默认开，spec 把关时确认）                 |
| 6   | 未命名文档正常退出    | ✅ 正常退出也产生备份草稿                                                         |
| 7   | 最近文件条数上限      | ⚠️ 未实测 → 自定 10 条                                                            |
| 8   | 侧栏底部菜单清单      | ✅ 见 03 调研（+ 按钮 Create New File；⋯ 菜单 7 项）                              |
| 9   | Ctrl+Shift+F 全局搜索 | ✅ 打开全局搜索（入口细节见 03 调研）                                             |
| 10  | 编码探测策略          | 见第 3 节差异 7                                                                   |

## 6. 待确认残留项（自定策略，spec 中标注）

- 最近文件列表上限：自定 10 条（Typora 未载明，实现后可调）
- Duplicate 命名规则：自定 `{原名} copy.{ext}`，冲突追加 `-1`（Typora 未实测到）
- 自动保存开关默认态：建议**默认开**（数据安全优先，差异化于 Typora 的默认关）
