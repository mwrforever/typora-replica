# Typora 全量功能调研 Spec（行为级）

- 版本：v1.4（2026-08-13）
- 状态：已校准（第 10 节 6 项全部经用户确认）
- 范围：MarkWell（typora-replica）功能范围基准

---

## 0. 调研方法与边界声明

**调研来源（全部为公开合法渠道，clean-room 行为级调研）：**

1. Typora 官方公开文档 support.typora.io / support.typoraio.cn（镜像同源）及其公开文档源码仓库 `typora/support.typora.io`
2. 用户实操经验（Typora 重度用户行为校准）
3. 公开标准：CommonMark、GFM（GitHub Flavored Markdown）
4. 开源生态通用实现机制（Milkdown/ProseMirror、md-tauri 等同类项目）

**边界**：本 spec 只描述**用户可观察的行为规范**（做什么、如何触发、边界如何），不涉及 Typora 内部代码；"实现机制"一栏给出的是通用技术方案与我们的选型。

**范围裁决规则**（用于后续模块拆分）：

- ✅ 采纳：Typora 核心体验（WYSIWYG 编辑、文件管理、大纲、搜索、主题、导出、自动保存）
- ⚠️ 差异化：平台差异行为（Windows 无标签页）——我们作为独立产品按"全功能版"需求**统一支持标签页**
- ❌ 暂不采纳：依赖第三方服务的功能（云上传器接入）、Pandoc 全格式导出（首版只做 HTML/PDF）、Windows JumpList、macOS 专属行为

---

## 1. 功能清单总览（按域）

| 域         | 功能点数 | 来源报告                           |
| ---------- | -------- | ---------------------------------- |
| 编辑与语法 | 21       | M1 编辑核心                        |
| 文件与导航 | 31       | M2/M3/M4/M5                        |
| 主题       | 9        | M8 主题系统                        |
| 导出       | 8        | M9 导入导出                        |
| 图片       | 11       | M7 图片处理                        |
| 设置       | 3        | M10 设置与快捷键                   |
| 跨域横切   | 5        | 自动保存/字数/焦点模式/快捷键/安全 |

---

## 2. 编辑与语法域（21 点）

### 2.1 块级元素

