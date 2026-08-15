# 01 编辑核心 模块级调研

- 调研日期：2026-08-13
- 调研对象：Typora 官方公开文档（行为核对） + Milkdown v7 Crepe / ProseMirror 开源生态（能力边界核对）
- 上游依据：`docs/specs/00-typora-full-feature-research.md` 第 2 节（E1-E21）、第 11.2/11.3/11.4 节、第 12.2/12.3 节
- 下游用途：「01 编辑核心」模块 spec（`docs/specs/modules/01-编辑核心.md`）的撰写依据

---

## 0. 调研方法与边界声明

**clean-room 行为级调研**，来源仅限三条：

1. Typora 官方公开文档（support.typora.io 及中文镜像 support.typoraio.cn）——仅行为核对，不接触安装包/闭源代码
2. 公开标准：CommonMark、GFM
3. 开源生态公开资料：Milkdown/Crepe/ProseMirror/KaTeX/Mermaid 官方文档、npm registry、GitHub 开源仓库（MIT 协议）

本调研由两个子代理并行产出（官方文档核对 346 行 + 开源生态边界 284 行草稿），本文件为合并定稿；两份草稿已清理。

## 1. 来源清单

### 1.1 Typora 官方文档（18 页）

| 用途            | URL                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| E1-E21 语法总览 | https://support.typora.io/Markdown-Reference/（中文镜像 support.typoraio.cn/zh/Markdown-Reference/ 交叉核对） |
| 菜单快捷键      | https://support.typora.io/Shortcut-Keys/                                                                      |
| 数学块/行内数学 | https://support.typora.io/Math/                                                                               |
| 图片            | https://support.typora.io/Images/                                                                             |
| 图表            | https://support.typora.io/Draw-Diagrams-With-Markdown/                                                        |
| HTML/媒体       | https://support.typora.io/HTML/                                                                               |
| 链接            | https://support.typora.io/Links/                                                                              |
| 代码围栏        | https://support.typora.io/Code-Fences/、/Code-Fences-Language-Support/                                        |
| 表格            | https://support.typora.io/Table-Editing/                                                                      |
| 换行            | https://support.typora.io/Line-Break/                                                                         |
| 自动配对        | https://support.typora.io/Auto-Pair/                                                                          |
| 严格模式        | https://support.typora.io/Strict-Mode/                                                                        |
| 自动保存        | https://support.typora.io/Auto-Save/                                                                          |
| Windows 平台    | https://support.typora.io/Typora-on-Windows/                                                                  |
| 拼写检查        | https://support.typora.io/Spellcheck/                                                                         |
| Callouts        | https://support.typora.io/What's-New-1.8/                                                                     |

**重要结论**：官方**不存在**「偏好设置面板全集」专题页（Markdown-Preferences 与 Preferences 均 404），各设置项分散记载于上表各专题页。

### 1.2 开源生态资料（13 项）

| 资料                         | URL                                                    | 用途                                              |
| ---------------------------- | ------------------------------------------------------ | ------------------------------------------------- |
| Milkdown Using Crepe         | https://milkdown.dev/docs/guide/using-crepe            | Crepe 特性总览、API                               |
| Milkdown Crepe API 参考      | https://milkdown.dev/docs/api/crepe                    | CrepeFeature 枚举、配置项                         |
| Milkdown GitHub 仓库（MIT）  | https://github.com/Milkdown/milkdown                   | Crepe 构建源码（builder.ts 为内置插件链权威证据） |
| npm @milkdown/crepe          | https://www.npmjs.com/package/@milkdown/crepe          | 7.22.1 依赖清单                                   |
| npm @milkdown/plugin-diagram | https://www.npmjs.com/package/@milkdown/plugin-diagram | 确认已弃用（7.7.0/2025-03，peer 不兼容 7.22）     |
| KaTeX 官方文档               | https://katex.org/docs/supported.html                  | `\def`/`\gdef` 原生支持                           |
| npm katex 0.18.1             | https://registry.npmjs.org/katex                       | `katex/contrib/mhchem` 独立入口                   |
| ProseMirror guide            | https://prosemirror.net/docs/guide/                    | 增量渲染模型                                      |

## 2. 功能点核对结论（E1-E21）

> 工作量口径：无 = Crepe 开箱即用；轻 = 配置级或小插件（<100 行量级）；中 = 需自写 schema/NodeView/上传逻辑中的一部分；重 = 完整自定义插件体系。
> **加粗** = 与全量 spec 初稿存在差异的结论（调研纠错）。

