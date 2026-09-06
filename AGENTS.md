# MarkWell 项目宪法

> 本文件是 MarkWell（typora-replica）的最高开发规范：**只存工程原则与约束**。功能实现与业务数据契约见 `docs/specs/modules/`（本文只引用），待办与登记见 `TASK.md`，变更记录见 `CHANGELOG.md`（**先记变更再改正文**），本文档均不重复。
> 整仓单应用：仓库定位与全栈深度约束由本文件合一承载，**约束效力总则与配套文件职责由本文声明**。
> 任何与本文档冲突的代码或设计**不得合入主干**（`test` 分支）；智能体不得擅自放宽本文条款，发现规范与项目实际冲突时提出修订案而非绕过。
> 注释 / 日志 / 测试与死代码规范见全局 `~/.zcode/AGENTS.md`（§一 / §二 / §四；CI/CD 约束见 §六），强制生效，本文不复制正文（A.6 仅作项目化补充）。
> **三段结构**：Part A 技术栈通用 / Part B 架构分层 / Part C 项目实际。
> **强制阅读路由**：写 `src/` 前端代码前必读 A.1.2 / A.7 / Part B；写 `src-tauri/` Rust 代码前必读 A.1.3 / A.2 / A.3 / A.5 / Part B；改门禁与 CI 前必读 C.4 / C.5 / C.6；动手前按模块读 `docs/specs/modules/` 对应 spec。

## 一、约束效力与遵从总则

1. **强制生效**：本宪法全部章节与全局 `~/.zcode/AGENTS.md` 对一切开发行为（编码 / 设计 / 脚本 / CI / 文档 / 提交与 PR）强制生效。
2. **不得违背**：冲突以本文为准，冲突产物不得合入 `test`；禁止「临时 / 紧急」绕过——修宪先记 `CHANGELOG.md` 再改正文；一次性事项登记 `TASK.md` 待决策并限定范围。
3. **遵从路径**：按文档头阅读路由先读后写；跨前端与 Rust 的改动同时遵守两侧条款；先写/改 spec（经用户同意）再写实现。
4. **裁决顺序**：工程约束以本文为准；功能行为与业务契约以对应模块 spec 为准；两者未规定者遵全局约束文件；全局与本文冲突时以本文（更特化）为准。

## 二、配套文件职责（全体系唯一声明落点）

| 文件 / 目录                              | 职责                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| [TASK.md](TASK.md)                       | 登记台：{待调研项} / 待决策 / 审查后续项 / TODO；回填或裁决后删除对应条目  |
| [CHANGELOG.md](CHANGELOG.md)             | 工程规范与体系级变更记录；**先记变更再改正文**                             |
| `docs/specs/modules/`                    | 12 模块全量 spec：业务设计唯一权威（本文只引用不复制）；改 spec 须用户同意 |
| `docs/agmds-research/`                   | 宪法调研报告（条款的官方依据出处）                                         |
| `docs/bugs/` `docs/pr/` `docs/progress/` | 过程文档（bug 报告 / PR 存档 / 进度）                                      |

修宪时须同步核对根索引 [CLAUDE.md](CLAUDE.md) 与文档头阅读路由的一致性。

## 三、项目定位与仓库地图

MarkWell 是 Windows 桌面全功能 Markdown 编辑器（Typora 风格所见即所得，原创实现）。Vue 3 前端承载编辑体验，Tauri 2 / Rust 半体提供文件 IO、目录监听与原生能力，二者经 Tauri IPC 组装为单一应用（`npm run tauri *` 是唯一编排入口）。

```text
typora/
├── AGENTS.md / CLAUDE.md     # 项目宪法（定位+深度合一）/ 根索引（全项目仅此一份索引）
├── TASK.md / CHANGELOG.md    # 登记台 / 变更记录（见 §二）
├── package.json              # 前端依赖清单 + 全栈编排命令（npm scripts 驱动 tauri CLI）
├── vite.config.ts            # Vite + Vitest 配置（覆盖率阈值与内存安全配置禁随意回退）
├── eslint.config.js / .prettierrc.json / .editorconfig
├── .pre-commit-config.yaml   # 本地门禁（pre-commit 轻量 + pre-push 重量）
├── deny.toml                 # cargo-deny 依赖审查配置
├── src/                      # Vue 3 前端（services / features / components / styles / test）
├── src-tauri/                # Tauri 2 Rust 半体（src/io/ + capabilities/ + permissions/ + tauri.conf.json）
├── e2e/                      # WebdriverIO E2E + CI 进程级冒烟（smoke-ci.mjs）
├── docs/                     # specs/modules/（业务设计）· agmds-research/（宪法调研）· bugs/ pr/ progress/
├── design-system/markwell/   # 设计系统文档（MASTER.md + pages）
└── refs/                     # 只读参照物（Typora 安装包）；禁解包 / 反编译（clean-room 边界）
```