| #   | 功能              | 行为规范                                                                                                       | 实现机制                                         |
| --- | ----------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| E1  | 段落与换行        | Enter 新段落（单空行即可）；Shift+Enter 软换行；行尾两空格为兼容性换行符                                       | Crepe 内核（ProseMirror hardBreak/paragraph）    |
| E2  | 标题              | 行首 1-6 个 `#` + 空格 + Enter 自动转标题；Ctrl+1~6 设级别；Ctrl+0 转段落；Ctrl+=/- 增减级别                   | Crepe 标题语法 + keymap 扩展                     |
| E3  | 引用块            | 行首 `>` 自动生成；Enter 自动延续 `>`；`>>` 嵌套                                                               | GFM blockquote（Crepe 内置）                     |
| E4  | 列表              | `- `、`* `、`+ `、`1. ` 自动创建；Tab/Shift+Tab 缩进提升                                                       | Crepe list 语法（GFM）                           |
| E5  | 任务列表          | `- [ ]` / `- [x]`；点击复选框切换状态                                                                          | GFM taskList（Crepe 内置）                       |
| E6  | 代码围栏          | ` ``` ` + Enter 创建；行首语言名高亮；右下角语言切换；Ctrl+Shift+K 插入；行号/换行/缩进可配；复制代码/自动缩进 | Crepe CodeMirror 6 代码块；语言列表需注入        |
| E7  | 数学块            | `$$` + Enter 创建；Ctrl+Enter 结束；`\def` 自定义命令、`\ce{}` 化学式、自动编号模式可选                        | Crepe Math 插件（KaTeX）                         |
| E8  | 表格              | `                                                                                                              | 表头                                             | 表头 | ` + Enter 建表；工具栏缩放/对齐/删除；右键增删行列；Tab 加行；拖拽移动行列；Shift+Alt+Ctrl+L 删行 | Crepe GFM 表格（工具栏内置；Typora 式建表规则与 Tab 加行需自定义） |
| E9  | 脚注              | `[^id]` 引用式；悬停预览                                                                                       | preset-gfm 内置脚注节点；仅需悬停预览            |
| E10 | 水平线            | 空行 `***` 或 `---` + Enter                                                                                    | Crepe 内置                                       |
| E11 | YAML Front Matter | 文首 `---` 块自动识别；解析 title/author 等元数据与 Typora 专有属性 typora-root-url/typora-copy-images-to      | 自定义 front-matter（加载剥离存内存 + 保存回写） |
| E12 | 目录 TOC          | `[toc]` + Enter 生成；随标题增删自动更新                                                                       | 自定义节点（监听 heading 变更重算）              |
| E13 | Callouts          | 1.8+ 功能，需启用                                                                                              | ❌ 首版不做（依赖启用项，非核心）                |

### 2.2 行内元素

| #   | 功能           | 行为规范                                                                                                                                                                  | 实现机制                                                   |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| E14 | 链接           | `[text](url)` / `[text][id]` / `<url>` / 裸 URL 自动识别；Ctrl+点击浏览器打开；点击展开编辑；隐式引用 [Google][]；重复标题锚点从 -1 起编号（对齐 Typora，已拍板自写插件） | Crepe 内置 + opener 插件                                   |
| E15 | 图片           | `![alt](path)`；拖拽插入；点击编辑源码；同目录相对路径                                                                                                                    | Crepe ImageBlock + 自定义拖拽上传（M7）                    |
| E16 | 行内样式       | `*斜体*` `**粗体**` `` `代码` `` `~~删除线~~`；单词内下划线不识别                                                                                                         | Crepe GFM 内置                                             |
| E17 | Emoji          | `:名称` 自动补全；菜单插入 UTF-8 emoji                                                                                                                                    | 自定义 emoji 补全（可延后）                                |
| E18 | 上标/下标/高亮 | `^x^` `~x~` `==x==` 可选启用                                                                                                                                              | Crepe 扩展（可延后，非核心）                               |
| E19 | 行内数学       | `$...$`；ESC 触发预览；Pandoc 解析规则三条（开 `$` 后无空格/制表符；闭 `$` 前无空格/制表符且前一字符非反斜杠；闭 `$` 后不紧跟数字）                                       | Crepe Inline Math（KaTeX）；Pandoc 规则需自定义 InputRule  |
| E20 | HTML/媒体      | 行内 span 渲染；块级 HTML 编辑模式；iframe 沙箱；class/id/data-* 渲染剥离、导出保留；视频/音频路径规则同图片                                                              | ⚠️ 白名单渲染（DOMPurify 清洗；script 禁、iframe sandbox） |

### 2.3 图表（Mermaid）

| #   | 功能 | 行为规范                                                                                                                                                  | 实现机制                                                                                            |
| --- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| E21 | 图表 | ` ```mermaid ` 代码块渲染为图表；支持 flowchart/sequence/gantt/class/state/pie/mindmap 等 15 种 + legacy `sequence`/`flow`；主题变量可定制；右键另存/复制 | Crepe 无图表能力（官方 diagram 插件已弃用）；复用 CodeMirror renderPreview 钩子 + mermaid.js 懒加载 |

---

## 3. 文件与导航域（31 点）

### 3.1 文件管理

