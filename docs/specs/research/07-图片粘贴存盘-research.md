# 07 图片粘贴存盘 模块级调研

- 调研日期：2026-08-13
- 调研对象：Typora 官方公开文档（P1-P5/P10/P11 + Image Insert 设置项）+ 开源生态（Milkdown onUpload 链路/Tauri 剪贴板/Rust 写盘）
- 上游依据：`docs/specs/00-typora-full-feature-research.md`；01 调研（E15 ImageBlock + onUpload）；01 模块 spec 第 5 节
- 下游用途：「07 图片粘贴存盘」模块 spec 的撰写依据

---

## 0. 调研方法与边界声明

**clean-room 行为级调研**：Typora 官方公开文档（官方公开文档仓库 gh-pages 源文件，主依据 Images.md 2025-01-17 版）+ Milkdown/Tauri/Rust 开源仓库源码。未接触安装包/闭源代码。URL 转义格式经本地 node 实证（行为级验证）。

## 1. 来源清单

官方 5 页：Images（核心）、Shortcut-Keys、Resize-Image、Upload-Image、Copy-and-Paste。
生态 15 项：Milkdown 仓库（plugin-upload/builder.ts/image-block 组件/plugin-clipboard 源码逐文件）、Tauri 剪贴板插件文档与源码、convertFileSrc/core.ts、pathdiff/trash/arboard crates、本地 node 实证。

## 2. 功能点核对结论

| #   | 功能         | 官方证据结论                                                                                                                                    | 与全量 spec 差异     |
| --- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| P1  | 多方式插入   | 4 方式全载明；菜单插入时剪贴板有图片 URL 则直写 src；支持一次多文件拖入；Insert Local Images 无默认快捷键                                       | 补 3 细节            |
| P2  | 粘贴自动存盘 | 三步开启（先保存文档→开选项→选目标文件夹写入 typora-copy-images-to）；拖入/粘贴后复制到目标文件夹并更新 src；全局设置可对所有文档生效           | 补三步开启+全局设置  |
| P3  | 路径策略     | relative path（前提已保存）；**./ prefix 官方推荐禁用**；**URL 转义 = JS escape() 语义（`%uXXXX` UTF-16 码元），非 encodeURIComponent（纠错）** | 纠错 + 补推荐禁用    |
| P4  | 根路径前缀   | typora-root-url 与 src 拼接（前导 / 不双斜杠）；新版可菜单生成                                                                                  | 无；值形态待确认     |
| P5  | 删除图片     | Delete Image = 删引用 + 删磁盘文件；**警告/确认行为官方无记载（spec「带警告」无出处）**                                                         | 警告行为无官方依据   |
| P10 | 对齐         | Typora 无对齐语法；**默认单图段落居中**，官方给出三行 CSS（编辑态/导出态）；取消居中用自定义 CSS                                                | 补官方 CSS 原文      |
| P11 | 缩放         | `style="zoom:50%"`（HTML img 标签）；style 中其他属性编辑时忽略、导出时生效                                                                     | 无；实现层差异见 4.1 |

## 3. 与全量 spec 的差异点（10 处，写 spec 时回改 00 号）

1. P1 补 3 细节；2. P2 补三步开启+全局设置；3. **URL 转义纠错（escape() 非 encodeURIComponent）**；4. ./ prefix 官方推荐禁用；5. P5 警告行为无官方记载（按用户拍板实现：确认+回收站）；6. P10 补官方 CSS；7. 11.4 Format → Image 子菜单 6 项补全；8. 12.2/12.4 设置项精确名称与「When Insert」选项补全；9. **Crepe image-block alt→ratio 语义冲突（用户已拍板：定制 schema 保 alt）**；10. Milkdown 上传失败无用户反馈（需自定义提示）

## 4. 开源生态边界

### 4.1 Milkdown onUpload 链路（源码级结论）

- 粘贴/拖拽/按钮三路收敛于 `onUpload(file): Promise<string>`（与 01 接口约定一致）；未提供时退化 blob URL（会话级失效）→ **07 必须首版交付真实实现**
- **alt 被 ratio 占用（最重差异）**：image-block schema attrs = src/caption/ratio；parseMarkdown 把 alt→ratio（非数字→1）、toMarkdown 输出 `![{ratio}](src)` → Typora 文档打开保存后 alt 丢失。**用户已拍板：定制 parseMarkdown/toMarkdown，ratio 挪位、alt 原样保留**
- **缩放语义差异**：Typora zoom 在 HTML img 标签上（Crepe html 节点天然兼容）；Crepe 的 markdown 图片拖拽缩放落盘 `![0.50](src)` 是独有语法——定制 schema 后决定拖拽缩放的落盘格式（title 挂 ratio）
- **粘贴分流**：纯图片粘贴（截图）→ upload 接管 → onUpload 存盘 ✅；粘贴浏览器 HTML 图片 → clipboard 按 HTML 解析（远程 URL 保留、**data: URL 直接进 src 不存盘**）→ base64 还原写盘需自定义高优先级 handlePaste
- **本地图片显示**：proxyDomURL + convertFileSrc + assetProtocol scope + CSP img-src 配置

### 4.2 剪贴板读取

- **主路径：前端 ClipboardEvent paste → clipboardData.files**（WebView2 = Chromium，截图合成 image.png、文件复制保留原名；与 onUpload(File) 天然衔接）
- 兜底：tauri-plugin-clipboard-manager read_image（arboard RGBA 像素需重编码，可选非硬依赖）

### 4.3 Rust 写盘/路径/删除

- `save_image(bytes, name, target_dir) -> 相对 src`：文件名生成/sanitize（Windows 保留字符）；原子写；mime→扩展名映射
- 相对路径：pathdiff::diff_paths（跨盘符 None → 降级绝对路径）；URL 转义 = escape() 等价纯函数
- 决策组合：relative path（已保存+开选项）→ ./ 前缀（默认关）→ escape（默认关）；未保存文档 → 绝对路径（用户实测）
- 删除：自定义图片右键菜单 → 确认对话框 → 删节点 + trash crate 回收站

## 5. 用户实操回填（2026-08-13）

| #   | 事项               | 结果                                                                                          |
| --- | ------------------ | --------------------------------------------------------------------------------------------- |
| 1   | 重名冲突处理       | ✅ Typora **直接覆盖**（无自动改名）——我们按对齐 Typora 覆盖，spec 把关时确认（或差异化保护） |
| 2   | 粘贴截图默认文件名 | ✅ `image-YYYYMMDD-HHMMSS.png`（如 image-20260813-143000.png，系统临时目录）                  |
| 3   | 粘贴图片 alt 文本  | ✅ 空（落盘 `![](path)`）                                                                     |
| 4   | 未保存文档粘贴图片 | ✅ src 写**绝对路径**（无基准目录）                                                           |
| 5   | 三开关默认状态     | ✅ 全部默认关（copy to folder / relative path / ./ prefix）                                   |
| 6   | Delete Image 行为  | ✅ 确认对话框 + 回收站（用户拍板）                                                            |
| 7   | 定制 schema 保 alt | ✅ 用户拍板                                                                                   |
| 8   | 跨盘符相对路径     | 官方未载明 → 自定：跨盘符降级绝对路径                                                         |

## 6. 待确认残留项（自定策略，spec 中标注）

- 重名覆盖：对齐 Typora 直接覆盖（但为数据安全，覆盖前无提示；把关时确认是否需要改名保护）
- typora-root-url 值形态：仅绝对路径值（官方示例）
- 删除前多引用检测：扫描文档同 src 引用数，多引用时提示（增强项）