命令口诀：**根命令 = 整个应用**——npm scripts 是唯一编排入口，Rust 侧无独立启动命令；全量清单见 C.4。

## Part A — 技术栈通用规范

### A.1 编码约束

#### A.1.1 通用

1. 全部文本文件 UTF-8 无 BOM、行尾 LF；文件与目录名 kebab-case。
2. 全局与项目既有代码风格优先；本次改动产生的多余 import / 变量 / 函数必须同次提交清理（死代码零容忍见全局 §四）。

#### A.1.2 TypeScript 与 Vue 3

1. `strict: true` 及其家族成员**禁止逐项关闭**；tsconfig 变更视为规范变更，须跑全量门禁并在 CHANGELOG 登记；`isolatedModules` 必须保持（Vite 以 esbuild 单文件转译）。启用新编译器检查项（如 `verbatimModuleSyntax`、`noUncheckedIndexedAccess`）须先评估存量修复成本，启用后不得静默回退。
2. 禁止 `any`：确需时用 `unknown` + 类型收窄并注释理由；catch 子句变量按 `unknown` 处理，先收窄再使用，禁止先断言再取字段。
3. null/undefined 策略：默认 `undefined`；可空字段用可选标记 `field?: T`；禁止随意使用 `null`——仅在必须与第三方 API（DOMPurify、DOM 原生）区分"未设置"与"空值"时使用且返回类型显式声明；新增 API 一律返回 `undefined` 表示"无"。
4. 命名：变量 / 函数 / 方法 camelCase 语义化全名（禁单字母）；类型 / 接口 / 枚举 PascalCase，接口禁 `I` 前缀；模块级字面量常量 UPPER_SNAKE_CASE；泛型参数 `T` / `TReq` 式。
5. 类型纪律：公共 API 边界显式标注类型；局部变量依赖推断；类型导入用 `import type`（`verbatimModuleSyntax` 下未修饰的类型导入会原样保留进产物；该选项启用前由 ESLint + review 把关，启用计划见 TASK.md J7）。
6. 禁止带运行时语义的 TS 专有语法：`enum`、含运行时代码的 `namespace`、类参数属性（以 ESLint 承担，TS ≥5.8 后加开 `erasableSyntaxOnly` 兜底）。
7. 函数：可选参数置于必选之后；默认参数优于 `| undefined`；单一职责，超过 ~40 行考虑拆分（参考值非硬限）。
8. Vue 锁定 Composition API + `<script setup>`。编译宏禁止：运行时声明与类型声明混用、在 `<script setup>` 之外调用、显式 import、引用 setup 局部变量（可引用导入绑定）。
9. `defineProps` 类型参数禁止将整个 props 对象建模为条件类型（单 prop 类型位可用）；props / emits 用类型声明，emits 采用标签元组语法标注载荷；props 默认值优先 3.5 响应式解构默认值。
10. 泛型组件必须以 `generic` 属性声明类型参数；`ref` 持有泛型组件实例须用 vue-component-type-helpers（`InstanceType` 不适用）。
11. 组件名多词 PascalCase、模板内自闭合；`v-for` 必带 `key`；禁止 `v-if` 与 `v-for` 同元素；组件样式必须 `scoped`，全局样式只进 tokens.css / crepe-overrides.css 且限 `.markwell-dark` 作用域；可复用逻辑抽 `src/composables/` 或服务层，禁止组件内堆业务逻辑。
12. Vite 静态可分析性：`import.meta.glob` 参数必须字面量；`import.meta.env` 必须以完整静态字符串访问（禁动态键）；仅 `VITE_` 前缀变量进入前端产物，新增变量必须同步 `src/vite-env.d.ts` 的 `ImportMetaEnv` 字段，该文件内禁止 import 语句。

#### A.1.3 Rust

1. 命名遵循 RFC 430：类型 / trait UpperCamelCase，值 / 函数 snake_case，常量 SCREAMING_SNAKE_CASE；访问器不带 `get_` 前缀，setter 用 `set_xxx`；转换方法按 `as_` / `to_` / `into_` 惯例。
2. 库代码（测试与确定不可达处除外，须注释理由）禁止 `panic!` / `unwrap()` / `expect()` / `todo!` / `unimplemented!`；整库保持无 `unsafe`——确需引入属规范变更：须评审并逐块附 `// SAFETY:` 注释（禁给安全代码写 SAFETY 注释）。
3. 可失败函数返回 `Result<T, E>`；错误类型以 thiserror 派生并实现 `std::error::Error` + `Display` + `Send` + `Sync`，禁止 `()` 作错误类型；跨层包装用 `#[from]` / `#[source]`（`#[from]` 隐含 `#[source]`），底层错误经 `source()` 或 `Display` 呈现、二者取一；打印错误一律 Display（`description()` / `cause()` 已弃用禁用）。
4. 类型转换实现标准 trait（`From` / `TryFrom` / `AsRef` / `AsMut`），禁止手写 `Into` / `TryInto`（已有 blanket impl）。
5. 诊断输出保持现通道（`eprintln!` + `[MarkWell]` 前缀），内容遵守全局日志规范（中文、含业务标识、禁敏感信息）；引入日志框架属规范变更。
6. rustfmt 与 `clippy --all-targets -- -D warnings` 为三道门禁强制（pre-commit / pre-push / CI），warnings 即错误。

