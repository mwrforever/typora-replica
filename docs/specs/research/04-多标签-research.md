# 04 多标签 模块级调研

- 调研日期：2026-08-13
- 调研对象：Typora 官方公开文档（标签页相关记载，重点 F29） + 开源生态（Pinia/Milkdown 多实例/Tauri 窗口策略）
- 上游依据：`docs/specs/00-typora-full-feature-research.md` 第 3.4 节（F29）、第 10 节（校准 #1：统一支持标签页）；`docs/specs/research/01-编辑核心-research.md`（编辑器 create/destroy 约定）
- 下游用途：「04 多标签」模块 spec 的撰写依据

---

## 0. 调研方法与边界声明

**clean-room 行为级调研**：仅 Typora 官方公开文档（含公开文档仓库原文、官方公开 issue 跟踪器 typora/typora-issues 作行为佐证）+ 开源生态公开资料（Milkdown/Pinia/Tauri 官方文档与公开仓库）。未接触安装包/闭源代码。

## 1. 来源清单

官方：Shortcut-Keys（中英双语核对）、Typora-on-Windows、typora-issues #2757/#2786/#1266（行为佐证）、What's-New 官方文档仓库全文检索。
生态：Milkdown FAQ（destroy 要求）、Milkdown Vue 食谱、Milkdown 讨论 #1665（多实例受支持）、Pinia 官方文档（setup stores/composing）、Tauri 2 多窗口与 capability 文档。

## 2. 官方记载汇总（结论：官方对标签页记载极少，本模块为自定义差异化功能）

| #   | 官方记载                                                                   | 出处                      | 对我们的含义                    |
| --- | -------------------------------------------------------------------------- | ------------------------- | ------------------------------- |
| 1   | New Tab：Win/Linux「Not Supported（不支持）」，macOS Cmd+T（窗口内新标签） | Shortcut-Keys             | **差异化卖点直接依据**          |
| 2   | Reopen Closed File：Ctrl+Shift+T（三平台）                                 | Shortcut-Keys             | 快捷键沿用；重开行为自定        |
| 3   | Close：Ctrl+W（三平台）                                                    | Shortcut-Keys             | 快捷键沿用；脏确认自定（C2）    |
| 4   | New Window：Ctrl+Shift+N（三平台）                                         | Shortcut-Keys             | 归 12 窗口外壳                  |
| 5   | Switch Between Opened Documents：Ctrl+Tab（Win/Linux）                     | Shortcut-Keys             | Ctrl+Tab 沿用，语义改为标签切换 |
| 6   | Windows 特性页零标签页内容                                                 | Typora-on-Windows         | Windows 官方无标签页旁证        |
| 7   | Windows 多文件=多窗口；社区多次请求标签页未采纳                            | typora-issues #2757/#2786 | 差异化定位市场依据              |
| 8   | 关闭脏文档确认交互：**未记载**                                             | 全站检索                  | C2 完全自定义                   |
| 9   | 标签页历史版本行为：**未记载**                                             | What's-New 检索           | 无历史行为需对齐                |

## 3. 架构决策（调研推荐，spec 采用）

- **每标签一个 Crepe 实例 + v-show 保活**：切换零重建（光标/undo/滚动/渲染缓存每文档隔离），复用 01 模块 create/destroy 约定；Milkdown FAQ 明示卸载必须 destroy，Vue 集成层自动管理生命周期，多实例是受支持用法
- **保活上限 16 + LRU 回收**：超限销毁最久未激活实例，内容以 markdown 字符串留 `contentSnapshot`，重新激活以 defaultValue 重建（唯一代价是首次切换重解析）
- **否决单实例换文档**：每次切换全量重解析，与 C5 大文档性能直接冲突；光标/undo/缓存全丢需自研恢复
- **Pinia 单例 useTabsStore 只存可序列化元数据**（tabs/activeTabId/closedStack）；编辑器实例进模块级 Map 注册表（不进 Pinia，防 Proxy 风险），对接 01 接口
- **Tauri 窗口策略**：单窗口多标签（全部标签共享一个渲染上下文，Pinia 单例天然共享）；New Window 归 12 模块（各窗口独立 Pinia，首版不做跨窗口标签同步）

## 4. 自定义设计项（官方无记载）

- **关闭脏标签确认（C2）**：单标签关闭弹「保存/不保存/取消」三按钮；退出应用由 12 模块聚合列表式一次性确认；与 F30 自动保存联动（写盘成功后 dirty=false，无未保存变更不弹）
- **Ctrl+Shift+T 重开**：LIFO；**恢复脏快照**（用户已拍板）；重开栈深度上限 20；默认不跨会话
- **未命名标签**：标题 Untitled N；关闭后按快照可重开
- **激活/关闭顺序**：关闭当前标签后激活右侧相邻（无右侧则左侧）；Ctrl+Tab 正向轮换、Ctrl+Shift+Tab 反向

## 5. 用户实操回填（2026-08-13）

| #   | 事项                        | 结果                                                                                                                                |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Windows Typora 的 Ctrl+Tab  | ✅ 在已打开的文档之间切换（Switch Between Opened Documents 生效，Windows 为跨窗口语义）→ 我们的 Ctrl+Tab 做标签内切换（差异化增强） |
| 2   | Ctrl+Shift+T 恢复未保存内容 | ✅ 恢复脏快照（用户拍板）                                                                                                           |
| 3   | 保活上限 16+LRU             | ✅ 写死不进设置（建议被接受，spec 把关时确认）                                                                                      |
| 4   | 未命名标题 + 跨会话         | ✅ Untitled N、默认不跨会话（建议被接受，spec 把关时确认）                                                                          |
| 5   | macOS 标签形态              | 首版跳过（Windows 目标）                                                                                                            |

## 6. 待确认残留项（自定策略，spec 中标注）

- 重开栈深度：自定 20（超出丢最旧）
- 保活上限：自定 16 + LRU