| #   | 功能             | 行为规范                                                                                                                                      | 实现机制                                  |
| --- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| F1  | 打开文件夹       | 菜单选文件夹；打开单文件时其父目录自动加载；侧栏底部菜单可切换文件夹                                                                          | tauri dialog + Rust walkdir               |
| F2  | 侧边栏切换       | 文件树/大纲/文件列表三面板；Ctrl+Shift+L 开关；Windows/Linux 开关入口在状态栏                                                                 | 前端布局 + Pinia                          |
| F3  | 文件树过滤       | 只显示受支持类型（14 种：.md/.markdown/.mdown/.mmd/.text/.txt/.rmarkdown/.mkd/.mdwn/.mdtxt/.rmd/.qmd/.mdtext/.mdx）；隐藏文件与无扩展名不显示 | Rust 遍历过滤                             |
| F4  | 右键菜单         | 打开、新窗口打开、新建文件/文件夹（输入文件名免确认）、重命名、Duplicate、删除（回收站）、撤销文件操作、复制路径、在资源管理器中显示          | Rust 命令 + trash + opener                |
| F5  | 自动刷新         | 监视目录变更自动刷新文件树；手动 Refresh 兜底                                                                                                 | Rust notify + 前端事件                    |
| F6  | 排序             | 自然序/字母/修改时间/创建时间四种各可升降序；Group by Folder 开关（文件夹置前，默认开）                                                       | Rust 排序（自然序算法）                   |
| F7  | 拖拽             | 文件树内拖拽移动；拖入编辑器插入链接（对象含文件与文件夹）；与系统文件管理器互拖                                                              | ⚠️ 首版只做拖入编辑器插链接，树内拖拽延后 |
| F8  | 撤销文件操作     | 最近一次移动/重命名可撤销；Windows/Linux 删除不可撤销；撤销可能失败需提示                                                                     | ⚠️ 延后（低成本但非核心）                 |
| F9  | 最近位置         | 侧栏最近列表；移除/固定；固定项联动出现在 Open Recent 与 Open Quickly                                                                         | 设置存储（store 插件）                    |
| F10 | 文件链接         | `[label](readme.md)` 相对路径；`#锚点` 跨文件跳转；不存在引导创建                                                                             | 编辑器链接解析 + 打开命令                 |
| F11 | Open Quickly     | Ctrl+P 模糊搜索当前文件夹/最近文件                                                                                                            | Fuse.js 模糊匹配 + Rust 扫描              |
| F12 | 全局搜索入口     | Ctrl+Shift+F 快捷键；Windows/Linux 滚动到侧栏顶部显示搜索框                                                                                   | 前端 UI                                   |
| F13 | 最近文件         | File → Open Recent 菜单（含 Clear Items，固定项默认保留）；打开文件/文件夹即记录                                                              | 设置存储（store 插件）                    |
| F14 | 启动行为         | 启动时重开上次会话/文件                                                                                                                       | 设置 + 启动参数                           |
| F15 | Windows JumpList | 任务栏跳转列表                                                                                                                                | ❌ 首版不做                               |

### 3.2 大纲

| #   | 功能                     | 行为规范                                                                            | 实现机制                |
| --- | ------------------------ | ----------------------------------------------------------------------------------- | ----------------------- |
| F16 | 大纲面板开关             | Ctrl+Shift+1 切换                                                                   | 前端布局                |
| F17 | 层级缩进                 | H1-H6 按层级缩进体现继承                                                            | 前端渲染                |
| F18 | 点击跳转                 | 点击条目跳转标题处                                                                  | ProseMirror 标题定位    |
| F19 | 当前标题高亮             | 滚动/编辑时高亮当前章节（双通道：滚动监听 + selectionUpdated）                      | 滚动监听 + 标题范围计算 |
| F20 | Highlight Current Header | 操作过大纲面板（过滤/滚动）后找回当前标题的右键菜单项                               | 同 F19 复用             |
| F21 | 大纲过滤                 | 关键词过滤标题                                                                      | 前端 filter             |
| F22 | 扁平/可折叠              | 两种视图切换；配置入口三处（View 菜单/偏好设置 Appearance/大纲右键菜单）；默认 Flat | 前端渲染模式            |
| F23 | 文档内 TOC               | `[toc]`（同 E12）；HTML 导出含大纲跟随 Flat/Collapsible；PDF 导出自动生成大纲书签   | 自定义节点              |

### 3.3 搜索

| #   | 功能         | 行为规范                                                           | 实现机制                                                 |
| --- | ------------ | ------------------------------------------------------------------ | -------------------------------------------------------- |
| F24 | 当前文件查找 | Ctrl+F 查找、Ctrl+H 替换；查找从光标位置开始；Find 不改现有选区    | 官方 prosemirror-search 模块 + 自研面板 UI               |
| F25 | 正则替换     | 替换串支持 `$0` `$1` 捕获组                                        | 同 F24 内置正则模式                                      |
| F26 | 跨文件搜索   | 侧栏搜索；大小写/全词/正则开关；结果上限约 50 行截断；无跨文件替换 | ignore 并行遍历 + regex 行扫描 + 转码 + 结果上限流式返回 |