### A.2 配置管理

1. 分层：`src-tauri/tauri.conf.json` 是 Rust 与打包的唯一权威配置（schema 顶层为 `app` / `build` / `bundle` / `plugins` 四块，本仓现用前三块，插件经 Builder 链注册）；如需平台差异以 `tauri.<platform>.conf.json` 与主配置合并（本仓暂未使用）；前端环境变量走 `.env*`（仅 `VITE_` 前缀进产物）；可配置项禁止散落硬编码进源码。
2. 敏感值边界：`VITE_` 变量的值在构建期打进产物——禁止放任何机密；`*.local` 环境文件必须留在 .gitignore。
3. `identifier`（`com.markwell.app`）定稿后禁止变更（牵连应用数据目录与 store 文件落点）；`productName` / 版本号变更随 release 流程。
4. CSP 必须显式且非 null（现状 `default-src 'self' ...` 为基线）；禁止 `dangerousDisableAssetCspModification`；放宽 CSP 条目须安全评审。
5. `app.withGlobalTauri` 保持默认关闭；前端只经 `@tauri-apps/api` npm 包 invoke，禁止 `window.__TAURI__` 双轨。
6. 构建对接三键保持一致：`build.devUrl`（http://localhost:1420）= Vite dev server（strictPort）；`build.frontendDist`（../dist）= Vite outDir；`beforeDevCommand` / `beforeBuildCommand` 挂 npm 脚本。改 Vite 端口或 outDir 必须同步 tauri.conf.json。
7. 持久化分治：进程内可变状态走 Rust managed state 或 Pinia；tauri-plugin-store 只承载**跨重启持久化**的键值（偏好设置类）；store 值必须为 `serde_json::Value`；autoSave 行为必须显式声明（JS 端 `autoSave: false` 仅优雅退出时落盘）。

### A.3 对外接口设计（Tauri IPC 命令契约）

本项目无 HTTP API，Rust command 即对外 API，契约约束等同模块接口锁定（见 B.2）。

1. 命令名全局唯一（扁平命名空间）、snake_case 语义化；全部命令注册进唯一一次 `invoke_handler(generate_handler![...])`，新命令只允许追加；独立模块中的命令标 `pub`，lib.rs 内定义的不标。
2. 序列化契约：command 参数与返回值必须分别实现 serde::Deserialize / Serialize；前端以 **camelCase 键**的 JSON 对象传参，Rust 侧需要 snake_case 时显式 `#[tauri::command(rename_all = "snake_case")]`；前端 interface 必须按**序列化后的 JSON 形状**建模，禁止照抄 Rust 字段名。
3. 错误契约：命令返回 `Result<T, E>`，`Err` 使前端 Promise reject；`E` 必须实现 serde::Serialize——在命令边界映射为项目错误枚举（thiserror + 自定义 Serialize）；`map_err(|e| e.to_string())` 仅限临时脚手架，禁止成为长期契约；错误序列化内容属于对外 API 面，禁止携带敏感信息（完整路径、凭据等）。
4. 线程模型：重 IO / 重计算命令必须 `async fn`（在异步任务上执行）；同步 command **默认在主线程执行**，命令内禁止阻塞同步 IO；`async` 命令参数禁止借用类型（用 owned 或返回值包 `Result`）；阻塞型操作（大文件同步 IO、目录遍历、编码转码）必须走 `spawn_blocking`；禁止在命令层自管线程池或 `block_on` 阻塞 UI 路径。
5. 大负载：文件内容等大负载禁止经 JSON 序列化返回，必须用 `tauri::ipc::Response` 直接回传字节；流式 / 分块进度用 `tauri::ipc::Channel`（服务 >1MB 大文档预算，见 B.3）。
6. 最小授权：自定义命令默认对所有窗口开放——capability 按窗口 label 显式收紧；第三方插件命令默认全部拒绝，前端需要的每项能力（`store:default` / `dialog:default` / `opener:default` 等）必须在 capability 显式授予；新增权限必须评估是否可再收窄。
7. IPC 契约变更（命令签名 / 序列化形状 / 错误形态）两侧同步修改、测试同次提交，并视为接口锁定变更走用户裁决。

### A.4 数据库操作

