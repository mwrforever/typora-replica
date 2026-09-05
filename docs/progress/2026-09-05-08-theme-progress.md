# 08 主题模块交付 · 进度文件

> 本文件为交付 loop（`docs/prompt/2026-09-05-loop-08-主题模块交付.md`）的主控进度事实源：阶段状态、决策日志、派遣日志、AC 证据核对区。
> 状态续传规则：每任务、每门禁通过立即更新本文件与 SDD ledger；会话中断后以本文件 + ledger + `git log` 为准恢复。
> 上一份交接：`docs/progress/2026-09-05-07审核合入与CI修复.md`。

## 元信息

- 执行文档：`docs/prompt/2026-09-05-loop-08-主题模块交付.md`
- 功能 spec：`docs/specs/modules/08-主题.md`（18 条 AC，T1~T8）
- 调研依据：`docs/specs/research/08-主题-research.md`
- 工作区：`D:\code\project\typora\.worktrees\08-theme`（worktree，分支 `feat/08-theme`，基于 test HEAD `2b77db6`）
- 主仓：`D:\code\project\typora`（checkout `test`）
- 开工日期：2026-09-05

## 阶段状态表

| 阶段 | 名称 | 状态 | 出口门禁结论 |
| --- | --- | --- | --- |
| P0 | 环境与分支准备 | ✅ 完成 | worktree 就绪；基线四项全绿；gh 可用；进度文件已提交 |
| P1 | 实施计划撰写 | ✅ 完成 | 计划 7f7b442 已提交；16 条 AC 全映射；18 任务全标注；7 批次合规；自审三查留痕（附录 C） |
| P2 | SDD 预检与批次登记 | ✅ 完成 | ledger 首行为本计划标识；pre-flight 6 冲突主控裁决→计划修订 27a2d04；批次表已登记 ledger |
| P3 | 分批 TDD 实现与批审 | ⬜ 未开始 | — |
| P4 | 全分支终审 | ⬜ 未开始 | — |
| P5 | 端到端验收 | ⬜ 未开始 | — |
| P6 | PR 与 code-review 插件审核 | ⬜ 未开始 | — |
| P7 | 终验与收尾 | ⬜ 未开始 | — |

## P0 基线证据（2026-09-05）

1. **worktree**：`git worktree add .worktrees/08-theme -b feat/08-theme test` 成功；`git worktree list` 显示 `D:/code/project/typora/.worktrees/08-theme 2b77db6 [feat/08-theme]`。
2. **gitignore**：`.worktrees` 原未被忽略 → `feat/08-theme` 上提交 `517fd26 chore: gitignore 增补 .worktrees——隔离工作区目录防误入库`（pre-commit 钩子通过），随 PR 合入。
3. **setup**：`npm install` exit 0（added 1080 packages）；`cargo fetch` exit 0。
4. **进程甄别**（宪法 C.6.2）：`Get-CimInstance Win32_Process` 核查 node 进程，现有进程均属 MindSoar 等其他项目，**无残留 vitest 进程**，无需处置。
5. **基线四项门禁**（worktree 内全量新跑）：
   - `npm run typecheck` → exit 0
   - `npm run lint` → exit 0
   - `npm test` → 首跑 1 个测试文件级失败（782 passed + 24 skipped，零断言失败）；**复跑 `npx vitest run` 85/85 文件全绿、806/806 测试全过（exit 0）**。判定：首跑冷启动偶发（文件级崩溃而非断言失败），以复跑全绿为基线证据；后续 P3/P5 门禁若再现文件级失败按同口径复跑甄别。
   - `cargo test --manifest-path src-tauri/Cargo.toml` → exit 0（108+ 全过，doc-tests 0）
6. **gh**：`gh auth status` exit 0（mwrforever 已登录，scopes 含 repo/workflow）。

### 07 模块移交项（P1 计划必纳入）