### 3.4 视图模式与标签页

| #   | 功能            | 行为规范                                                                                                                                | 实现机制                                     |
| --- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| F27 | Focus 模式      | F8 淡化当前行/块以外内容                                                                                                                | CSS 类切换                                   |
| F28 | Typewriter 模式 | F9 光标保持屏幕中部、文档滚动                                                                                                           | 滚动同步逻辑                                 |
| F29 | 标签页          | **Typora 平台差异：Win 无标签页（官方载明 Not Supported）**；我们按全功能版统一支持：新建/切换/关闭/重开关闭（Ctrl+Shift+T 恢复脏快照） | 前端多标签状态（Pinia + 每标签一编辑器实例） |

### 3.5 自动保存与恢复

| #   | 功能           | 行为规范                                                                                                                                                 | 实现机制                           |
| --- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| F30 | 自动保存       | 开关型功能（Typora 默认关，我们默认态待 spec 把关）；停笔防抖 + 定时双条件（间隔默认 5 分钟可配）                                                        | 前端防抖定时 + Rust 原子写盘       |
| F31 | 恢复未保存草稿 | 崩溃/异常退出后可手动恢复（偏好面板 Save & Recover 分区按钮，不自动弹提示）；备份名 `{YYYY-MM-DD}-{文件名}.md`；未命名文档以首标题命名；正常退出亦留备份 | Rust 备份目录（自定 app 数据目录） |

---

## 4. 主题域（9 点）

| #   | 功能            | 行为规范                                                                                                            | 实现机制                      |
| --- | --------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| T1  | 主题即 CSS      | 菜单列出主题目录下全部 .css；内置亮/暗主题（Typora 官方 6 个：GitHub/Gothic（默认）/Newsprint/Night/Pixyll/Whitey） | CSS 文件扫描 + 菜单           |
| T2  | 主题目录        | 打开主题目录按钮（Appearance 分区）；应用数据目录 themes/                                                           | Rust 路径命令                 |
| T3  | 安装主题        | 复制 css + 资源到主题目录；官方行为重启后可见，**热刷新为差异化增强**                                               | 同 T2 + notify 热刷新         |
| T4  | 命名规则        | 小写字母+连字符（**数字禁用**，官方「非字母字符仅 -」）；菜单标签 = 连字符分词+每词首字母大写                       | 文件名转换                    |
| T5  | 明暗分离        | 亮/暗模式分别指定主题；系统色系变化联动；prefers-color-scheme                                                       | CSS media query + Tauri Theme |
| T6  | 自定义 CSS 追加 | 4 层顺序：基础样式→主题 CSS→`base.user.css`→`{theme}.user.css`；大小写敏感                                          | 样式注入顺序                  |
| T7  | 调试            | DevTools 开关（Shift+F12）                                                                                          | WebView2 devtools（dev 构建） |
| T8  | 自定义字体      | @font-face 引用主题目录 fonts/；**内置主题须用 rem 字号单位**                                                       | CSS 能力                      |
| T9  | 主题市场        | Gallery 网站下载                                                                                                    | ❌ 不做（外链第三方）         |

---

## 5. 导出域（13 点）

| #   | 功能          | 行为规范                                                                                                                                                          | 实现机制                                            |
| --- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| X1  | HTML 导出     | 独立单文件内嵌样式；Include Outline（默认关）形态跟随 Flat/Collapsible；Append head/body；主题默认当前可另选；**YAML 变量替换仅限 `<title>/<meta>` 内（防 XSS）** | 前端生成 HTML + 内联                                |
| X2  | PDF 导出      | 纸张默认 A4/边距/页眉页脚（默认空，`${title}/${pageNo}/${pageCount}` 变量）/h1 分页开关（默认关）+ 脚注前分页/手动分页 div/PDF 大纲书签/暗色主题（1.10+）         | WebView2 打印管线（PrintToPdfStream/CDP）+ 打印 CSS |
| X3  | HTML 无样式   | 纯内容导出                                                                                                                                                        | 同 X1 去样式                                        |
| X4  | 图片长图      | 导出为图片                                                                                                                                                        | ❌ 首版不做（依赖截图质量）                         |
| X5  | Pandoc 全格式 | Word/Epub/LaTeX 等                                                                                                                                                | ❌ 首版不做（依赖 Pandoc 外部程序，后续里程碑评估） |
| X6  | 重复导出      | 两命令：Export with Previous / Export and Overwrite with Previous（覆盖警告）；记忆范围=当前窗口+当前文档                                                         | 会话级记忆                                          |
| X7  | 导出项管理    | 增删改序；内置 4 项（PDF/HTML/HTML 无样式/Image）锁定；实时作用于 File → Export 菜单                                                                              | 设置存储                                            |
| X8  | 导出位置      | 三选项 auto/同目录/自定义（auto 自定=同当前文档目录）                                                                                                             | Rust 对话框                                         |