本项目无数据库（持久层 = 文件系统 + tauri-plugin-store + 文档草稿），本节省略；编号不重排。

### A.5 基础设施与资源生命周期

**Rust 侧：**

1. 共享状态唯一通道：`Builder::manage()` 或 setup 钩子内 `app.manage()` 注册 + `tauri::State<T>` 注入（线程内经 `AppHandle::state::<T>()`）；禁止全局 static 可变 / lazy_static 可变全局状态替代。managed state 类型必须 `Send + Sync + 'static`，可变性只经内部可变性（`Mutex<T>` 包装）；state 内对象禁止再包 `Arc`（Tauri 已代劳）；同一类型重复 manage 即 panic。
2. `State<'_, T>` 的 T 必须与注册类型完全一致（含 `Mutex` 包装层），错配是**运行时 panic** 而非编译错——统一以类型别名（如 `type WatcherState = Mutex<WatcherInner>`）消除该陷阱；禁止二次包装 Mutex。
3. 锁纪律：默认 std `Mutex`；MutexGuard 禁止跨 await 点；仅当锁守卫必须跨 await 持有时才用异步锁；引入 `RwLock` 须先论证读多写少。
4. 文件监听：notify watcher **被 drop 即停止全部监听**——watcher 必须长生命周期持有（入 managed state）；事件循环必须同时处理 `Ok(event)` 与 `Err(e)` 分支（只取 Ok 禁止）；递归模式显式声明 `RecursiveMode`；网络盘 / 特殊文件系统可能不产生事件，且 Windows 后端事件缓冲区溢出时 notify 8.2 会静默 `unwatch` 终止监听、事件流无任何 Error 通知（源码实证，`log` 后端未接时应用内零感知）——大工作区 / 长期监听场景必须设计监视槽位存活检测与重建兜底，或评估 PollWatcher。
5. 后台任务：统一 `tauri::async_runtime::spawn`（共享 tokio 池）；阻塞操作专用 `spawn_blocking`；跨线程访问 managed state 经 clone `AppHandle`（刻意廉价，禁为共享另建 Arc 单例）。
6. 退出清理：挂 `.run()` 事件回调的 `RunEvent::ExitRequested` / `RunEvent::Exit`；禁止依赖 Drop 兜底做进程退出清理（`process::exit` 路径不执行析构）；强退须先 `cleanup_before_exit()` 并在其返回后立即退出、不再调用任何 Tauri API（store 落盘依赖优雅退出，见 A.2.7）。
7. 初始化入口唯一：启动初始化集中在 setup 钩子（返回 Err 表达失败，禁止钩子内 panic）；插件注册只能在 Builder 链 `.plugin(...)`（build / run 之前），运行期不存在插件注册入口。

**前端侧：**

8. 编辑器实例与宿主生命周期严格配对：挂载 `create()` / 卸载 `destroy()`；关闭文档、切换标签视为一次完整销毁周期，禁止保留僵尸实例。
9. 关闭顺序：先 flush 自动保存 → 再 `destroy()`（listener 防抖定时器随销毁自动 cancel，依赖 `updated` / `markdownUpdated` 的外部定时器必须在销毁前自行落盘 / 取消）。
10. 编辑器 ctx / slice 的作用域是**单个 Editor 实例**：实例级值（editorViewCtx、serializer、listener 管理器等）禁止跨实例共享，可复用的只有插件工厂定义；多标签 = 每标签独立 `Editor.make()` 与独立 root。
11. 渲染资源：Mermaid 全局仅 `initialize()` 一次（`startOnLoad: false`）后显式 `run` / `render`；v11 无按图 destroy API——重渲染以外层移除旧 SVG 节点方式清理，禁止引用不存在的 destroy；KaTeX 为无状态纯函数，CSS 全局只引一次，渲染失败以 `throwOnError: false` 降级展示、禁止崩溃；KaTeX 持久宏对象以单文档为作用域创建销毁，禁止跨信任边界共享。

### A.6 注释 / 日志 / 测试

注释与日志见全局 `~/.zcode/AGENTS.md` §一 / §二，测试与死代码见全局 §四，全部强制生效。本项目补充：

1. 单测落 `src/**/*.spec.ts` 与实现同次提交；命名表达业务意图；断言针对业务结果，禁止绑定实现细节、禁止空断言 / 恒真断言。
2. 覆盖率阈值：全局四项 ≥80%，核心域（资金无关，本项目核心 = 编辑器语法链路、文件 IO 桥、文档会话状态机、安全路径等）100%；新增核心域必须同步在 `vite.config.ts` coverage.thresholds 增加对应 glob 键。
3. 阈值仅在 `--coverage` 路径生效：门禁必须跑 `npm run test:coverage`，禁止以裸 `vitest run` 冒充覆盖率门禁；`coverage.include` 必须显式声明 `src/**` 全量模式（默认只统计被测试导入的文件）。
4. 组件测试面向用户行为（Testing Library 原则）：查询优先级 role > label / text > testid（testid 仅兜底）；断言不存在用 `queryBy*`；交互默认 user-event，fireEvent 须注释理由；全局前置逻辑放 setupFiles，一次性环境准备才放 globalSetup，禁止混用。
5. Rust 命令层测试经 tauri `features:test` mock 运行时直呼命令，断言参数反序列化、返回序列化与错误 reject 形态。