1. `.markwell-dark` 类激活点全项目缺失——明暗主题切换正是激活点归属模块（08 明暗分离接线时一并处理：居中守护暗色段 / 右键菜单 `--crepe-color-*` 变量盲区恒亮色）。
2. 设置 UI 归 10 时按 `markwell-settings-updated` 字面量契约 dispatch（07 已留常量与监听）——08 明暗主题选择若与设置联动须对齐该契约。

## P1 计划证据（2026-09-05）

- 计划文件：`docs/superpowers/plans/2026-09-05-08-theme.md`（3082 行，UTF-8 无 BOM、LF），提交 `7f7b442`。
- 出口门禁核验（主控）：
  - writing-plans 计划头（Goal / Architecture / Tech Stack / Global Constraints 18 条）✅；每任务含 RED/GREEN 步骤与验证命令 ✅
  - AC 映射表 16 行全覆盖（`grep` 核对 AC-T1-1…AC-T8-2 无空缺）✅；spec §1.1 范围 11 项承接核对行 ✅
  - 18 任务全部标注复杂度（`grep -c "^### Task"` = 18，`grep -c "复杂度："` = 18）✅
  - 批次表 B1~B7：简单批 B1/B6 各 3 任务，复杂批 B2(2)/B3(3)/B4(3)/B5(3)/B7(1)，不跨 spec §6 阶段 ✅
  - 占位符扫描：无 TBD/待定；唯一 TODO 为合规预留标注 `TODO(theme-ui)` ✅
  - 自审三查结论留痕于计划附录 C ✅
- 计划锁定裁决 D-1~D-10（内置主题 Rust 资产+setup 预置 / opener open_path / 系统跟随不钉死 setTheme / 双选择器作用域 / notify 静默 unwatch 接受披露 / 命令层 mock 直呼豁免 / ?t= 防缓存 / read_dir 精确匹配大小写 / media query 零改写 / URL 安全由命名规则保证）——按推荐方案执行，PR 把关可否决。
- 主控对计划的两处修订：①AC 映射表加勘误注（spec §7「18 条」实为 16 条）；②Task 17 改为更新主仓本地 README.md、不入库不做空提交。

## P2 预检证据（2026-09-05）

- SDD 工作区：`.worktrees/08-theme/.superpowers/sdd/2026-09-05-08-theme/`（`scripts/sdd-workspace` 建立，git-ignored 已验证）；ledger `progress.md` 首行 `# SDD ledger — plan: docs/superpowers/plans/2026-09-05-08-theme.md`。
- pre-flight 冲突扫描（派遣扫描专员通读 3082 行计划）：**6 项冲突 + 8 条提示**，主控逐项裁决（全部为 L1 可推出的技术层修订，不涉 spec 行为/范围，故不升级用户——红线 7），续派计划专员修订落地，提交 `27a2d04`（计划 3224 行）。
- 批次表 B1~B7 已登记 ledger（BASE 开批时回填）。
- todo 映射：TodoWrite 以批次为粒度（B1~B7），任务级进度由 ledger 承担（SDD 恢复地图）。

## 决策日志