---

## 6. 图片域（11 点）

| #   | 功能          | 行为规范                                                                                                                      | 实现机制                  |
| --- | ------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| P1  | 多方式插入    | 菜单/拖拽（多文件）/粘贴/手写语法；菜单插入时剪贴板有图片 URL 则直写 src                                                      | Crepe ImageBlock uploader |
| P2  | 粘贴自动存盘  | 三步开启（保存文档→开选项→选目标文件夹写入 typora-copy-images-to）；拖入/粘贴本地图自动复制到目标目录并更新 src；重名直接覆盖 | Rust 写盘 + 相对路径      |
| P3  | 路径策略      | 相对路径优先（前提已保存）；`./` 前缀可选（官方推荐禁用，默认关）；URL 转义 = escape() 语义（`%uXXXX`）；三开关默认全关       | 路径处理工具              |
| P4  | 根路径前缀    | typora-root-url 等价物（绝对路径值，仅显示时解析不写入 src）                                                                  | 设置项                    |
| P5  | 删除图片      | Delete Image = 删引用 + 删磁盘文件（确认对话框 + 回收站，已拍板）                                                             | 右键菜单 + trash 删除     |
| P6  | 移动/复制图片 | 移动/复制并更新引用                                                                                                           | ⚠️ 延后                   |
| P7  | 批量处理      | Move/Copy All Images                                                                                                          | ❌ 延后                   |
| P8  | 云上传        | 接入上传器                                                                                                                    | ❌ 不做（第三方服务）     |
| P9  | 自动上传      | 插入即上传                                                                                                                    | ❌ 不做                   |
| P10 | 对齐          | 单图段落默认居中（CSS 可控）                                                                                                  | CSS                       |
| P11 | 缩放          | `style="zoom:50%"`                                                                                                            | HTML 属性保留             |

---

## 7. 设置域（3 点）

| #   | 功能     | 行为规范                                                                                                                      | 实现机制                         |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| S1  | 偏好面板 | 分区顺序：General（含 Save & Recover 内部区）→ Editor → Image → Appearance → Markdown → Export；面板内 Ctrl+F 搜索设置项      | 前端设置弹窗 + 设置 store        |
| S2  | 高级配置 | conf.user.json（JSON 支持 `//` 注释，官方明文）                                                                               | 双层设置（store + 行级合并写回） |
| S3  | 字数统计 | 状态栏显示（默认字数）；点击弹面板（行数/字数/字符数/阅读时间）**可切换计数单位**；选中统计；**中文一字一词**；代码块文本计入 | ProseMirror doc 文本统计         |

---

## 8. 跨域横切关注点

| #   | 功能       | 行为规范                                                                                             | 实现机制                     |
| --- | ---------- | ---------------------------------------------------------------------------------------------------- | ---------------------------- |
| C1  | 快捷键体系 | 菜单项右侧显示快捷键；平台差异；keyBinding 自定义（conf.user.json，重启生效）                        | keymap 注册 + 菜单展示       |
| C2  | 未保存提示 | 关闭脏标签确认                                                                                       | 前端状态                     |
| C3  | 编码       | UTF-8（无 BOM 默认）；Typora 无编码探测（GBK 乱码即所见、保存转 UTF-8）；我们可选 GBK 探测差异化增强 | Rust 编码探测（encoding_rs） |
| C4  | 安全限制   | HTML script 禁、iframe sandbox                                                                       | 渲染白名单                   |
| C5  | 性能       | 大文档（万行级）编辑不卡顿                                                                           | ProseMirror 增量更新 + 防抖  |