### A.7 跨层数据对象与传参约束

三原则 + 例外边界，按本栈习语翻译：

1. **参数对象化**：
   - TS：导出函数 / 方法形参 > 3 必须定义 interface 整体传参，禁止逐参罗列（组件 props 天然为对象，本条约束工具 / 服务 / composable 函数）；可复用 composable 入参接受 ref / getter 并以 `toValue()` 归一。
   - Rust：command 形参 > 3 必须定义参数 struct（Deserialize）；服务层函数同规则。
2. **返回业务对象**：TS 导出函数返回具名 interface / type，禁止裸结构 / `Record<string, any>` 承载业务数据；composable 按官方约定返回"含多个 ref 的普通非响应式对象"，禁止默认返回 reactive 对象；每次 invoke 必须 `invoke<T>()` 显式泛型，禁止返回值落入 unknown / any。请求与响应分别建模：命令参数 interface ≠ 响应 interface，禁止双向复用（A.3 省略 HTTP 层，本条承载请求 / 响应建模）。
3. **职责隔离**：不同业务职责的对象禁止复用——字段全同也按职责各自建模（查询参数 ≠ 响应对象 ≠ 存储模型 ≠ 组件 props ≠ store state ≠ IPC 契约）；禁止万能对象承载多职责、禁止跨层直传。
4. **编辑器域边界**：`ProseNode` / `EditorState` / `Transaction` 引用不得离开 01 编辑核心——跨模块只传 JSON 值对象或 markdown 字符串；三事件桥载荷类型与 Milkdown listener 官方签名 1:1 对齐（含 prev 值可空性），禁止另造异构形状。
5. **例外边界**：仅业务功能确需动态 / 灵活结构可偏离上述条款，偏离点须能陈述业务理由；无业务理由的违反视为缺陷，不得合入。

## Part B — 架构分层

### B.1 目录职责边界

