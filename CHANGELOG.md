# CHANGELOG — 工程变更记录

> 本文件记录工程规范与体系级变更（先记变更再改正文）。代码级变更走 git 提交历史，不在此重复。

## 2026-09-06 09 导入导出模块 Rust unsafe 引入与新增依赖登记（规范变更，A.1.3.2 例外通道）

- **unsafe 引入（批4-F2 追认登记）**：09 PDF 导出在 `src-tauri/src/io/pdf.rs` 引入 WebView2 COM 打印段（`ICoreWebView2_16::PrintToPdfStream` + NavigationCompleted 事件等待 + IStream 流读取），全部 unsafe 块逐块附 `// SAFETY:` 注释——走宪法 A.1.3.2「确需引入属规范变更：须评审并逐块附 SAFETY 注释」例外通道，条款正文不变。**PR 披露追认安排**：本变更随 09 分支 PR 合入 test 时在 PR 描述强制披露清单中列明，用户把关合入即追认完成。
- **新增运行时依赖**（版本以 src-tauri/Cargo.toml 与 Cargo.lock 实测为准）：webview2-com 0.38.2（版本对齐 tauri 内部同源依赖，防嵌套双拷贝）、windows 0.61 / windows-core 0.61（COM 接口 cast 与 IStream 读取；0.61 而非 0.62 系 webview2-com 0.38.2 依赖声明使然）、thiserror 2（`ExportPdfError` 错误枚举，A.1.3.3）。AGENTS.md C.2 技术栈表已同步追加「PDF 打印」行。
- **spec 背书**：打印管线设计定稿于 docs/specs/modules/09-导入导出.md §5（spec 属 docs/ 不入库，仅工作树）。

## 2026-09-06 08 模块交付后用户裁决四项（PR 待合入）

- **文档入库策略修正（推翻 1a44a76 部分内容）**：用户核实明确提交白名单 = **宪法体系文件（AGENTS.md/CLAUDE.md/CHANGELOG.md/TASK.md）+ README.md + 代码**，docs/ 下内容一律不入库（2026-09-06 第二次确认将 CHANGELOG.md/TASK.md 纳入白名单并随本条目入库）。落地：① .gitignore 移除 AGENTS.md / README.md 忽略行（两者回归版本库，经 prettier --check 预检通过）；② PR #13 中以 `git add -f` 入库的三个 loop 产物（实施计划/进度文件/终验报告）`git rm --cached` 移出版本库（工作树保留，回归 gitignored 状态）；③ **历史残留披露**：三文件在 PR #13 合并提交（b81aa75）中的历史无法不改写 test 分支而清除，属既成事实，本提交后不再新增。
- **typora-var-bridge.css 并入 crepe-overrides.css（用户裁决 D-9 选 (b)）**：消除宪法 A.1.2.11 / B.1 全局样式两文件白名单的违反（code-review 插件流程查出、PR #13 披露 D-9）；层序与特异性行为等价（映射段置于 crepe-overrides 尾部=原独立文件静态引入顺序），TDD 先改钉桩宿主转红再搬迁转绿。
- **spec 勘误两项（用户同意，宪法 B.2.2 闭环）**：docs/specs/modules/08-主题.md §7「AC 共 18 条」实为 16 条（计数笔误）；§3「Crepe 22 个变量」实为 23 个（官方口径漏计 --crepe-base-font-size）。spec 属 docs/ 不入库，仅工作树修正。
- **eslint ignores 显式化（门禁加固，07 残留暴露）**：eslint.config.js 全局 ignores 增补 `.superpowers/**` 与 `docs/**`——过程文档工作区不入库也不参与 lint。诱因：主仓工作树残留 07 模块 SDD scratch（`.superpowers/sdd/2026-08-25-07-image-paste/lcov-scan.cjs`，含 2 error）致主仓 `npm run lint` 红（08 交付期门禁均在 worktree 跑、worktree 无 07 残留故从未暴露）；与白名单裁决同源落地（gitignored 隐式跳过 → 配置显式声明）。07 SDD 残留目录本体处置登记 TASK.md。