---

## 9. 功能裁剪汇总（首版范围决策）

**首版采纳**：E1-E16、E19-E21、F1-F6、F10-F14、F16-F31、T1-T8、X1-X3、X6-X8、P1-P5、P10-P11、S1-S3、C1-C5
**首版强制范围（用户校准新增）**：

- **完整菜单栏**：第 11 节全部菜单项实现（含源码模式切换 Ctrl+/、窗口置顶、缩放等）
- **偏好设置全项**：第 12 节各分区设置项（云上传相关项以禁用状态占位）
- **搜索范围**：跨文件搜索覆盖 `.txt` 等全部文本文件
  **首版不做**（标注原因）：E13 Callouts（需启用非核心）、E17/E18 emoji 与上下标（延后）、E20 全量 HTML（白名单子集）、F7 树内拖拽、F8 撤销文件操作、F15 JumpList、T9 市场、X4 图片导出、X5 Pandoc（自定义命令导出保留）、P6-P9 图片管理增强与云上传（上传器占位禁用）

---

## 10. 用户校准清单（6 项已于 2026-08-13 全部答复）

1. **标签页**：~~Typora Windows 无标签页，我们按需求统一支持~~ → **✅ 已确认：统一支持标签页（作为差异化卖点，F29）**
2. **导出格式**：~~首版 HTML + PDF（打印路径），Pandoc 全格式延后~~ → **✅ 已确认：HTML + PDF，Pandoc 延后（自定义命令导出项保留占位）**
3. **云上传**：~~全部不做（第三方依赖）~~ → **✅ 已确认：全部不做，设置面板相关项禁用占位**
4. **搜索范围**：~~是否覆盖 `.txt` 等非 md 文件？~~ → **✅ 已确认：覆盖 `.txt` 等全部文本文件**
5. **自动保存间隔**：~~默认 5 分钟（可配）~~ → **✅ 已确认：默认 5 分钟（可配，对标 Typora autoSaveTimer）**
6. 其他你在使用 Typora 时觉得**必须复刻**、但本清单遗漏的行为？
   → **✅ 已补充：完整菜单栏结构（第 11 节）+ 全部偏好设置可控制项（第 12 节）纳入实现范围**

---

## 11. 完整菜单栏结构（必须实现）

来源：support.typora.io Shortcut-Keys 等官方文档（快捷键为 Windows/Linux 版）。**菜单即功能清单——每个菜单项都必须有对应实现或明确禁用状态**。

### 11.1 File（文件）

| 菜单项                | 快捷键                          | 对应功能                                                    |
| --------------------- | ------------------------------- | ----------------------------------------------------------- |
| New 新建              | Ctrl+N                          | 新建文档（未命名标签）                                      |
| New Window 新窗口     | Ctrl+Shift+N                    | 打开新应用窗口                                              |
| New Tab 新建标签页    | -（Win 无，官方 Not Supported） | 我们的产品支持（差异项）                                    |
| Open 打开             | Ctrl+O                          | 打开文件/文件夹对话框                                       |
| Open Quickly 快速打开 | Ctrl+P                          | 模糊搜索打开（F11）                                         |
| Open Recent 最近打开  | -                               | 最近文件/文件夹列表 + Clear Items（F13）                    |
| Reopen Closed File    | Ctrl+Shift+T                    | 重开最近关闭的文件                                          |
| Save 保存             | Ctrl+S                          | 写盘                                                        |
| Save As / Duplicate   | Ctrl+Shift+S                    | 另存为 / 复制文档                                           |
| Export 导出           | -（子菜单）                     | PDF/HTML/HTML 无样式/Image/with Previous/overwrite（X1-X8） |
| Print 打印            | -                               | 打印当前文档（Windows）                                     |
| Preference 偏好设置   | Ctrl+,                          | 设置弹窗（S1）                                              |
| Close 关闭            | Ctrl+W                          | 关闭当前标签（脏状态确认）                                  |