| 目录                                     | 边界                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/services/`                          | 无 UI 依赖的应用服务（IPC invoke 封装、序列化、纯逻辑）；禁止 import Vue 组件与 `.vue` 文件                                                            |
| `src/features/`                          | 功能域（按 12 模块组织：editor / document / tabs / file-tree / outline / search / image / open-quickly）；域内状态机与编排；禁止直接操作其他域内部实现 |
| `src/components/`                        | 展示与页面级装配；禁止堆业务逻辑（抽 features / composables）                                                                                          |
| `src/styles/`                            | 全局样式仅 tokens.css / crepe-overrides.css，限 `.markwell-dark` 作用域                                                                                |
| `src/test/`                              | 测试 setup（jsdom 前置）                                                                                                                               |
| `src-tauri/src/io/`                      | 文件 IO 命令与服务：command 层薄壳（参数接收校验 + 调服务 + 错误映射），业务与 IO 逻辑下沉服务函数                                                     |
| `src-tauri/capabilities/` `permissions/` | ACL：capability 按窗口授权，自定义权限仅 TOML 且必须在 capability 引用才生效                                                                           |
| `e2e/`                                   | WebdriverIO E2E（本地）+ 进程级冒烟 smoke-ci.mjs（CI）                                                                                                 |

### B.2 层级依赖（强制）

```text
App.vue → components → features → services ──invoke──▶ src-tauri commands → io 服务
```

1. 依赖方向单向：禁止反向依赖（services 禁 import features / components）、禁止跨层调用（组件禁直呼底层模块内部实现）、禁止循环依赖。
2. **12 模块划分**（01 编辑核心 → 12 窗口外壳）为长期结构：每模块一份全量 spec 定稿于 `docs/specs/modules/`，改 spec 须用户同意；新功能先问归属模块，不归属当前模块的代码禁止顺手放，延后项登记 TASK.md。
3. **跨模块接口锁定**：01 已暴露接口（editorManager 方法集、三事件桥、revealRange、setUploadHandler / getUploadHandler、openExternalUrl、addEditorKeymap、text 序列化处理器）签名锁定，后续模块只消费不修改；IPC 契约同级别（A.3.7）。
4. Pinia：store 只承接跨组件的领域 / 应用状态（会话、工作区、偏好）；组件局部 UI 状态禁止入 store；store 定义形态全仓统一（setup store 须 return 全部 state）；组件内提取响应式属性必须 `storeToRefs()`（禁止裸解构）；非组件层订阅必须 `detached: true` 且自持取消函数；相互引用的 store 禁止在 setup 顶层互读对方 state，且叠加分层单向约束——store 依赖同样禁止双向。
5. Milkdown / ProseMirror：一切 ProseMirror API 经 `@milkdown/kit/prose/*` 导入，禁止直接安装 / 导入 `prosemirror-*` 独立包（双实例缺陷）。既有例外：`prosemirror-search`（06 搜索基座，独立依赖 1.1.1）——已核验其与 `@milkdown/prose` 解析至同一 prosemirror-state 单实例（2026-09-05，证据见 docs/agmds-research/ 待调研项核实报告）；同源依赖 semver 交集与全仓单拷贝，禁止再新增任何 `prosemirror-*` 直装以防嵌套安装破坏同源；Crepe 为唯一编辑器骨架，扩展只经 `crepe.editor.use(...)` 注入插件与 `featureConfigs`，禁止 fork / 复制 Crepe 内部实现；一切程序化内容修改必须走 `editor.action` + macro / command，禁止直改编辑器 DOM；schema 扩展（extendSchema 类）必须按 id 原位 upsert，禁止向 nodesCtx / marksCtx 尾部追加；自定义插件遵循 prepare / run / post 三段式，post 必须清理 slice / timer。

### B.3 运行时原则

1. **事件链路延迟预算**（01 定案，消费方不得低于）：`selectionUpdated` 即时；`updated` 200ms（本层 200ms + listener 内置 200ms = 400ms 全链路）；`markdownUpdated` 300ms + 内置 200ms = **500ms 全链路**。自动保存与防抖设计不得低于该预算。
2. listener 语义：`updated` / `markdownUpdated` 经 200ms 防抖且仅当 `prevDoc.eq(doc)` 为假才触发，序列化发生在防抖回调内——消费方禁止假设逐键实时。
3. ProseMirror 单向数据流：一切编辑 = 对既有状态 apply transaction 产出新状态；禁止缓存旧 state / 旧 transaction 引用跨事件使用；插件状态 `apply` 必须返回新值（不可变）；command 契约——不适用返回 false 且无副作用，适用则 dispatch 并返回 true，省略 dispatch 参数即纯可执行性查询。
4. 编辑器与外部 store 的同步只经单向通路（事件桥 / dispatchTransaction 语义）：Pinia 发起编辑必须回到 command / action，禁止 watch(store) 反向直改 view。
5. 大文档（>1MB）与重活：`markdownUpdated` 常驻重监听禁止（官方性能警示），重活按需 `getMarkdown()`；重渲染隔离——Mermaid、KaTeX 懒加载按需渲染；不阻塞主线程的解析 / 序列化路径优先；出现可复现卡顿记 bug 报告而非静默优化；[toc] 全量重建为既定边缘（只读场景接受）。
6. 多实例：门面（editorManager）对外的句柄只指向当前活跃实例；后台标签实例的挂载 / 激活时序缺陷须走正式修复流程（见 TASK.md 登记项）。

### B.4 外部能力网关

1. **IPC 网关**：前端所有 invoke 收敛在 services 层按域封装（文件 IO、设置、外链、对话框），组件禁止散落直呼 `invoke`。
2. **外链**：统一经 opener 插件与 `openExternalUrl`（接口锁定），禁止前端自拼 shell。
3. **本地图片**：`asset://` 协议 + `assetProtocol` scope 运行时按需授权（07 定案），scope 空起步、禁止默认放开全盘。
4. **渲染网关**：Mermaid 沙箱化预览（`securityLevel` 保持默认 strict）+ KaTeX 降级渲染（A.5.11）；iframe 恒归一化 `sandbox=""`（零权限），禁止 allow-scripts + allow-same-origin 组合（E20 定案）。

### B.5 横切关注点

1. **渲染安全**：所有 HTML 进入编辑器渲染前必须过 DOMPurify 清洗（§四安全基线）。
2. **日志安全**：日志 / 错误信息禁止输出敏感信息（token、完整凭据）；上传 / 外链地址不落日志明文；IPC 错误序列化同规（A.3.3）。
3. **供应链安全**：gitleaks / npm audit / cargo-deny 在 CI 强制；新增运行时依赖须评估（体积、维护状态、许可）并自查已知 CVE；npm allow-scripts 白名单机制维持（升级事项见 TASK.md）。
4. **禁动态执行**：前端与 Rust 侧不引入 eval 类动态执行。
5. **clean-room 边界**：绝不解包 / 反编译 Typora 闭源代码；`refs/` 仅作安装行为参照。
6. **文档同步**：用户可见变更更 README，规范变更更本文件，同一变更集内完成。

## Part C — MarkWell 实际

### C.1 项目定位

仓库唯一应用 = MarkWell 桌面 Markdown 编辑器：Vue 3 前端渲染与编辑体验，Rust 提供文件 IO / 监听 / 原生能力，Tauri 2 WebView 承载，单窗口多标签形态。

### C.2 技术栈选型

| 职责              | 技术                                                                                                          | 版本（实测证据）                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 前端框架          | Vue（Composition API + `<script setup>`）                                                                     | ^3.5.13                              |
| 语言（前端）      | TypeScript（strict）+ vue-tsc                                                                                 | ~5.6.2 / ^2.1.10                     |
| 构建 / 开发服务器 | Vite                                                                                                          | ^6.0.3                               |
| 编辑器内核        | Milkdown（crepe / kit / vue）                                                                                 | 7.22.1                               |
| 数学 / 图表       | KaTeX / Mermaid                                                                                               | ^0.18.4 / ^11.16.1                   |
| 状态管理          | Pinia                                                                                                         | ^4.0.3                               |
| 搜索基座          | prosemirror-search（kit 之外的既有例外，见 B.2.5）                                                            | 1.1.1                                |
| 桌面外壳          | Tauri（protocol-asset）+ @tauri-apps/api                                                                      | 2.x                                  |
| Rust 关键依赖     | serde / serde_json、encoding_rs、ignore、regex、walkdir、notify、trash、pathdiff                              | 见 src-tauri/Cargo.toml              |
| PDF 打印          | webview2-com（ICoreWebView2_16 PrintToPdfStream）+ windows/windows-core（COM/IStream）+ thiserror（错误枚举） | 0.38.2 / 0.61 / 0.61 / 2（实测证据） |
| Tauri 插件        | dialog / store / opener                                                                                       | 2.x                                  |
| 单元测试          | Vitest + @vitest/coverage-v8 + jsdom                                                                          | ^4.1.10 / 30                         |
| E2E               | WebdriverIO + edgedriver（本地）；smoke-ci.mjs 冒烟（CI）                                                     | ^9.30.1                              |
| 静态检查 / 格式化 | ESLint（flat config）+ eslint-plugin-vue / Prettier                                                           | ^10.8.1 / ^3.9.6                     |
| Rust 门禁         | rustfmt / clippy -D warnings / cargo test                                                                     | stable-x86_64-pc-windows-msvc        |

**技术栈锁定**：上表选型不可单方面变更（变更须用户拍板并重新评估）；新增运行时依赖须经评估；升级大版本须跑全量门禁并记录（含核对配置项在新版本仍被识别，见 C.6）。版本只认本表与配置证据，禁止凭记忆书写。

### C.3 目录结构

```text
src/
├── main.ts / App.vue        # 应用入口与装配
├── services/                # 无 UI 依赖服务（file-io / settings / line-ending / open-commands / recent-files / launch-behavior / …）
├── features/                # 功能域（editor / document / tabs / file-tree / outline / search / image / open-quickly）
├── components/editor/       # 展示与页面级组件（EditorPage 等）
├── styles/                  # tokens.css / crepe-overrides.css（.markwell-dark 作用域）
└── test/                    # 测试 setup

src-tauri/
├── src/
│   ├── lib.rs / main.rs     # Builder 装配（插件注册 / 命令注册 / setup）
│   └── io/                  # 文件 IO：commands.rs（命令层薄壳）+ fs / encoding / watch / search / images / drafts / file_ops / atomic（服务层）
├── capabilities/ permissions/  # ACL
├── tauri.conf.json          # 唯一权威配置（A.2）
└── icons/ gen/ build.rs
```

### C.4 常用命令

| 命令                                                                             | 用途                                                                |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `npm run dev`                                                                    | 前端 Vite 开发服务器（1420，tauri dev 前置）                        |
| `npm run tauri dev`                                                              | 全栈桌面开发（Vite + Rust + WebView）                               |
| `npm run tauri build`                                                            | 全栈构建（类型检查 + 前端构建 + Rust 编译 + 安装包）                |
| `npm run build`                                                                  | 前端类型检查 + 构建（vue-tsc --noEmit && vite build，双轨缺一不可） |
| `npm run typecheck`                                                              | 仅 vue-tsc 类型检查（本地推送前必跑，见 C.6）                       |
| `npm run lint` / `lint:fix`                                                      | ESLint 检查 / 自动修复                                              |
| `npm run format` / `format:check`                                                | Prettier 写入 / 检查                                                |
| `npm test` / `test:coverage`                                                     | Vitest 单测 / 含覆盖率阈值门禁                                      |
| `npm run test:e2e`                                                               | 本地 WebdriverIO E2E                                                |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`                      | Rust 格式检查                                                       |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Rust 静态分析                                                       |
| `cargo test --manifest-path src-tauri/Cargo.toml`                                | Rust 全量测试                                                       |
| `pre-commit run --all-files`                                                     | 手动全量本地门禁                                                    |
| `pre-commit install` + `pre-commit install --hook-type pre-push`                 | 首次 clone 后安装两级钩子                                           |

**git 提交**：`type(scope): 中文描述`，type 限 feat / fix / docs / style / refactor / perf / test / build / chore / revert；一条提交只做一件事；描述"为什么"而非"改了什么"；测试与实现同次提交。
**分支与 PR**：模块分支 → PR 合入 **`test`**（`main` 冻结，仅 test→main 的发布流转）；PR 描述必须含 AC 通过清单、覆盖率报告、强制披露清单（已知取舍 / 延后项）；合入前用户把关。

### C.5 CI 生产落地方案

1. **工具与触发**：GitHub Actions。`quality-gate.yml` 与 `build.yml` 挂 PR + push（main / test）；`release.yml` 仅 tag `v*` 触发；同分支并发组取消旧任务；main / test 双分支保护 required checks 全过才可合入。
2. **流水线阶段与硬门禁**（任一失败阻断合入，禁止人工绕过）：
   - quality-gate / frontend（ubuntu）：ESLint → Prettier --check → vue-tsc --noEmit → `npm run test:coverage`（阈值门禁必须经 coverage 路径）；
   - quality-gate / rust（windows-latest，Linux 缺 Tauri 系统依赖）：cargo fmt --check → clippy -D warnings → cargo test；
   - quality-gate / security（ubuntu）：gitleaks（fetch-depth: 0）→ `npm audit --audit-level=critical` → cargo-deny（manifest-path 指向 src-tauri）；
   - build / tauri-build（windows）：npm run build → tauri build（bundler 下载失败清缓存重试 ≤3 次）→ 安装包产物归档；
   - build / 冒烟（windows）：debug 构建 + Vite dev server + **进程级冒烟 e2e/smoke-ci.mjs**（应用进程存活 + WebView2 初始化 + 前端真实加载；CDP / WebDriver 在 CI 不可用，禁改回 CDP 方案）。
3. **缓存**：setup-node npm 缓存；Swatinem/rust-cache（toolchain 安装必须先于其调用；workspaces 指向 src-tauri；bundler 工具链目录并入缓存并以重试兜底）。缓存中禁止存放敏感信息。
4. **本地与 CI 同源**：pre-commit（轻量：文本检查 + eslint + prettier + rustfmt）与 pre-push（重量：clippy + cargo test + vitest coverage，重量级钩子必须 `pass_filenames: false` 单次执行）覆盖 CI 主门禁；差异项（vue-tsc）见 C.6。
5. **发布**：tag 触发 release——构建 → 签名（现自签占位，正式证书经 Secrets 接入）→ 校验和 → GitHub Release；签名策略变更属规范变更。
6. **变更管控**：workflow 改动随 PR 评审；CI 安全 action 保持可用主版本（gitleaks-action 升级事项见 TASK.md）。

### C.6 永久环境约束

1. **平台锁定**：Windows（x86_64-pc-windows-msvc）；MSI 仅 Windows 可构建；Node 24（2026-10 进入维护期，届时评估升级）。
2. **内存安全**（2026-08-15 OOM 事故根治，禁止还原）：
   - vitest 并发上限 `maxWorkers: 4` + 单 worker V8 堆 `--max-old-space-size=2048`（vite.config.ts）；
   - 重量级钩子 `pass_filenames: false` 整段单次执行，禁止按文件分块并行（.pre-commit-config.yaml）；
   - 依赖大版本升级后核对配置项是否仍被识别（vitest 4 移除 poolOptions 的教训：`poolOptions.*` / `minWorkers` 禁止复活，并发限流只走 `maxWorkers` + `execArgv`）；
   - 运行测试 / 推送前检查残留 vitest 进程（甄别 CommandLine，严禁误杀其他项目的 node 进程）。
3. **本地门禁已知差异**：本地 pre-commit 无 vue-tsc——推送前必须手动 `npm run typecheck`（CI 首跑暴露 TS 错误已两次踩坑）。
4. **pre-commit 版本敏感**：升级 pre-commit ≥4.4 时 `language: system` 改名 `unsupported`，需全局替换。
5. **E2E 形态**：本地 wdio + edgedriver（tauri-driver 仅支持 Windows / Linux）；CI 冒烟为进程级方案——WebView2 Runtime 150 起提权宿主忽略 `WEBVIEW2_*` 环境变量通道属官方 by-design 安全加固（WebView2Feedback#5640，不会随版本恢复），跨 macOS 诉求出现前禁止引入 CDP 直连。
6. **脚本跨平台**：门禁脚本禁止依赖 shell glob 展开，统一引号包裹或用工具自身目录递归（`eslint .` / `prettier .`）。
