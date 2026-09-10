# TASK.md — 待办与待裁决事项跟踪

> 只记跨会话未决事项；完成后删除对应条目。来源标注会话与置信度评分，归属待用户裁决。

## 宪法重写体系（2026-09-05 constitution-generator）——全部裁决与调研项已闭环

### A. 待用户裁决

（无——J1–J8 全部闭环，见下）

> 已闭环：J1（2026-09-05 用户批准，AGENTS.md.draft 晋升为根宪法）、J2（旧 `docs/全局开发宪法.md` 与 89 行版 AGENTS.md 归档至 `docs/archive/`，未删除）、J3/J4（2026-09-05 用户批准，PR #9 合入 test 6bf790c：gitleaks-action v3 + 三 workflow permissions 最小化，PR CI 5/5 全绿；release 链路留下次 tag 发版实跑验证）、J6（2026-09-05 核实闭环：npm 11.16.0 起原生支持顶层 `allowScripts`（advisory 模式），本仓键位与官方格式逐字一致**无需迁移**；npm 12 将强制化，届时补 approve-scripts 流程；注意 CI/新环境需 npm ≥ 11.16.0）、J7a + J8（2026-09-05 执行，PR #10 合入 test 397b936：tsconfig 启用 verbatimModuleSyntax（零存量错误）+ pre-commit 固化 default_install_hook_types，CI 5/5 全绿）、J5（2026-09-05 用户指令执行，PR #11 合入 test 4d3a5c9：cargo-deny advisories 矩阵拆分——bans/licenses/sources 严格阻断 + advisories continue-on-error 仅报告；踩坑留档：检查清单必须拼入 cargo-deny-action 的 `command`，`arguments` 是单字符串通道）、J7b（2026-09-05 用户指令执行，PR #12 合入 test 2b77db6：tsconfig 启用 noUncheckedIndexedAccess + 162 处存量整改（26 spec 文件 120 处断言收窄 + 12 生产文件 42 处守卫优先），typecheck 零错误、806 用例全绿、核心域 100% 覆盖率达标；过程教训见 CHANGELOG）。

### B. {待调研项}——已于 2026-09-05 全部核实闭环（证据：docs/agmds-research/2026-09-05-待调研项核实报告.md）

