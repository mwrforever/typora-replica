# MarkWell 编辑器页设计（page override）

> 本文件覆盖 `../MASTER.md` 中与编辑器页面（01 编辑核心模块）相关的规则。
> 依据：ui-ux-pro-max 设计系统（Minimalism & Swiss Style / Content First）+ Typora 写作体验调研。

## 页面定位

- 产品类型：Notes & Writing App（桌面写作工具，非营销页面——MASTER 的 Newsletter 模式不适用）
- 核心体验：内容优先的沉浸式写作区（居中纸面 + 无干扰），UI 装饰最小化
- 使用场景：长时间连续写作（万行文档），配色必须低疲劳、对比度达标
- 配色体系：**「纸墨 Ink & Paper」v2**（2026-08-15 重制，见 MASTER.md）——单一墨蓝强调、暖纸/暖炭双态，v1 的 teal+orange 撞色系作废

## 字体（桌面离线应用，禁止 Google Fonts 网络加载）

| 用途      | 字体栈                                                                               |
| --------- | ------------------------------------------------------------------------------------ |
| 正文/标题 | `Inter, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`（中文优先回退）    |
| 代码      | `'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, 'Courier New', monospace` |

- 正文 16px 基准、行高 1.5（MASTER 与 ux 规则）
- 标题与正文同族（MASTER 决定），不引入 serif（Typora 默认 GitHub 主题同为无衬线）

## 编辑器画布（Crepe CSS 变量映射层）

> 01 模块在 Crepe 官方主题 CSS 之上追加变量覆盖层（spec T6 base.user.css 落此层）。
> 变量名逐一核对自 @milkdown/crepe 7.22.1 `theme/crepe/style.css`。
> 对比度均为「该色对所在底色」实测值（WCAG 相对亮度脚本，见 `color-scheme.html` 明细）。

### 亮色（默认，「暖纸」）

| Crepe 变量                         | 值        | 对比度 | 说明                               |
| ---------------------------------- | --------- | ------ | ---------------------------------- |
| `--crepe-color-background`         | `#faf9f6` | —      | 暖纸白画布（非纯白，低疲劳）       |
| `--crepe-color-on-background`      | `#2a2720` | 14.2:1 | 暖墨正文                           |
| `--crepe-color-surface`            | `#f2f0ea` | —      | 工具浮层底（暖灰，与纸面分层）     |
| `--crepe-color-surface-low`        | `#eae7df` | —      | 次级浮层底                         |
| `--crepe-color-on-surface`         | `#2a2720` | 12.1:1 | 浮层正文                           |
| `--crepe-color-on-surface-variant` | `#6e6a5e` | 4.7:1  | 次要文字                           |
| `--crepe-color-outline`            | `#e2ded3` | —      | 装饰性边框/分隔（非交互控件）      |
| `--crepe-color-primary`            | `#1e4f8a` | 7.9:1  | 墨蓝：链接/焦点/选中               |
| `--crepe-color-secondary`          | `#e3eaf3` | —      | 主色浅底（选中项背景）             |
| `--crepe-color-on-secondary`       | `#1e4f8a` | 6.8:1  | 浅底上的主色文字                   |
| `--crepe-color-inverse`            | `#1e4f8a` | —      | 反色底（搜索高亮等反色场景）       |
| `--crepe-color-on-inverse`         | `#ffffff` | 8.3:1  | 反色底文字                         |
| `--crepe-color-inline-code`        | `#9e2b25` | 7.1:1  | 行内代码：枣红（「批注墨水」气质） |
| `--crepe-color-error`              | `#c62828` | 5.3:1  | 错误/危险                          |
| `--crepe-color-hover`              | `#eae7df` | —      | 悬停底                             |
| `--crepe-color-selected`           | `#d3dfee` | —      | 文本选中底（墨蓝 15% 调）          |
| `--crepe-color-inline-area`        | `#f1efe9` | —      | 行内编辑区（与代码块底同族）       |