### 11.2 Edit（编辑）

| 菜单项                                  | 快捷键                               | 对应功能                                      |
| --------------------------------------- | ------------------------------------ | --------------------------------------------- |
| New Paragraph / New Line                | Enter / Shift+Enter                  | 编辑器行为（E1）                              |
| Cut / Copy / Paste                      | Ctrl+X/C/V                           | 剪贴板                                        |
| Copy As Markdown                        | Ctrl+Shift+C                         | 复制为 Markdown 源码                          |
| Paste As Plain Text                     | Ctrl+Shift+V                         | 粘贴 Markdown 源码                            |
| Select All                              | Ctrl+A                               | 全选                                          |
| Select Line/Sentence（表格 Select Row） | Ctrl+L                               | 行/句选择                                     |
| Delete Row（表格）                      | Ctrl+Shift+Backspace                 | 表格行删除                                    |
| Select Style Scope（表格 Select Cell）  | Ctrl+E                               | 样式范围/单元格选择                           |
| Select Word / Delete Word               | Ctrl+D / Ctrl+Shift+D                | 词级选择/删除                                 |
| Jump to Top / Bottom / Selection        | Ctrl+Home / Ctrl+End / Ctrl+J        | 光标跳转                                      |
| Find / Replace                          | Ctrl+F / Ctrl+H                      | F24/F25                                       |
| Find Next / Previous                    | F3 / Shift+F3（Enter / Shift+Enter） | 查找导航                                      |
| Emoji & Symbols                         | -                                    | 插入 UTF-8 emoji（E17，Windows 菜单名待确认） |
| Math Tools                              | -                                    | 强制刷新数学渲染（E7）                        |
| Whitespace and Line Breaks              | -                                    | 换行/空格保留行为（E1）                       |
| Spell Check…                            | -                                    | 拼写检查面板                                  |

### 11.3 Paragraph（段落）

| 菜单项                            | 快捷键                           | 对应功能       |
| --------------------------------- | -------------------------------- | -------------- |
| Heading 1-6                       | Ctrl+1~6                         | 标题级别（E2） |
| Paragraph 正文                    | Ctrl+0                           | 转段落         |
| Increase / Decrease Heading Level | Ctrl+= / Ctrl+-                  | 级别增减       |
| Table                             | Ctrl+T                           | 插入表格（E8） |
| Code Fences                       | Ctrl+Shift+K                     | 代码围栏（E6） |
| Math Block                        | Ctrl+Shift+M                     | 数学块（E7）   |
| Quote                             | Ctrl+Shift+Q                     | 引用块（E3）   |
| Ordered / Unordered List          | Ctrl+Shift+[ / ]                 | 列表（E4）     |
| Indent / Outdent                  | Ctrl+[ / Ctrl+]（Tab/Shift+Tab） | 缩进           |

### 11.4 Format（格式）