| 方向                                   | 核实结论                                                                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| store 路径基准 / Rust auto_save 默认值 | 相对路径基准 = `app_data_dir`（`%APPDATA%\com.markwell.app`），绝对路径原样生效；auto_save 默认开启 100ms 防抖，插件在 `RunEvent::Exit` 无条件落盘（与宪法 A.2.7 一致）                                                                     |
| notify 8.2 Windows 溢出行为            | 溢出 → 静默 `unwatch` 终止监听，事件流无 Error 通知、应用内零感知（log 后端未接）；重命名不配对（From/To 两事件）；无自愈——已升格为宪法 A.5.4 兜底义务条款                                                                                  |
| Mermaid v11 destroy API                | 确认无公开 destroy（调研 A5-5 即结论）：清理只能外层移除旧 SVG 节点，宪法 A.5.11 条款即为正确处置                                                                                                                                           |
| Pinia 4.x 行为复核                     | `$reset` dev 抛错/**生产 noop**（运行时兜底须自建）；`storeToRefs`/`$subscribe`+detached/取消函数均与 v3 一致（4.x 新增重复 callback 去重 PINIA_R1007）；「setup store return 全部 state」**非库强制**，宪法 B.2.4 属工程纪律靠 review 把关 |
| prosemirror-search 实例同源            | **实证同源成立**：state 1.4.4 / view 1.42.2 / model 1.25.11 全仓顶层单拷贝，无嵌套安装；宪法 B.2.5 已更新为「同源已核验 + 禁止新增直装维持（防 semver 漂移触发嵌套）」                                                                      |
| coverage thresholds 退出码             | 未达标 → `process.exitCode = 1` + ERROR 输出，门禁阻断成立（工具链调研 D5 闭环）                                                                                                                                                            |
| WebView2 runner CDP 回归出处           | 已溯源：WebView2Feedback#5640（closed completed）微软定性 Runtime 150 起**by-design 安全加固**——提权宿主忽略 `WEBVIEW2_*` 环境变量与 HKCU 通道，仅 API/HKLM 生效，官方文档已书面化；「CI 禁 CDP」决策依据坐实，宪法 C.6.5 已补溯源          |

## 07 图片粘贴存盘审查后续项（2026-09-05 code-review，4 条均为 75 分档：真实但低于 80 分报告线，未阻断 PR #7/#8 合入）

| #   | 问题                                      | 一句话影响                                                | 修复成本             | 建议归属                     |
| --- | ----------------------------------------- | --------------------------------------------------------- | -------------------- | ---------------------------- |
| 1   | urlEscapeEnabled 显示链路缺 unescape 对侧 | 开关开启后目标场景图片显示全量破损且持久写入破损 markdown | 中（需自实现逆变换） | 07 迭代或独立 fix PR         |
| 2   | PIN-5 测试空断言                          | 测试恒绿，对声称守护的库升级漂移零保护                    | 小                   | 下次触碰 editor 测试时顺手修 |
| 3   | 新增 API/字段用 null 表"无"               | 违 AGENTS.md 3.2，纯类型契约问题无运行时影响              | 小（零破坏）         | 下次触碰 image 域时顺手修    |
| 4   | 后台标签挂载授权竞态                      | 毫秒级窗口内切标签后该标签本地图片不显示                  | 中                   | 批量恢复类特性开工前必修     |

### 1. urlEscapeEnabled 显示链路缺 unescape 对侧（最重要）

- **现象**：写侧 `buildImageSrc` 以 `escapeImageUrl` 收尾（JS escape() 白名单，产出 `%20`/`%3A`/`%5C`/`%uXXXX` 形态）写入 attrs.src 并落盘 markdown；读侧 `resolveImg` 把 src 原样传给 Rust `resolve_image_path`，`resolve_fs_path` 全程无解码——本 PR 写出的 src 自己解析不回来。
- **后果**：开关开启后，含空格/中文路径的图片（正是该开关的设计目标场景）显示必破损；纯 ASCII 绝对路径也坏（`C:\docs\pic.png` → `C%3A%5Cdocs%5Cpic.png`，盘符检测不命中落入 doc_dir 拼接）。破损形态持久写入 markdown，重开文档同样破损。删除链路同样解析失败落入"仅删引用"分支。
- **现状**：开关默认关（`settings.ts` DEFAULT_SETTINGS.image，四开关默认全关），默认用户流不受影响。
- **修复方向**：`resolve_image_path` 入口（或 `resolveImg` 侧）做与 escape 等价的逆变换。注意 `%uXXXX` 是 JS escape 私有形态，标准 `decodeURIComponent` 遇之抛 URIError，须自实现 unescape 等价逻辑。
- **涉及**：`src/features/image/image-src-policy.ts:69`、`src/features/image/local-image-view.ts:44-55`、`src-tauri/src/io/images.rs:114-145`、`src/features/image/delete-image.ts`（消费 resolve 的删除反查）。

### 2. image-block-pin.spec PIN-5 空断言

- **现象**：PIN-5"编程插入可用 API 探测"实质产出全部是 console.log，注释自述"仅记录结果不作断言"，末尾恒真断言兜底，结构性不可能变红。违反全局 AGENTS.md §四"禁止凑覆盖率的空断言"（`expect(true).toBe(true)` 与点名示例 `assert True` 逐字对应）。
- **后果**：文件头声称"防库升级静默失效"，但 PIN-5 对它该钉的三种漂移（import 路径失效/image-block 节点被删/编程插入 API 破坏）全部放行——且记录的 import 指引与插入配方正是 07 模块消费的 API 面。
- **修复方向**：补 import 成功断言（image-block 节点类型存在）+ 插入后序列化形态断言；或删掉该探测用例由 PIN-1~4 收口。
- **涉及**：`src/features/editor/image-block-pin.spec.ts:178-211`（201 行注释 + 210 行断言）。

### 3. 新增 API/字段用 null 表"无"（AGENTS.md 3.2）

- **现象**：①`getActiveFrontMatter(): string | null`（本 PR 新增公开读取器）；②`ImageDocContext.frontMatter: string | null`（本 PR 新增接口字段，注释"无则 null"——同接口 `docDir?: string` 用的正是规范要求的可选标记，两种策略并存）。两者均不在 Tauri IPC/第三方边界上，不满足 3.2 的 null 豁免情形。
- **后果**：纯类型契约违反，无运行时影响；三处消费方均 `ctx.frontMatter ?? ""` 收敛，对 null/undefined 双兼容。
- **修复方向**：①返回类型改 `string | undefined`；②字段改 `frontMatter?: string`（register.ts 传值处一次 `?? undefined` 转换）。零破坏。
- **涉及**：`src/features/tabs/editor-registry.ts:47`、`src/features/image/upload-flow.ts:23`、`src/features/image/register.ts:87`。

### 4. 后台标签挂载授权竞态读错会话

- **现象**：`EditorPage.vue` 挂载尾部 `authorizeActiveDocumentDir()` 依赖"挂载标签即激活标签"不变量，但 `openFile` 立即激活、`contentReady` 要等异步读盘完成——窗口内切回旧标签则新标签以非激活态完成挂载，`register.ts` 里 `getActiveSession()?.currentDir` 读到旧标签会话：重复授权旧目录，本标签目录此后永不授权（激活链路 `activateInstance` 无 authorize 调用）。`attachLocalImageView` 同样取全局上下文，竞态命中时以错误 docDir 解析，双重失效。
- **后果**：切回该标签时本地图片 asset:// 请求被 scope 拒绝不显示；关闭重开标签即愈（先激活后挂载的正确顺序）。命中需用户在毫秒级读盘窗口内手动切标签（网络盘/大文件窗口拉长），无安全暴露面扩大。
- **修复方向**：`activateInstance` 补 authorize 调用，或授权/attach 改读本实例会话而非全局激活会话。
- **涉及**：`src/components/editor/EditorPage.vue:60-62`、`src/features/image/register.ts:98-99`、`src/features/tabs/editor-registry.ts:57-65`。
- **关联披露**：07 PR 披露清单第 8 条"激活链路授权联动缺口（脆弱不变量，批量恢复类特性开工前须先补）"即此项的正式登记；批量恢复类特性（会话恢复/崩溃恢复）开工前必修。

## 08 主题模块移交项（2026-09-06 终验；同日用户裁决四项已执行闭环，剩余 2 条保留）

> 已闭环（2026-09-06 用户裁决执行，分支 chore/repo-docs-policy）：①文档入库白名单（宪法体系文件 AGENTS/CLAUDE/CHANGELOG/TASK + README + 代码可入库、docs/ 禁止；CHANGELOG/TASK 经用户第二次确认纳入并入库）——gitignore 修正+宪法/README 入库+PR #13 三产物移出；②typora-var-bridge.css 并入 crepe-overrides.css（D-9(b)）；③spec 勘误两项（16 条 AC / 23 个变量）。另：用户澄清「订阅」为事件监听术语（非付费），生命周期项保留为 12 模块前置。
> 已闭环（2026-09-10 12 W3 交付）：原 #1「dispose 不退订 watchThemes + 重复 init 覆盖色系订阅」——终验时 unwatch 通道与重装配幂等已实装（theme-store init 先清后订 / dispose 按 themeWatchActive 退订）；多窗口前置裁决（D1）随 12 W3 落地：register.ts 按 window label 传 `init({ watchFs })`，次窗口跳过 watch_themes 订阅（进程级单槽防顶掉/防误清），theme-store.spec 新增两例（watchFs=false 跳过订阅 / 次窗 dispose 不退订共享槽位）+ 既有 dispose 门用例钉住。
> 新增登记：07 SDD 工作区残留（`.superpowers/sdd/2026-08-25-07-image-paste/`，gitignored scratch 含台账）——SDD 规则本应终审后删除，eslint ignores 已显式排除不阻塞门禁；是否物理删除待用户定（删除不可逆，故不擅动）。

| #   | 事项                         | 一句话说明                                                                                                  | 触发条件 / 建议归属                           |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 6   | 内置主题被改名大写后不再预置 | ensure_builtin_themes 以 exists() 判缺失，改名后静默跳过且被命名规则过滤（恢复=删文件重启）                 | 触发苛刻，留迭代可选修复（read_dir 精确比对） |
| 7   | 留迭代卫生项 15 条           | 注释措辞/JSDoc 风格/测试 spy restore/断言加固等，全表见 docs/progress/2026-09-05-08-theme-progress.md P4 节 | 下次触碰对应文件时顺手修                      |

## 09 导入导出模块登记项（2026-09-06 批6 收口）

| #   | 事项                                       | 一句话说明                                                                                                      | 触发条件 / 建议归属                                        |
| --- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | {待裁决项} 导出 HTML lang 属性硬编码 zh-CN | 导出产物 `<html lang="zh-CN">` 为 09 首版自定默认值；非中文文档导出时 lang 标注失真                             | 是否暴露设置项 / 跟随文档语言，归 10/12 设置界面裁决       |
| 2   | {待登记项} 导出 HTML 的 KaTeX 字体不内嵌   | katex.min.css 引用的 woff2 字体为相对路径，导出单文件离线打开时数学公式字重回退系统字体（已知限制，功能不失效） | 评估导出时字体 base64 内嵌或字体文件随导出方案，归后续迭代 |

## 10 设置快捷键模块补验项（2026-09-08 计划登记）

| #   | 事项                                                                 | 一句话说明                                                                                                                                                                                                                                                                                                                                                      | 触发条件 / 建议归属                                                                         |
| --- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | AC-C1-1 / AC-C1-2 菜单侧补验                                         | 菜单快捷键渲染与窗口域命令（Always on Top 等）执行接线归 12 menuRouter；10 已交付 `getMenuShortcutEntries` 数据接口与 keyBinding 解析注入链（接口级验收全绿）                                                                                                                                                                                                   | 12 模块菜单装配落地后：conf.user.json 配置 `"Always on Top": "Ctrl+Shift+P"` 重启补验端到端 |
| 2   | 窗口域默认快捷键一致性核对                                           | `shortcut-catalog.ts` 的窗口域默认组合（Ctrl+N/Ctrl+W/Ctrl+Shift+L）与 12 实际注册的窗口快捷键须一致                                                                                                                                                                                                                                                            | 12 菜单装配时逐项核对；如需改默认值在 `shortcut-catalog.ts` 调整（10 侧单一事实源）         |
| 3   | app/tabs/search 三快捷键服务缺 defaultPrevented 守卫（存量同型缺口） | 编辑器 keymap 命中组合仅 preventDefault 不阻断传播，`registerAppShortcuts`/`registerTabsShortcuts`/`registerSearchShortcuts` 均不查 `event.defaultPrevented` 照常触发——keyBinding 绑到 Ctrl+S/N/W/P/F/H/Shift+T 等窗口组合会双重执行（10 PR #16 code-review M-1③；10 侧 Ctrl+, 已加守卫、解析层已拒绝窗口保留组合，其余窗口键冲突在 12 接管前靠解析层拒绝兜底） | 12 模块接管窗口快捷键统一收口时，随迁移为三个服务补同型守卫                                 |

## 05 大纲 E2E 偶发失败登记（2026-09-08 T12 首跑失败 / P3 验收复跑全过）

| #   | 事项                                           | 一句话说明                                                                                                                                                           | 触发条件 / 建议归属                                                                           |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | outline.e2e 3 用例偶发失败（存量，非稳定复现） | T12 全量首跑全 3 用例失败（分支基点 d47e21f 与 b4a01ed 双点复现，疑 WebView2 152 环境漂移）；同日 P3 验收终 HEAD 复跑 3 用例全过——判环境偶发而非确定性失败，保留观察 | 05 模块负责人后续跑 E2E 时若复现，按 bug 报告流程定位（本机 WebView2 版本与提权状态一并记录） |

## 11 状态栏模块登记项（2026-09-09 P3 E2E 修复循环）

| #   | 事项                                              | 一句话说明                                                                                                                                                                                                                                      | 触发条件 / 建议归属                                                                                                                        |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | editor-events 层 Created 门禁（防同类消费方复发） | 11 状态栏曾在 create 中期消费 selectionUpdated 读 `view.state.doc` 致 create 链断裂（E2E 实证，已修 8eb5b3c/1029d47——消费侧守卫）；事件桥自身仍会在 create 中期投递事件，任何新消费方同型读法都可能复发同型缺陷                                 | 01 负责人评估：editor-events 对 `updated`/`selectionUpdated` 增加编辑器 Created 后才投递的门禁（属 01 内部行为变更，需回归 05 大纲消费面） |
| 2   | wdio `--spec` 定点跑伪红（配置层局限）            | `--spec` 覆盖 conf 中各 capability 的 `specs` 声明，使目标 spec 也在 image-fixture 实例上执行——依赖 fixture 内容的期望（如 AC-S3-7 的 12 词）在该实例设计上不可满足而恒挂；全量跑（`npm run test:e2e`）不受影响（已基线对照实证与业务代码无关） | 后续 E2E 基建改进：支持 per-capability 过滤（或 conf 提供 named profile），定点跑前先知晓此局限                                            |

## 12 窗口外壳模块登记项（2026-09-10 W4 源码模式收口）

| #   | 事项                                   | 一句话说明                                                                                                                                                          | 触发条件 / 建议归属                                                              |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | 源码模式 Shift+Tab 反向缩进            | 调研报告 §2.1 提及的源码层缩进键位，12 spec AC 未列——首版未实现（CM defaultKeymap 的 Tab 缩进可用，Shift+Tab 反向缩进未定制）                                       | 后续源码模式增强批次；需先入 12 spec 再实现                                      |
| 2   | 源码层未回写编辑随标签切换丢弃         | 源码模式下切换标签时，04 无「按标签写回编辑器」接口（门面已切新标签），源码层未回写编辑随刷新丢弃并 console.warn 告警；单标签内切出（Ctrl+/）回写不受影响           | 04 提供 per-tab 写回接口（同 saveTab 缺口 C 性质）后闭环；届时可去掉丢弃降级路径 |
| 3   | 源码模式内容同步为切出时机（MVP 口径） | 仅在切出（Ctrl+/ 回所见即所得）时经 setContent 整体回写，未做逐键双向实时同步（spec §2 定案的 MVP 范围）；源码层挂载期间 WYSIWYG 侧的自动保存流不感知源码层编辑     | 如需实时同步另立工作包（涉及防抖预算与 undo 语义重设计，不属缺陷）               |
| 4   | 源码模式 E2E 未跑（归 P4）             | AC-M-6~8 已由组件测试（CM 挂载/高亮 token/内容渲染）+ 单测（映射纯函数/切换状态机/setContent 回写）覆盖；本地 WebdriverIO 往返切换 E2E 按批3 计划归 P4 阶段统一执行 | P4 E2E 批次                                                                      |