| #   | 功能              | 行为核对结论（官方证据摘要）                                                                                                                                                          | 实现机制（调研后）                                                                                                                                                                                                                                                     | 工作量     |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| E1  | 段落与换行        | Enter 单空行即新段落（源码模式落盘为两个换行）；Shift+Enter 软换行；行尾两空格与 `<br/>` 为硬换行兼容语法                                                                             | Crepe commonmark 内置 paragraph/hardbreak + hardbreakKeymap                                                                                                                                                                                                            | 无         |
| E2  | 标题              | **默认非严格模式 `#` 后不强制空格（仅 Strict Mode 强制）**；Ctrl+1~6/Ctrl+0/Ctrl+=/- 均官方载明                                                                                       | 内置 heading 节点与命令；**Ctrl+1~6 非默认键位**（baseKeymap 只有 Mod-Alt-1~6），用 keymapCtx 注册                                                                                                                                                                     | 轻         |
| E3  | 引用块            | 行首 `>` 生成、Enter 自动延续、`>>` 嵌套；两引用块间需三空行分隔                                                                                                                      | 内置 blockquote + 输入规则                                                                                                                                                                                                                                             | 无         |
| E4  | 列表              | `- `/`* `/`+ `/`1. ` 创建；Tab/Shift+Tab 缩进提升；**Indent/Outdent 官方表格记载与业界常识相反（疑官方笔误，见第 8 节待确认 #1）**；Strict Mode 下缩进严格对齐                        | 内置 list + indent 插件（Crepe 强制 size=4）                                                                                                                                                                                                                           | 无         |
| E5  | 任务列表          | `- [ ]`/`- [x]`；点击复选框切换状态（官方载明）                                                                                                                                       | 内置 preset-gfm 输入规则 + ListItem NodeView 点击切换                                                                                                                                                                                                                  | 无         |
| E6  | 代码围栏          | ` ``` ` + Enter 创建；行首语言名高亮；**右下角语言切换（官方明确载明）**；复制代码/自动缩进工具（spec 遗漏）；官方语言列表约 120 种（基于 CodeMirror）                                | **实现机制纠错：Crepe 代码块 = CodeMirror 6 编辑器（非 highlight.js）；语言下拉默认空集，需注入 @codemirror/language-data 的 LanguageDescription[]**                                                                                                                   | 轻         |
| E7  | 数学块            | `$$`+Enter 创建；结束方式 4 种（方向键/Ctrl+Enter/点 ✓/点别处）；`\def`/`\newcommand` 自定义命令；`\ce{}` 化学式（mhchem）；自动编号三选项                                            | Crepe Latex Feature 内置（KaTeX）；`\def` KaTeX 原生支持；**`\ce{}` 需一行 `import 'katex/contrib/mhchem'`**；Ctrl+Enter 结束需自定义 keymap（内置为 Mod-Enter）；**自动编号建议首版不做**（KaTeX 仅 `\tag`）                                                          | 轻         |
| E8  | 表格              | `                                                                                                                                                                                     | 表头                                                                                                                                                                                                                                                                   | 表头       | `+Enter 建表；tooltip 工具栏（缩放/对齐/增删行列/拖拽行列）；对齐写入 `<td>` style；Tab 加行；Shift+Alt+Ctrl+L 删行（spec 遗漏） | 表格工具栏**内置**（增删行列/对齐/拖拽）；**建表输入规则不同：Crepe 是 ` | 2x2 | `（列x行）而非 Typora 式，需自定义 InputRule**；**Tab 内置行为是移格非加行**，末行加行需 keymap 拦截 | 轻-中 |
| E9  | 脚注              | `[^id]` 引用式；悬停预览                                                                                                                                                              | **实现机制纠错（原判「Crepe 无内置」低估）：preset-gfm 内置 footnote 节点与解析/序列化**；缺的只是悬停预览（plugin-tooltip 的 tooltipFactory 即可）                                                                                                                    | 轻-中      |
| E10 | 水平线            | 空行 `***`/`---`+Enter                                                                                                                                                                | 内置 hr 输入规则                                                                                                                                                                                                                                                       | 无         |
| E11 | YAML Front Matter | 文首 `---` 块识别；**Typora 专有属性 `typora-root-url`、`typora-copy-images-to` 应纳入解析白名单（spec 遗漏）**                                                                       | 无现成插件；**推荐形态②：加载时剥离存内存、保存/导出回写**（不进文档树，改动最小）                                                                                                                                                                                     | 中         |
| E12 | TOC `[toc]`       | `[toc]`+Enter 生成；随标题增删自动更新                                                                                                                                                | 自定义 toc 节点 + NodeView；heading 自带 id 生成（锚点跳转免费）；监听 markdownUpdated 防抖重算                                                                                                                                                                        | 中         |
| E13 | Callouts          | 1.8+ 需启用（"Github Style Alert"）；五种类型 `> [!NOTE]/[!TIP]/[!IMPORTANT]/[!WARNING]/[!CAUTION]`                                                                                   | 首版不做（与 spec 一致）                                                                                                                                                                                                                                               | —          |
| E14 | 链接              | 四种形式；点击展开编辑、Ctrl+点击浏览器打开；**隐式引用 `[Google][]`；重复标题锚点 `-1`/`-2` 后缀（spec 遗漏）**                                                                      | 内置 LinkTooltip（悬停/点击/编辑/删除/复制）；Ctrl+点击打开需小插件 + Tauri opener                                                                                                                                                                                     | 轻         |
| E15 | 图片              | `![alt](path)`；多文件拖拽、剪贴板粘贴；点击编辑源码；同目录相对路径（前提：文档已保存 + 开启选项）                                                                                   | 内置 ImageBlock + plugin-upload；唯一要写的是 onUpload 接 Tauri 写盘（属 M7 模块）                                                                                                                                                                                     | 轻-中      |
| E16 | 行内样式          | `*斜体*`/`**粗体**`/`` `代码` ``/`~~删除线~~`；单词内下划线不识别（GFM）；`<u>` 下划线（Ctrl+U）                                                                                      | 内置 GFM mark + 输入规则 + 快捷键                                                                                                                                                                                                                                      | 无         |
| E17 | Emoji             | **英文/中文文档触发方式记载不一致（`:名` 自动弹出 vs ESC 触发/选项启用后触发），待实操确认 #4**；Edit → Emoji & Symbols 菜单插入 UTF-8 emoji                                          | plugin-emoji 只有输入规则替换（twemoji 图片），**无下拉补全菜单**；Typora 式补全需自研 suggestion 插件。首版延后（与 spec 一致）                                                                                                                                       | 中（延后） |
| E18 | 上标/下标/高亮    | `^x^`/`~x~`/`==x==` 可选启用，未启用按原文处理                                                                                                                                        | 三个自定义 mark + 输入规则 + 工具栏按钮；注意 `~x~` 与 `~~` 删除线的输入规则顺序冲突。首版延后（与 spec 一致）                                                                                                                                                         | 中（延后） |
| E19 | 行内数学          | **官方 Pandoc 规则实为三条：开 `$` 后无空格/制表符；闭 `$` 前无空格/制表符且前一字符非反斜杠；闭 `$` 后不紧跟数字（spec 只写了一条）**；ESC 触发预览；默认关闭需重启；Legacy 兼容模式 | Crepe 内置 `$...$` 输入规则；**Pandoc 兼容解析需自定义 InputRule**；ESC 预览为 Typora 特有交互需自定义 keymap                                                                                                                                                          | 轻         |
| E20 | HTML/媒体         | **官方机制：常见标签渲染 + `class`/`id`/`data-*` 渲染时剥离、导出时保留；script/onload 禁用；iframe sandbox；`<video>`/`<audio>` 路径规则与图片相同（spec 遗漏视频支持）**            | 内置 html 节点 + dompurify（Crepe 自带依赖）；白名单清洗 + sandbox                                                                                                                                                                                                     | 中         |
| E21 | 图表              | 官方支持 mermaid 全系 15 种图 + legacy `sequence`/`flow` 两套语法；主题变量 `--mermaid-theme` 等；**右键另存/复制（spec 遗漏）**；使用前需启用 Diagrams                               | **实现机制纠错（最大）：Crepe 无任何图表能力，@milkdown/plugin-diagram 已弃用（peer 不兼容 7.22）**。修正：复用 CodeMirror Feature 的 renderPreview 钩子（latex 已示范同款模式）按 language === 'mermaid' 用 mermaid.js 渲染，懒加载 chunk；首版 7 种图 + 其余语言透传 | 轻-中      |

### 2.1 官方文档核对差异汇总（10 处行为级）

1. E2：默认模式 `#` 后不强制空格（仅 Strict Mode 强制）
2. E4/11.3：Indent/Outdent 官方表格疑似笔误（待实操确认）
3. E17：emoji 补全触发方式两版文档不一致（待实操确认）
4. E19：Pandoc 规则应补全为三条
5. E20：HTML 机制表述需按官方细化（渲染剥离 vs 导出保留）+ 视频/音频支持遗漏
6. E21：mermaid 15 种图 + legacy 语法 + 右键另存/复制遗漏
7. 11.2 遗漏 4 项官方菜单：Emoji & Symbols、Math Tools、Whitespace and Line Breaks、Spell Check…；Find Next/Previous 官方另有 Enter/Shift+Enter 别名
8. 12.2 auto pair markdown syntax 官方符号为 `=`（非 `==`），且 `~`/`=`/`^` 是「选中文字后包围」而非双向补全
9. E6 遗漏「复制代码/自动缩进」工具；E8 遗漏 Shift+Alt+Ctrl+L 删行
10. E11 遗漏 Typora 专有 YAML 属性 `typora-root-url`/`typora-copy-images-to`