| 时间 | 阶段 | 层级 | 决策 | 依据 |
| --- | --- | --- | --- | --- |
| 2026-09-05 | P0 | L1 | vitest 首跑 1 文件级失败判为环境偶发，以复跑 85/85 全绿为基线 | 复跑 exit 0、零断言失败；宪法 C.6.2 内存约束下的冷启动现象 |
| 2026-09-05 | P0 | L1 | `.gitignore` 增补提交落在 `feat/08-theme` 而非直接提交 `test` | 宪法 C.4：一切经模块分支 PR 合入 test；技能要求忽略规则先行生效 |
| 2026-09-05 | P0 | L1 | **loop 三产物（计划 / 进度文件 / 终验报告）以 `git add -f` 入库**，与 `1a44a76`（2026-08-16「非代码与宪法文档退出版本库」用户裁决，.gitignore:60 `docs/`）存在张力 | 执行文档 §0.3 逐项明示「git 提交」且已知悉 git-ignored 概念（同表区分 SDD 工作区为 scratch）；P0/P1/P7 出口门禁与 DoD 均要求 git 提交；宪法正文无禁止条款；三产物为新文件、主仓无同名未跟踪文件、无 pull 冲突。**列入 PR 披露，请用户把关时裁决是否更新 .gitignore 注释或 revert** |
| 2026-09-05 | P1 | L1 | **README.md 不入库**：Task 17 改为更新主仓本地 README.md（7 行模板 → 追加主题节），宪法 B.5.6 以工作树同步满足 | 1a44a76 裁决明确含 README.md；主仓已有同名未跟踪文件，入库会致合入后 `git pull` 拒绝覆盖；DoD「README 已随 PR 同步」在 P7 终验如实记录为「工作树同步 + 披露」 |
| 2026-09-05 | P1 | L1 | spec §7「AC 共 18 条」实为 16 条（AC 表逐条计数），实现以 16 条为准全覆盖；spec 计数勘误待用户同意后回改 | 宪法 B.2.2 改 spec 须用户同意；不影响功能行为，列 PR 披露 |
| 2026-09-05 | P1 | L1 | 采纳计划 D-6：命令层不 mock 直呼（偏离宪法 A.6.5 先例），核心函数显式 `dir` 参数 100% 单测 + DTO 序列化钉桩 + E2E 实证 wire | 计划专员源码实证：mock 运行时 identifier 为空串，`app_data_dir()` 解析到真实 %APPDATA%，直呼会触达真实用户数据；列 PR 披露 |
| 2026-09-05 | P2 | L1 | pre-flight A-1：Task 10 四处 `const [, args] = mock.calls[0]` 解构笔误 → 统一为 `mock.calls[0]?.[0]` + `toBeDefined` 守卫（Task 13 同款） | 单参调用 index 1 恒 undefined，strict 下编译错；计划内两种写法互证 |
| 2026-09-05 | P2 | L1 | pre-flight A-2：Task 13 App.vue cleanup 句柄在 onMounted 回调内声明对 onBeforeUnmount 不可见 → setup 顶层 `let cleanupThemeFeature: (() => void) \| undefined`，onMounted 赋值、onBeforeUnmount `?.()`，三处同落 Task 13 | 作用域可见性；最少改动原则避免 Task 8 阶段 void 赋值类型错 |
| 2026-09-05 | P2 | L1 | pre-flight A-3：Task 7 `upsertLink` 移除后重建 appendChild 致层序倒置 → 采纳方案③按 `LAYER_ORDER` 定位 insertBefore/append，新增顺序守卫 RED 用例 | spec T6 四层顺序为契约；边缘路径（主题目录一度为空 + base.user.css 存在）真实可达 |
| 2026-09-05 | P2 | L1 | pre-flight B-1：新增 API 全部 `undefined` 表「无」（resolveActiveTheme / ActiveThemeRefs.theme / upsertLink href / 各 timer 与 stop 句柄）；保留 null 仅 DOM 原生签名对齐处并附中文注释 | 宪法 A.1.2.3 + 计划 Global Constraints 行 19 |
| 2026-09-05 | P2 | L1 | pre-flight B-2：Task 15 为钉桩任务（无生产代码可转绿）显式豁免 RED 并声明；断言失败按 bug 流程回修 Task 3/7 | TDD 铁律适用于有实现体的任务；豁免须明示，列 PR 披露 |
| 2026-09-05 | P2 | L1 | pre-flight C-1：Task 9 `start_theme_watch` 与 watch.rs:109-119 约 12 行接线胶水重复——**接受**，不重构 02 命令；docstring 留痕 + 附录 A 预登记 | 全局「精准修改」约束优先于 12 行胶水 DRY；核心件 watch_dir_inner/flush_loop 已复用 |
| 2026-09-05 | P2 | L1 | pre-flight D8-①：Crepe 变量实为 23 个（含 `--crepe-base-font-size`），spec §3 / 调研「22 个」为漏计；实现按 23 个断言，spec 勘误待用户同意 | node_modules crepe/style.css:1-23 实证；宪法 B.2.2 |
| 2026-09-05 | P2 | L1 | pre-flight D8-②：Task 18 E2E 前置补「wdio.conf 配置加载期经 store 文件重置 settings.theme 为默认、onComplete 还原原字节」 | themeStore.init 仅启动读一次设置，spec before 钩子晚于装载；07 E2E fixtures 配置加载期预生成为既有先例 |
| 2026-09-05 | P2 | L1 | pre-flight D4/D5/D6：同步命令内同步 IO / `Result<T,String>` / `std::thread::spawn` 三项与宪法字面张力——延续 02 既有形态不新引入模式，附录 A 汇总披露 | 宪法 A.1.1 既有风格优先；commands.rs/watch.rs/search.rs 实证 |