## 2026-09-05 J5/J7b 裁决执行（用户指令「处理并一并合入」，PR #11/#12 合入 test）

- **J5（PR #11）**：cargo-deny advisories 矩阵拆分落地（用户改判「现在处理」，推翻此前延后建议）——security job 拆为两步：`check bans licenses sources` 严格阻断 + `check advisories` continue-on-error 仅报告。踩坑留档：cargo-deny-action 的 `arguments` 是单字符串通道，多值检查清单必须拼入 `command`（官方 README 形态），首跑 21s 失败实证后修正。
- **J7b（PR #12，规范变更）**：tsconfig.json 启用 `noUncheckedIndexedAccess`（索引访问类型含 undefined，编译期拦截越界），162 处存量同 PR 先行整改：26 个 spec 文件 120 处非空断言收窄（测试语义零变化）+ 12 个生产文件 42 处守卫优先/断言附中文不变量注释。全量门禁：typecheck 零错误、806 用例全绿、全局 ≥80% + 核心域 100% 覆盖率达标。
- **过程教训两则**（整改专员自曝 + 主控复核修正）：① OutlinePanel.vue 首版误删运行时守卫滥用 `!` 致 3 用例 TypeError，纠正为循环上界 `i < list.length - 1` 诚实边界收窄；② html-merge.ts 首版防御性守卫在唯一调用方循环界内不可达、true 分支无法被测试覆盖而打破核心域 100% 覆盖率——不可达防御分支应以断言 + 不变量注释表达，而非留下永不执行的死分支。
- 此前 J7a/J8 已随 PR #10 合入（397b936）；至此宪法重写体系的全部裁决项（J1–J8）与调研项闭环完毕。

## 2026-09-05 编译器与本地门禁配置加固（TASK J7a/J8）

- **J7a（规范变更）**：tsconfig.json 启用 `verbatimModuleSyntax`（Vue 官方基线推荐项）——未修饰的类型导入不再原样保留进产物，编译器兜底此前仅由 ESLint + review 把关的类型导入纪律（宪法 A.1.2.5）。存量实测零错误（2026-09-05 全量 vue-tsc + vitest coverage 双绿验证）。
- **J8**：.pre-commit-config.yaml 固化 `default_install_hook_types: [pre-commit, pre-push]`——新环境仅执行 `pre-commit install` 即可同时安装两级钩子，防止漏装 pre-push 重量级门禁。
- J7b（`noUncheckedIndexedAccess`，162 处存量约 5–8h）维持待办：08 主题后绑定专项独立 PR 分批整改（TASK.md J7）。J5（cargo-deny advisories 拆分）按登记建议延后：保持 advisories 阻断的严格门禁姿态，出现首次公告误伤时再拆。

## 2026-09-05 待调研项核实闭环 + 宪法实证微修

- **核实**：宪法 B 组 7 条待调研项全部闭环（证据留档 `docs/agmds-research/2026-09-05-待调研项核实报告.md`）：store 路径基准 = app_data_dir；store Rust 端 auto_save 默认 100ms 且优雅退出无条件落盘；notify 8.2 Windows 溢出=静默 unwatch 无通知；Pinia 4.x 三项行为与 v3 一致（「return 全部 state」为工程纪律非库强制）；prosemirror-search 与 @milkdown/prose 实证同源（单实例）；vitest thresholds 未达标退出码 1；WebView2 CDP 回归溯源至 WebView2Feedback#5640（Runtime 150 by-design 安全加固）。
- **J6 闭环**：npm 11.16.0（2026-05-27）起原生支持顶层 `allowScripts`（advisory 模式），本仓字段形态与官方逐字一致，无需迁移键位；npm 12 将转为强制生效，届时补 approve-scripts 审批流程。
- **J7 评估完成**：`verbatimModuleSyntax` 零存量错误（可启用）；`noUncheckedIndexedAccess` 162 处约 5–8 小时（须专项独立 PR）。
- **宪法微修三处**（实证补强与溯源，无条款放宽）：A.5.4 补 notify 溢出兜底义务；B.2.5 prosemirror-search「核验前冻结」更新为「同源已核验 + 禁止新增直装维持」；C.6.5 补 WebView2 CDP 官方定性溯源。