### 2.2 开源生态核对纠错汇总（4 处实现机制）

1. **E21（最大）**：Crepe 无图表能力，官方 diagram 插件已弃用 → 复用 renderPreview 钩子自研渲染（轻-中）
2. **E6**：Crepe 代码块是 CodeMirror 6（非 highlight.js），语言列表需注入
3. **E8**：Crepe 建表输入规则是 `|2x2|` 非 Typora 式，需自定义；Tab 是移格非加行
4. **E9**：preset-gfm 内置脚注节点（原判「无内置」低估），仅缺悬停预览

## 3. 菜单与设置项核对结论

### 3.1 菜单（11.2/11.3/11.4）

- spec 所列全部菜单项及快捷键与官方 Shortcut-Keys 一致（29 项逐项核对）
- Edit 菜单需补 4 项：Emoji & Symbols（E17）、Math Tools（强制刷新数学渲染）、Whitespace and Line Breaks（E1 保留行为切换）、Spell Check…
- Find Next/Previous：官方另有 Enter / Shift+Enter 别名
- Paragraph 菜单 Indent/Outdent：**用户实测定稿——Ctrl+[ = 缩进、Ctrl+] = 反向缩进**（与官方表格一致，与 VS Code 等业界习惯相反，Typora 特有，须原样复刻并标注）
- Format 菜单全部一致；Image 菜单项官方名为 "Insert Local Images…"

