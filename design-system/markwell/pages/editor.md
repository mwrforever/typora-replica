# MarkWell 编辑器页设计（page override）

> 本文件覆盖 `../MASTER.md` 中与编辑器页面（01 编辑核心模块）相关的规则。
> 依据：ui-ux-pro-max 设计系统（Minimalism & Swiss Style / Content First）+ Typora 写作体验调研。

## 页面定位

- 产品类型：Notes & Writing App（桌面写作工具，非营销页面——MASTER 的 Newsletter 模式不适用）
- 核心体验：内容优先的沉浸式写作区（居中纸面 + 无干扰），UI 装饰最小化
- 使用场景：长时间连续写作（万行文档），配色必须低疲劳、对比度达标

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

### 亮色（默认）

| Crepe 变量                         | 值        | 说明                                  |
| ---------------------------------- | --------- | ------------------------------------- |
| `--crepe-color-background`         | `#ffffff` | 纯白纸面（写作区低疲劳）              |
| `--crepe-color-on-background`      | `#1f2937` | 正文墨色，对比 ≈13:1                  |
| `--crepe-color-surface`            | `#f8fafc` | 工具浮层底                            |
| `--crepe-color-surface-low`        | `#f1f5f9` | 次级浮层底                            |
| `--crepe-color-on-surface`         | `#1f2937` | 浮层正文                              |
| `--crepe-color-on-surface-variant` | `#475569` | 次要文字，对比 ≈7.5:1                 |
| `--crepe-color-outline`            | `#cbd5e1` | 边框/分隔                             |
| `--crepe-color-primary`            | `#0f766e` | 品牌主色（teal-700，白底对比 ≈5.4:1） |
| `--crepe-color-secondary`          | `#ccfbf1` | 主色浅底                              |
| `--crepe-color-on-secondary`       | `#134e4a` | 浅底上的文字                          |
| `--crepe-color-inverse`            | `#134e4a` | 反色底                                |
| `--crepe-color-on-inverse`         | `#f0fdfa` | 反色底文字                            |
| `--crepe-color-inline-code`        | `#c2410c` | 行内代码文字色                        |
| `--crepe-color-error`              | `#dc2626` | 错误/危险                             |
| `--crepe-color-hover`              | `#f0fdfa` | 悬停底                                |
| `--crepe-color-selected`           | `#ccfbf1` | 选中底                                |
| `--crepe-color-inline-area`        | `#e2e8f0` | 行内编辑区                            |

### 暗色（Night，`.markwell-dark` 激活，08 主题模块接入）

| Crepe 变量                         | 值        | 说明                                    |
| ---------------------------------- | --------- | --------------------------------------- |
| `--crepe-color-background`         | `#1e1e1e` | 中性夜灰（Typora Night 风格，原创取值） |
| `--crepe-color-on-background`      | `#e5e7eb` | 对比 ≈13:1                              |
| `--crepe-color-surface`            | `#252525` | 浮层底                                  |
| `--crepe-color-surface-low`        | `#2b2b2b` | 次级浮层底                              |
| `--crepe-color-on-surface`         | `#e5e7eb` | 浮层正文                                |
| `--crepe-color-on-surface-variant` | `#a1a1aa` | 对比 ≈7:1                               |
| `--crepe-color-outline`            | `#3f3f46` | 边框                                    |
| `--crepe-color-primary`            | `#2dd4bf` | teal-400，暗底对比 ≈8:1                 |
| `--crepe-color-secondary`          | `#134e4a` | 主色深底                                |
| `--crepe-color-on-secondary`       | `#ccfbf1` | 深底文字                                |
| `--crepe-color-inverse`            | `#ccfbf1` | 反色底                                  |
| `--crepe-color-on-inverse`         | `#134e4a` | 反色底文字                              |
| `--crepe-color-inline-code`        | `#fb923c` | 行内代码文字                            |
| `--crepe-color-error`              | `#f87171` | 错误                                    |
| `--crepe-color-hover`              | `#262626` | 悬停底                                  |
| `--crepe-color-selected`           | `#134e4a` | 选中底                                  |
| `--crepe-color-inline-area`        | `#333333` | 行内编辑区                              |

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