## 派遣日志

| 时间 | 阶段 | 角色 | 输入 | 产出 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 2026-09-05 | P1 | 计划专员（首派） | spec / 调研 / 宪法 / 执行文档 / writing-plans | 无（600s 无活动超时，无半成品） | 空返回，按防崩溃约束重派 |
| 2026-09-05 | P1 | 调研专员（Explore） | 16 项依赖面核查清单 | 结构化核查报告（路径:行号证据） | 完成；关键结论：12 菜单/10 设置未落地、CSP style/font-src 缺 asset:、.markwell-dark 激活 JS 空白、watch.rs 三件套可复用 |
| 2026-09-05 | P1 | 计划专员（重派，携核查结论） | spec / 调研 / 宪法 / 执行文档 / writing-plans / 07 计划先例 / 核查报告 | `docs/superpowers/plans/2026-09-05-08-theme.md` | 完成；自审三查通过；主控复核后两处修订并提交 7f7b442 |
| 2026-09-05 | P2 | pre-flight 扫描专员 | 计划全文 / 宪法 / 全局规范 / task-reviewer rubric | 6 冲突 + 8 提示结构化报告 | 完成；主控逐项裁决（见决策日志） |
| 2026-09-05 | P2 | 计划专员（续派修订） | 主控 8 项裁决 | 计划修订（3224 行）+ 类型一致性重跑通过 | 完成；主控抽查验证后提交 27a2d04 |

## AC 证据核对区（16 条——spec §7「18 条」为计数笔误；P3 起逐条回填）