## 2026-09-05 CI 门禁加固（TASK J3/J4，PR #9 合入 test）

- **J3**：quality-gate 的 gitleaks-action `@v2`→`@v3`——GitHub 2026-09-16 起移除 Node 20 action 运行时，v2 届时失效；v3 仅运行时迁移、行为不变。
- **J4**：三 workflow 权限最小化——quality-gate/build 顶层新增 `contents: read` 兜底；release 的 `contents: write` 从 workflow 级下沉至 release job 级。
- **验证**：PR CI 5/5 全绿（security job 实跑 gitleaks v3）；test 合入后 push 触发的 CI 另行确认。遗留披露：release tag 链路留下次发版实跑验证。

## 2026-09-05 宪法草案晋升生效（用户批准）

- **变更**：`AGENTS.md.draft` 晋升为根 `AGENTS.md`（新宪法 v2.0 体系正式生效）；根索引 `CLAUDE.md` 移除草案过渡说明行。
- **归档**：旧 89 行版 AGENTS.md → `docs/archive/AGENTS-v1.0-89行版.md`；旧详细版 `docs/全局开发宪法.md` → `docs/archive/全局开发宪法.md`（均未删除）。
- **登记同步**：TASK.md J1/J2 闭环，J3-J8 保留待办（J3 gitleaks v3 升级 2026-09-16 前须完成）。

## 2026-09-05 宪法体系重写（草案）

- **变更**：按 constitution-generator 技能流程重写项目宪法。旧版单文件宪法（根 AGENTS.md 89 行，v1.0）重写为「整仓单应用」全量宪法（Part A 技术栈通用 / Part B 架构分层 / Part C 项目实际，含约束效力总则与配套文件职责），并新增根索引 CLAUDE.md（纯链接入口）。
- **草案落点**：`AGENTS.md.draft`（修订模式默认，旧 AGENTS.md 未动，经用户确认后晋升替换）；`CLAUDE.md` 为新建文件直接落盘。
- **依据**：5 份官方文档调研报告（`docs/agmds-research/2026-09-05-*.md`：CI 链与生产落地 / TS-Vue-Vite 前端栈 / Milkdown-ProseMirror-Pinia / Rust-Tauri2 桌面端 / 构建测试门禁工具链）。
- **内容性更新**（相对旧宪法）：
  1. 分支策略勘误：模块合入目标由「PR 合入 main」更新为「一律合入 test，main 冻结」（2026-08-23 已定案，旧文 §6.3 未同步）。
  2. 新增 Tauri 2 官方约束条款：command 线程模型（同步命令默认主线程）、managed state 注入纪律、watcher 生命周期、退出清理落点（`RunEvent::ExitRequested/Exit`）、IPC 序列化契约（camelCase / 大负载 `ipc::Response` / 错误必须可序列化）。
  3. 新增 A.7 跨层数据对象与传参约束（按 TS / Rust / IPC 三侧习语翻译）。
  4. 新增 Milkdown/ProseMirror/Pinia 运行时纪律（单向数据流、插件三段式清理、schema upsert 原位替换、store 职责边界）。
  5. 内存安全、安全底线（DOMPurify / iframe sandbox E20）、性能预算（200/400/500ms 链路）、12 模块接口锁定等既有裁决全部保留并归位到对应章节。
- **遗留处置**：旧版详细宪法 `docs/全局开发宪法.md`（111 行）与新宪法体系职责重叠，处置方式（归档/删除）登记 TASK.md 待用户裁决。
- **调研发现的待办**：gitleaks-action v2→v3 升级（2026-09-16 前必须完成）、workflow permissions 最小化等，登记 TASK.md。