### 暗色（Night，「夜读」，`.markwell-dark` 激活，08 主题模块接入）

| Crepe 变量                         | 值        | 对比度 | 说明                                 |
| ---------------------------------- | --------- | ------ | ------------------------------------ |
| `--crepe-color-background`         | `#211e1a` | —      | 暖炭画布（非中性灰，带暖褐倾向）     |
| `--crepe-color-on-background`      | `#e8e4da` | 13.1:1 | 暖白正文                             |
| `--crepe-color-surface`            | `#26231f` | —      | 浮层底（比画布微亮，浮层感）         |
| `--crepe-color-surface-low`        | `#2d2925` | —      | 次级浮层底                           |
| `--crepe-color-on-surface`         | `#e8e4da` | 11.4:1 | 浮层正文                             |
| `--crepe-color-on-surface-variant` | `#a39e92` | 5.9:1  | 次要文字                             |
| `--crepe-color-outline`            | `#3b372f` | —      | 装饰性边框/分隔                      |
| `--crepe-color-primary`            | `#8fb3dc` | 7.6:1  | 雾蓝：链接/焦点/选中（暗底提亮映射） |
| `--crepe-color-secondary`          | `#2e3a4e` | —      | 主色深底（选中项背景）               |
| `--crepe-color-on-secondary`       | `#8fb3dc` | 5.3:1  | 深底上的主色文字                     |
| `--crepe-color-inverse`            | `#8fb3dc` | —      | 反色底                               |
| `--crepe-color-on-inverse`         | `#1b3a5e` | 5.3:1  | 反色底文字（雾蓝底上深蓝墨）         |
| `--crepe-color-inline-code`        | `#e29a86` | 7.3:1  | 行内代码：暖珊瑚                     |
| `--crepe-color-error`              | `#e06c5f` | 5.1:1  | 错误                                 |
| `--crepe-color-hover`              | `#2d2925` | —      | 悬停底                               |
| `--crepe-color-selected`           | `#3a4a63` | —      | 文本选中底（雾蓝 20% 调）            |
| `--crepe-color-inline-area`        | `#26231f` | —      | 行内编辑区                           |

## 代码语法色（预留 07 渲染 / 08 主题模块）

> 围栏代码高亮的推荐取色（基于 code-bg 验证 ≥4.5:1），与「纸墨」气质同族：亮色收敛为
> 枣红/松绿/琥珀/墨蓝，暗色提亮为暖珊瑚/雾绿/蜜金/雾蓝，注释一律复用 ink-2。

| 语法角色 | Light     | Dark      |
| -------- | --------- | --------- |
| keyword  | `#9e2b25` | `#e29a86` |
| string   | `#1e6b4f` | `#8fc9a8` |
| number   | `#8a5a00` | `#e0b05c` |
| function | `#1e4f8a` | `#8fb3dc` |
| comment  | `#6e6a5e` | `#a39e92` |
| type     | `#6b3fa0` | `#c5a3e0` |

## 版式

- 编辑内容列：`max-width: 800px` 居中，两侧留白 ≥ 24px（Typora 式纸面宽度）
- 编辑器容器 padding：`48px 24px`（桌面）
- 行内元素：链接用主色 + 下划线；代码围栏用等宽字体 + surface-low 底

## 交互与无障碍（MASTER Pre-Delivery Checklist 落地）

- 焦点环：`:focus-visible` 2px 主色描边，禁止移除焦点样式
- 可点击元素（工具栏/浮层按钮）`cursor: pointer` + 悬停过渡 150-250ms
- 动画尊重 `prefers-reduced-motion`（编辑器核心不引入装饰动画）
- 图标一律 SVG（Crepe 内置图标集），禁止 emoji 充当图标
- 亮/暗两态正文对比度均 ≥ 4.5:1（取值已验算）

## 禁止事项（继承 MASTER）

- 过度装饰、复杂阴影、3D 效果
- hover 引起的布局位移（transform 仅 opacity）
- 低于 4.5:1 的正文对比度