| AC | 描述 | 验证层级（计划核定） | 承接任务 | 测试文件/命令 | 状态 |
| --- | --- | --- | --- | --- | --- |
| AC-T1-1 | 主题目录含 3 个 .css 时菜单列出 3 个主题（含内置） | Rust 单测 + Vitest + E2E（菜单 UI 段降级，披露） | Task 2/3/8/18 | Rust `scan_filters_and_sorts_valid_css_ac_t1_1` 等 14 项（cargo test themes 14 passed）；Vitest theme-store 装配用例（域内 14 passed）；E2E 段待 Task 18 | ◐ 数据链路 ✅ |
| AC-T1-2 | 选择某主题界面即时切换样式 | Vitest + E2E | Task 7/8/18 | Vitest theme-css 重挂 8 用例 + theme-store selectTheme 持久化+立即注入；E2E 段待 Task 18 | ◐ 注入链路 ✅ |
| AC-T2-1 | Open Theme Folder 打开资源管理器 | Rust 实现 + Vitest 服务契约（按钮触发降级，披露） | Task 4/6 | Rust `open_theme_folder`（opener open_path，D-2）+ capability `allow-open-theme-folder` + theme-io 契约用例；实际弹出 E2E 待 Task 18 | ◐ 命令面 ✅ |
| AC-T3-1 | 复制新主题 css 热刷新后出现在菜单 | Rust 单测 + Vitest（菜单呈现段降级，披露） | Task 9/10 | Rust watch_themes 真实临时目录写文件→Channel 批次断言；Vitest 事件→防抖→store.themes 更新；菜单 UI 段归 12 | ◐ 数据链路 ✅ |
| AC-T3-2 | 修改已激活主题 css 界面即时刷新 | Vitest + E2E | Task 10/18 | Vitest AC-T3-2 用例（事件→300ms 防抖→重挂 ?t= 变化）；E2E 段待 Task 18 | ◐ Vitest ✅ |
| AC-T4-1 | my-first-theme.css → "My First Theme" | Rust 单测 | Task 1 | `label_splits_and_capitalizes_ac_t4_1` ok | ✅ |
| AC-T4-2 | theme2.css（含数字）不入菜单 | Rust 单测 | Task 1/2 | `digit_in_name_rejected_ac_t4_2` ok | ✅ |
| AC-T4-3 | MyTheme.css（大写）不入菜单 | Rust 单测 | Task 1/2 | `uppercase_rejected_ac_t4_3` ok | ✅ |
| AC-T5-1 | 亮/暗主题分设，系统明暗切换自动应用 | Vitest（真实系统切换不可 E2E，披露） | Task 12/13 | | ⬜ |
| AC-T5-2 | 主题内 media query 自适应生效 | Vitest 注入零改写钉桩 + 设计保证 D-3/D-9（披露） | Task 7 | | ⬜ |
| AC-T6-1 | base.user.css 对所有主题生效 | Rust 单测 + Vitest | Task 2/7 | Rust hasBaseUserCss 扫描 + Vitest 第 3 层挂载用例 | ✅ |
| AC-T6-2 | {theme}.user.css 仅该主题生效 | Rust 单测 + Vitest | Task 2/7 | Rust hasUserCss 扫描 + Vitest 第 4 层挂载/随主题移除用例 | ✅ |
| AC-T6-3 | 文件名大小写不匹配不生效 | Rust 单测（read_dir 精确匹配 D-8） | Task 2 | `scan_detects_user_css_case_sensitive_ac_t6_1_2_3` + B1 修复轮判别力增强用例（exists() 形态必红实证） | ✅ |
| AC-T7-1 | debug 构建 Shift+F12 开合 DevTools | Vitest + Rust cfg 编译验证（可视断言手动，披露） | Task 14 | | ⬜ |
| AC-T8-1 | 主题引用 ./fonts/x.woff2 正确加载 | Vitest 组合证据（披露） | Task 15 | | ⬜ |
| AC-T8-2 | 内置主题 rem 字号跟随字号偏好 | Vitest rem 钉桩（偏好联动待 10，披露） | Task 3/15 | | ⬜ |

## spec 三阶段验收门

| 阶段 | AC 集 | 状态 |
| --- | --- | --- |
| P1 主题基座 | AC-T1 / AC-T2 | ◐ 数据/注入/命令面 ✅（B3 收批核验），E2E 段随 Task 18 补全 |
| P2 管理增强 | AC-T3 / AC-T4 / AC-T6 | ◐ T4/T6 ✅；T3 数据链路 ✅（E2E 段随 Task 18 补全） |
| P3 明暗与字体 | AC-T5 / AC-T7 / AC-T8 | ⬜ |

## 七项全量门禁记录（P3 末首跑 / P5 复跑为最终证据）

| 门禁 | P3 首跑 | P5 复跑 |
| --- | --- | --- |
| `npm run typecheck` | ⬜ | ⬜ |
| `npm run lint` | ⬜ | ⬜ |
| `npm run format:check` | ⬜ | ⬜ |
| `npm run test:coverage` | ⬜ | ⬜ |
| `cargo fmt -- --check` | ⬜ | ⬜ |
| `cargo clippy -D warnings` | ⬜ | ⬜ |
| `cargo test` | ⬜ | ⬜ |