### 3.2 设置项（12.2/12.3）

- Auto Save：官方默认 5 分钟（`conf.user.json` 的 `autoSaveTimer`，单位分钟）——与 spec F30 完全吻合
- Inline Math：默认关；**用户实测启用后即时生效**（与官方「需重启」记载矛盾，以实测为准）
- Strict Mode：**需重启**（官方明示）；Code Fences 各选项均需重启
- auto pair markdown syntax：官方符号为 `=`（非 `==`）；`~`/`=`/`^` 为「选中后包围」
- 用户实操回填（2026-08-13）：auto pair 两开关默认均开；Default Line Ending 默认 LF（Windows 亦 LF）；Highlight/Superscript/Subscript 开关需重启生效；其余未实测项见第 7 节

## 4. Crepe 集成与 keymap 机制要点

### 4.1 基座事实（以 builder.ts 源码为准，7.22.1）

- Crepe 基座 = commonmark + gfm preset + listener + history + indent（size=4）+ trailing + clipboard + upload
- 12 个 Feature：Cursor/ListItem/LinkTooltip/ImageBlock/BlockEdit/Placeholder/Toolbar/CodeMirror/Table/Latex 默认开；TopBar 默认关（与 Typora 菜单栏形态接近，按需启用）；AI/Diff 与首版无关
- **未内置**：emoji 补全、Front Matter、TOC、上标/下标/高亮、任何图表能力

### 4.2 Vue 3 集成（@milkdown/vue 7.22.1）

- `useEditor((root) => new Crepe({ root, defaultValue }))`，集成层自动 create()/destroy()；`useInstance()` 取底层 Editor
- 主题 CSS 必须手动 import（common/style.css + 主题文件）
- **Crepe 内部组件本身是 Vue 3 渲染**：主应用需与其共享单一 Vue 运行时（打包 dedupe），否则双实例异常

### 4.3 keymap 机制

- `keymapCtx` 的 `addObjectKeymap` / `add({ priority })`；冲突按 priority 降序 + chainCommands，先返回 true 者胜
- Ctrl+1~~6 注册在 config 阶段（create() 之前）；与 baseKeymap 的 Mod-Alt-1~~6 无冲突
- 表格内 Tab 加行需 priority > 100（与内置 goToNextTableCellCommand 竞争）
- Ctrl+W/Ctrl+Tab 等窗口级快捷键留给 Tauri 菜单层（C1 快捷键体系），编辑器内不重复注册