| 菜单项            | 快捷键             | 对应功能             |
| ----------------- | ------------------ | -------------------- |
| Strong / Emphasis | Ctrl+B / Ctrl+I    | 加粗/斜体（E16）     |
| Underline         | Ctrl+U             | 下划线（HTML `<u>`） |
| Code 行内代码     | Ctrl+Shift+`` ` `` | 行内代码（E16）      |
| Strike 删除线     | Alt+Shift+5        | 删除线（E16）        |
| Hyperlink         | Ctrl+K             | 链接（E14）          |
| Image             | Ctrl+Shift+I       | 插入图片（P1）       |
| Clear Format      | Ctrl+\             | 清除格式             |

### 11.5 View（视图）

| 菜单项                           | 快捷键               | 对应功能                                              |
| -------------------------------- | -------------------- | ----------------------------------------------------- |
| Toggle Sidebar                   | Ctrl+Shift+L         | 侧边栏开关（F2）                                      |
| Outline / Articles / File Tree   | Ctrl+Shift+1 / 2 / 3 | 面板切换（F2/F16）                                    |
| Source Code Mode                 | Ctrl+/               | 源码模式（**新增：编辑器需支持源码/所见即所得切换**） |
| Focus Mode                       | F8                   | 专注模式（F27）                                       |
| Typewriter Mode                  | F9                   | 打字机模式（F28）                                     |
| Toggle Fullscreen                | F11                  | 全屏                                                  |
| Actual Size / Zoom In / Zoom Out | Ctrl+Shift+0 / = / - | 界面缩放                                              |
| Search                           | Ctrl+Shift+F         | 全局搜索入口（F12/F26）                               |
| Switch Between Opened Documents  | Ctrl+Tab             | 标签切换（F29，官方 Windows 语义为跨窗口切换）        |
| Toggle DevTools                  | Shift+F12            | 开发者工具（T7）                                      |
| Always on Top                    | -                    | 窗口置顶                                              |

### 11.6 Themes（主题，动态菜单）

- 列出主题目录全部 `.css`（文件名自动转菜单标签，T1-T4）
- 浅色/深色模式各自指定主题（T5）

### 11.7 Help（帮助）

- Markdown Reference、Custom Themes 等帮助入口（低优先，静态页面）

### 11.8 上下文右键菜单（编辑器内 + 文件树）

- 编辑器：Copy as Markdown / Copy as HTML / Paste as Plain Text / 表格单元格动态项（增删行列）
- 文件树：打开/新窗口打开/新建/重命名/Duplicate/删除/复制路径/在资源管理器中显示/撤销文件操作（F4）

---

## 12. 偏好设置可控制项（必须实现）

来源：support.typora.io 各文档（Images/Export/Code-Fences/Advance-Config 等）。**每个分区都做对应设置项，值持久化到配置文件**。

### 12.1 Appearance（外观）

- 浅色/深色主题分别选择（T5）
- Show Status Bar 状态栏显隐（S3 依赖）
- Font Size 字号
- Reading Speed 阅读速度（words/min，阅读时间统计）
- 高级：defaultFontFamily、autoHideMenuBar（true 启用自动隐藏，Alt 切换）、monocolorEmoji（默认彩色）

### 12.2 Editor（编辑器）

- Image Insert：copy images to given folder（P2）、relative path（P3）、./ prefix、URL 转义——四开关默认全关（用户实测）
- Auto pair brackets/quotes、auto pair markdown syntax（自动配对 `*`/`~`/`` ` ``/`_`；`=`/`$`/`^` 为选中文字后包围）
- Default Line Ending（CRLF/LF）
- Auto Save 间隔（默认 5 分钟，`autoSaveTimer`，F30）

### 12.3 Markdown（语法开关，多为需重启生效）

- Inline Math 行内数学开关（E19）
- Legacy inline math parsing 兼容模式
- Diagrams 图表开关（E21）
- Strict Mode 严格模式（需重启）
- Code Fences：行号显示、长行自动换行、Shift+Tab 行为、缩进宽度、默认代码语言/Last Used（E6）
- Highlight / Superscript 等行内语法开关（E18）
- 拼写检查（语言选择，低优先）

### 12.4 Image（图片）

- 上传器接入（❌ 首版不做，占位设置项禁用）
- 插入时行为（仅本地/含在线）
- YAML 触发自动上传（❌ 配合云上传，不做）

### 12.5 Export（导出）

- 默认导出目录（auto/同文件目录/自定义）
- YAML 覆盖导出设置开关（安全，默认关）
- 导出项管理（增删改序，内置项锁定，X7）
- HTML：Include Outline / append head-body / 主题
- PDF：纸张/边距/主题（Win 仅浅色）/分页/页眉页脚变量（X2）
- 自定义命令导出（X5 Pandoc 延后，自定义命令保留）

### 12.6 General（通用）

- 启动行为：新建文件/恢复上次文件夹/恢复上次文件与文件夹/自定义文件夹（F14）；命令行参数 --new / --reopen-file 覆盖
- Open Theme Folder / Open Advanced Settings 入口（T2/S2）
- 界面语言（跟随系统，低优先）
- Reset Advanced Settings（重置高级配置）

### 12.7 高级设置 conf.user.json（S2）

- defaultFontFamily、autoHideMenuBar、searchService（右键第三方搜索服务列表，非内置搜索配置）、keyBinding（自定义快捷键）、monocolorEmoji、flags、autoSaveTimer
