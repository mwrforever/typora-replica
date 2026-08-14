# 09 导入导出 模块级调研

- 调研日期：2026-08-13
- 调研对象：Typora 官方公开文档（X1-X8 + Export 设置项全集 + 变量全集）+ 开源生态（Milkdown 序列化/WebView2 打印/KaTeX/Mermaid）
- 上游依据：`docs/specs/00-typora-full-feature-research.md`；05 调研（PDF 大纲书签）；02 模块 spec（write_file）
- 下游用途：「09 导入导出」模块 spec 的撰写依据

---

## 0. 调研方法与边界声明

**clean-room 行为级调研**：Typora 官方公开文档（6 篇源文件逐字核对，Export 页 last_modified 2025-06-08）+ Milkdown/KaTeX/Mermaid/Tauri/WebView2 官方文档与开源源码。未接触安装包/闭源代码。官方无 Print 专题页（如实标注）。

## 1. 来源清单

官方：Export（核心）、Page-Breaks、YAML、Line-Break、What's-New-1.9、What's-New-1.10。
生态：Milkdown latex/image-block/code-block 源码、transformer 包结构、KaTeX options、Mermaid config、docs.rs Webview::print、WebView2 ICoreWebView2_16/CDP 参考、Chrome print-margins 博客（131+ @page margin boxes）、CDP Page.printToPDF 协议、tauri store/dialog 文档。

## 2. 功能点核对结论

| #   | 功能          | 官方证据结论                                                                                                                                                                                                                      | 与全量 spec 差异  |
| --- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| X1  | HTML 导出     | 独立单文件内嵌样式；Include Outline（**默认关**，用户实测，形态跟随 Flat/Collapsible）；Append head/body；主题默认当前可另选；**YAML 变量替换仅限 `<title>/<meta>` 内（防 XSS）**；每文档 append-head/body                        | 补 4 处细化       |
| X2  | PDF 导出      | 纸张（默认 **A4**，用户实测）/边距；h1 分页开关（**默认关**，用户实测）+ 脚注定义前分页；手动分页 div；页眉页脚（**默认空**，用户实测）`${title}/${pageNo}/${pageCount}` 变量；**PDF 自动生成大纲书签**；1.10 起暗色主题 PDF 支持 | 补 4 处           |
| X3  | HTML 无样式   | 纯内容；Append head/body 同 X1；sidebar 选项不支持                                                                                                                                                                                | 补 sidebar 限制   |
| X4  | 图片长图      | 640px/24px 默认、Quality 四档                                                                                                                                                                                                     | 首版不做，留档    |
| X5  | Pandoc 全格式 | 自定义命令导出细节（Command 变量替换/在文件所在目录执行/三态保存对话框）                                                                                                                                                          | 保留项按此实现    |
| X6  | 重复导出      | **两命令**：Export with Previous / Export and Overwrite with Previous（有覆盖警告）；记忆范围=当前窗口+当前文档（会话级）                                                                                                         | 00 只写一个，修正 |
| X7  | 导出项管理    | 内置 4 项（PDF/HTML/HTML 无样式/Image）锁定不可重排/改名/删；增删改序实时作用于 File → Export 菜单                                                                                                                                | 与 00 吻合        |
| X8  | 导出位置      | 三选项 auto/同目录/自定义                                                                                                                                                                                                         | 00 只写两个，补   |

## 3. 与全量 spec 的差异点（10 处，写 spec 时回改 00 号）

1. X1 变量替换仅 title/meta 内（防 XSS）
2. X1 补 Append head/body、主题可另选
3. X2 补 PDF 书签/脚注分页/手动分页 div/暗色 1.10+
4. X6 两命令 + 会话级记忆
5. X7 锁定 4 内置项
6. X8 三选项
7. 11.1 File 菜单补 Export 子菜单（含 Print 项，用户实测确认含 Print；Export 子菜单顺序：PDF→HTML→HTML 无样式→Image→分隔线→with Previous→overwrite with Previous）
8. 12.5 Export 分区补项（After Export/Pandoc path/自定义命令 4 项）
9. 1.9 锚点规范（小写、空格转 -、en dash→--、em dash→---、去其他标点）
10. 每文档 YAML 导出配置键全集

## 4. 开源生态边界

- **HTML 导出管线（路线 A 推荐）**：ProseMirror DOMSerializer.fromSchema(schema).serializeFragment(doc.content)——所见即所得语义一致；Milkdown 无官方 HTML 序列化器（transformer 仅 markdown）；必备后处理：latex 代码块→katex.renderToString、mermaid→mermaid.render SVG、[toc]→大纲 HTML、image-block 清洗（data 属性剥离）
- **主题 CSS 内联**：读取当前主题 CSS + KaTeX CSS + 导出专用 CSS 合并 `<style>` 内联（达成官方 standalone embedded styles）
- **KaTeX**：renderToString 输出 HTML（无 SVG）；throwOnError:false 错误原样回显
- **Mermaid**：mermaid.render → 内联 SVG（无 CSS 依赖）
- **PDF 导出（本模块唯一中-重工作量）**：Tauri Webview::print() 仅 macOS → Windows 自研：隐藏 webview 渲染导出 HTML → `webview2-com` ICoreWebView2_16::PrintToPdfStream 或 CDP Page.printToPDF；纸张/边距/h1 分页用 @page CSS；**页眉页脚走 Chrome 131+ @page margin boxes + counter(page/pages)**（纯 CSS 变量替换，WebView2 runtime 已 ≥131）；**PDF 书签 = CDP generateDocumentOutline（实验性，首版降级可延后，用户拍板）**；暗色 PDF 跟随当前主题 printBackground=true（用户拍板）
- **X6 会话级记忆**：前端内存 + 文档 id 索引
- **另存对话框**：plugin-dialog save({defaultPath, filters})

## 5. 用户实操回填（2026-08-13）

| #   | 事项                                | 结果                                                                                                                                  |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | File 菜单 Print + Export 子菜单清单 | ✅ 含 Print；Export 子菜单顺序：PDF → HTML → HTML (without Styles) → Image → 分隔线 → 使用上一次设置导出 → 导出并覆盖上一次的导出文件 |
| 2   | Include Outline 默认                | ✅ 关                                                                                                                                 |
| 3   | PDF 默认值                          | ✅ 纸张 A4；页眉页脚默认空；h1 分页默认关                                                                                             |
| 4   | PDF 书签降级                        | ✅ 首版可延后（拍板）                                                                                                                 |
| 5   | 暗色 PDF                            | ✅ 跟随当前主题（拍板）                                                                                                               |
| 6   | auto 导出位置语义                   | 官方未载明 → 自定：auto = 同当前文档目录（未命名文档 = 上次导出目录/默认下载）                                                        |

## 6. 待确认残留项（自定策略，spec 中标注）

- HTML 导出 `<title>` 默认值：YAML title 优先，无则取文件名（自定）
- Export and Overwrite 覆盖确认：弹覆盖警告（官方载明 "Please be careful"，自定弹窗）
- 自定义导出位置时图片路径不重写（官方未载明，按不重写，pathdiff 保持）
- 内置导出项清单：PDF/HTML/HTML 无样式/Image 4 项锁定（X4 首版不做但菜单占位禁用）