### 4.4 性能与依赖

- ProseMirror 增量渲染架构适合大文档（官方无 benchmark，需实测）；Crepe 代码块有 IntersectionObserver 懒初始化 + 离屏 5s teardown 优化
- `getMarkdown()` 是全量序列化 O(n)：自动保存（F30）、字数统计（S3）必须防抖
- Mermaid 体积大：懒加载 chunk
- 版本锁定：@milkdown/crepe/kit/vue 三者同版本（7.22.1 互锁）；**禁用 @milkdown/plugin-diagram**
- 首版用全量 Crepe（桌面应用体积不敏感），瘦身走 CrepeBuilder.addFeature

## 5. 工作量分布（21 点）

- **无（开箱即用）**：E1、E3、E4、E5、E10、E16（6 点）
- **轻**：E2、E6、E7、E14、E19、E21（6 点）
- **中**：E8、E9、E11、E12、E15、E20（6 点）
- **重**：无——不需要从零实现任何 ProseMirror 内核能力，选型总体可行
- **延后/不做**：E13（不做）、E17、E18（延后，届时各为中）

## 6. 对全量 spec 的待修正项（写模块 spec 时同步回改）

1. 00 号 spec 第 2 节 E19：Pandoc 规则补全为三条
2. 00 号 spec 第 2 节 E21：图类型列表补全 + 右键另存/复制
3. 00 号 spec 第 11.2 节：补 4 项菜单 + Find Next 别名
4. 00 号 spec 第 12.2 节：auto pair 符号 `==` → `=`，补充「选中后包围」语义
5. 00 号 spec E6/E8/E9/E21 的「实现机制」列按 2.2 纠错修正
6. 00 号 spec E8 行表格语法（`| 表头 |` 未转义导致表格渲染损坏）

## 7. 待用户实操确认清单（12 项）

> 用户实测回填后更新本表并同步模块 spec。来源：官方文档未载明/记载模糊/自相矛盾的行为。

| #   | 事项                                                                 | 回填结果（2026-08-13 用户实测）                                                                                            |
| --- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | Indent/Outdent 快捷键实际配对（官方疑笔误）                          | ✅ Ctrl+[ = Indent、Ctrl+] = Outdent（与官方一致，反业界习惯，须原样复刻）                                                 |
| 2   | Auto pair 两开关默认状态                                             | ✅ 默认均开                                                                                                                |
| 3   | Default Line Ending 默认值                                           | ✅ 默认 LF（Windows 亦为 LF，官方 Issue 开发者确认）                                                                       |
| 4   | Emoji 补全触发方式与偏好设置选项名                                   | ✅ 输入 `:` 自动弹出（默认开）；ESC 可手动触发；v1.11 起选项名「Disable emoji autocomplete when typing `:`」（默认不勾选） |
| 5   | Windows 版「Emoji & Symbols」菜单项名称                              | ✅ Windows/Linux 无此菜单项（macOS 专属）→ 我们首版不做该菜单项                                                            |
| 6   | 表格 Tab 加行的精确触发位置                                          | ✅ 中间单元格=跳下一格；任意行最后一个单元格按 Tab=表格末尾新增一行                                                        |
| 7   | Ctrl+A 在代码块内的选择范围                                          | ⚠️ 未实测到（推测首次选整块/再次选全文）→ 保持待确认，实现阶段按 Crepe 默认行为验证                                        |
| 8   | Highlight/Superscript/Subscript/Legacy math 等开关生效时机           | ✅ 需重启生效（社区反馈）；Inline Math 用户实测即时生效                                                                    |
| 9   | Code Fences 各选项与 Inline Math 默认值                              | ⚠️ Code Fences 子项默认值未实测到（待确认）；Inline Math 默认关闭 ✅                                                       |
| 10  | 软换行/连续空格「编辑保留、导出忽略」设置项名称与分区                | ✅ 默认行为成立（编辑保留、导出忽略/折叠为空格）；设置位于偏好设置→Markdown 分区                                           |
| 11  | Indent Size for Code 的具体语义                                      | ⚠️ 未回填 → 待确认（实现阶段暂按「N 个空格渲染制表符」语义）                                                               |
| 12  | 代码块语言列表最终范围（实现阶段做 highlight/CodeMirror 映射时验证） | 归实现阶段                                                                                                                 |
