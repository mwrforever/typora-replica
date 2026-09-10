// 设置项注册表（10 偏好面板数据基座）
//
// 职责：①面板 7 分区导航数据（Save & Recover 为 General 内部区锚点——用户实测裁决）；
// ②12.1-12.7 设置项全集的展示元数据（label / 搜索关键词 / 生效时机 / 禁用占位），
// 搜索过滤与「重启生效」徽标由本表驱动（单一事实源，分区表单组件经 SettingRow 消费同一条目）；
// ③Ctrl+F 过滤纯函数。
// 缺项声明：12.3 Legacy inline math parsing 不入表（调研 §6 裁决：官方无此选项记载，避免死配置）。

/** 设置分区 id（nav 序即展示序） */
export type SettingsSectionId =
  "general" | "save-recover" | "editor" | "image" | "appearance" | "markdown" | "export";

/** 生效时机：instant = 值变更即被消费方读取；restart = 需重启（面板标注「重启生效」，AC-S1-5） */
export type SettingEffect = "instant" | "restart";

/** 分区定义（save-recover 锚点点击时切到 general 并滚动定位） */
export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  /** 内部区锚点所属分区（仅 save-recover 使用） */
  anchorOf?: "general";
}

/** 设置项展示元数据（控件形态由分区表单组件承载，本表不描述控件） */
export interface SettingsItem {
  /** 注册表唯一 id（分区表单经 SETTINGS_ITEM_BY_ID 取同一条目渲染徽标/占位） */
  id: string;
  /** 展示分区 */
  section: SettingsSectionId;
  /** 面板显示名（中文） */
  label: string;
  /** 搜索关键词（空格分隔，含英文别名） */
  keywords: string;
  /** 生效时机 */
  effect: SettingEffect;
  /** 禁用占位（云上传等，AC-S1-4） */
  disabled?: boolean;
  /** 禁用原因（禁用时必填） */
  disabledReason?: string;
}

/** 七分区（AC-S1-1：7 分区导航，General 含 Save & Recover 内部区） */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "general", label: "General" },
  { id: "save-recover", label: "Save & Recover", anchorOf: "general" },
  { id: "editor", label: "Editor" },
  { id: "image", label: "Image" },
  { id: "appearance", label: "Appearance" },
  { id: "markdown", label: "Markdown" },
  { id: "export", label: "Export" },
];

/** 设置项全集（12.1-12.7 逐项核对见计划「设置项全集核对表」） */
export const SETTINGS_ITEMS: SettingsItem[] = [
  // ── General（12.6）──
  {
    id: "general.launch",
    section: "general",
    label: "启动行为",
    keywords: "启动 launch startup new reopen",
    effect: "instant",
  },
  {
    id: "general.open-theme-folder",
    section: "general",
    label: "打开主题文件夹",
    keywords: "主题 目录 theme folder open",
    effect: "instant",
  },
  {
    id: "general.open-advanced-settings",
    section: "general",
    label: "打开高级设置文件",
    keywords: "高级 conf.user.json advanced open",
    effect: "instant",
  },
  {
    id: "general.language",
    section: "general",
    label: "界面语言",
    keywords: "语言 language locale i18n",
    effect: "restart",
    disabled: true,
    disabledReason: "首版跟随系统，多语言未开放",
  },
  {
    id: "general.reset-advanced-settings",
    section: "general",
    label: "重置高级设置",
    keywords: "重置 reset 高级 advanced 默认",
    effect: "instant",
  },
  {
    id: "general.advanced-search-service",
    section: "general",
    label: "searchService（右键搜索服务列表）",
    keywords: "searchService 搜索 服务 高级",
    effect: "restart",
  },
  {
    id: "general.advanced-flags",
    section: "general",
    label: "flags（Chromium 启动参数）",
    keywords: "flags chromium 高级 启动参数",
    effect: "restart",
  },
  {
    id: "general.advanced-key-binding",
    section: "general",
    label: "keyBinding（自定义快捷键）",
    keywords: "keyBinding 快捷键 高级 shortcut",
    effect: "restart",
  },
  // ── Save & Recover（General 内部区；12.2 Auto Save 项的面板落位）──
  {
    id: "save-recover.auto-save",
    section: "save-recover",
    label: "自动保存",
    keywords: "自动保存 autoSave save recover 备份",
    effect: "instant",
  },
  {
    id: "save-recover.auto-save-timer",
    section: "save-recover",
    label: "保存间隔（分钟）",
    keywords: "间隔 timer autoSaveTimer 分钟 保存",
    effect: "instant",
  },
  // ── Editor（12.2）──
  {
    id: "editor.image-copy-to-folder",
    section: "editor",
    label: "插入图片复制到指定文件夹",
    keywords: "copy images folder 图片 复制 image insert",
    effect: "instant",
  },
  {
    id: "editor.image-relative-path",
    section: "editor",
    label: "图片引用使用相对路径",
    keywords: "relative path 图片 相对路径 image",
    effect: "instant",
  },
  {
    id: "editor.image-dot-slash",
    section: "editor",
    label: "相对路径加 ./ 前缀",
    keywords: "prefix ./ 前缀 图片 image",
    effect: "instant",
  },
  {
    id: "editor.image-url-escape",
    section: "editor",
    label: "URL 转义",
    keywords: "url escape 转义 图片 image",
    effect: "instant",
  },
  {
    id: "editor.auto-pair-brackets",
    section: "editor",
    label: "自动配对括号与引号",
    keywords: "auto pair 括号 引号 配对 bracket",
    effect: "restart",
  },
  {
    id: "editor.auto-pair-markdown",
    section: "editor",
    label: "自动配对 Markdown 语法标记",
    keywords: "auto pair markdown 配对 语法",
    effect: "restart",
  },
  {
    id: "editor.default-line-ending",
    section: "editor",
    label: "默认行尾符",
    keywords: "line ending 行尾 CRLF LF 换行",
    effect: "instant",
  },
  // ── Image（12.4）──
  {
    id: "image.uploader",
    section: "image",
    label: "图片上传器",
    keywords: "upload 上传 云 cloud picgo image",
    effect: "restart",
    disabled: true,
    disabledReason: "云上传首版未开放",
  },
  {
    id: "image.insert-behavior",
    section: "image",
    label: "插入时处理范围",
    keywords: "insert 插入 本地 在线 local online image",
    effect: "restart",
  },
  {
    id: "image.yaml-auto-upload",
    section: "image",
    label: "YAML 触发自动上传",
    keywords: "yaml upload 自动上传 image",
    effect: "restart",
    disabled: true,
    disabledReason: "配合云上传，首版不做",
  },
  // ── Appearance（12.1）──
  {
    id: "appearance.light-theme",
    section: "appearance",
    label: "浅色模式主题",
    keywords: "theme 主题 light 浅色 appearance",
    effect: "instant",
  },
  {
    id: "appearance.dark-theme",
    section: "appearance",
    label: "深色模式主题",
    keywords: "theme 主题 dark 深色 appearance",
    effect: "instant",
  },
  {
    id: "appearance.show-status-bar",
    section: "appearance",
    label: "显示状态栏",
    keywords: "status bar 状态栏 显示 show",
    effect: "restart",
  },
  {
    id: "appearance.font-size",
    section: "appearance",
    label: "字号",
    keywords: "font size 字号 appearance",
    effect: "restart",
  },
  {
    id: "appearance.reading-speed",
    section: "appearance",
    label: "阅读速度（词/分钟）",
    keywords: "reading speed 阅读速度 words per minute",
    effect: "restart",
  },
  {
    id: "appearance.typewriter-click-center",
    section: "appearance",
    label: "打字机模式点击滚动居中",
    keywords: "typewriter click center 打字机 点击 居中 滚动 F9",
    effect: "instant",
  },
  {
    id: "appearance.advanced-default-font-family",
    section: "appearance",
    label: "defaultFontFamily（默认字体族）",
    keywords: "font family 字体 defaultFontFamily 高级",
    effect: "restart",
  },
  {
    id: "appearance.advanced-auto-hide-menu-bar",
    section: "appearance",
    label: "autoHideMenuBar（自动隐藏菜单栏）",
    keywords: "menu bar 菜单栏 autoHideMenuBar alt 隐藏",
    effect: "restart",
  },
  {
    id: "appearance.advanced-monocolor-emoji",
    section: "appearance",
    label: "monocolorEmoji（单色表情）",
    keywords: "emoji 表情 monocolor 单色",
    effect: "restart",
  },
  // ── Markdown（12.3，全部重启生效）──
  {
    id: "markdown.inline-math",
    section: "markdown",
    label: "行内数学公式",
    keywords: "inline math 行内 公式 latex",
    effect: "restart",
  },
  {
    id: "markdown.diagrams",
    section: "markdown",
    label: "图表（mermaid 等）",
    keywords: "diagrams 图表 mermaid flowchart",
    effect: "restart",
  },
  {
    id: "markdown.strict-mode",
    section: "markdown",
    label: "严格模式",
    keywords: "strict mode 严格 markdown",
    effect: "restart",
  },
  {
    id: "markdown.code-fence-line-numbers",
    section: "markdown",
    label: "代码块显示行号",
    keywords: "code fence line numbers 行号 代码",
    effect: "restart",
  },
  {
    id: "markdown.code-fence-wrap",
    section: "markdown",
    label: "代码块长行自动换行",
    keywords: "code fence wrap 换行 长行 代码",
    effect: "restart",
  },
  {
    id: "markdown.code-fence-shift-tab",
    section: "markdown",
    label: "Shift+Tab 缩进选中行",
    keywords: "shift tab indent 缩进 代码",
    effect: "restart",
  },
  {
    id: "markdown.code-fence-indent-width",
    section: "markdown",
    label: "代码块缩进宽度",
    keywords: "indent width 缩进 宽度 代码",
    effect: "restart",
  },
  {
    id: "markdown.code-fence-default-language",
    section: "markdown",
    label: "默认代码语言",
    keywords: "default language 默认语言 代码 code fence",
    effect: "restart",
  },
  {
    id: "markdown.code-fence-last-used",
    section: "markdown",
    label: "新代码块使用上次语言",
    keywords: "last used 上次语言 代码 code fence",
    effect: "restart",
  },
  {
    id: "markdown.highlight",
    section: "markdown",
    label: "==高亮== 语法",
    keywords: "highlight 高亮 语法 mark",
    effect: "restart",
  },
  {
    id: "markdown.superscript",
    section: "markdown",
    label: "上标语法",
    keywords: "superscript 上标 语法",
    effect: "restart",
  },
  {
    id: "markdown.subscript",
    section: "markdown",
    label: "下标语法",
    keywords: "subscript 下标 语法",
    effect: "restart",
  },
  {
    id: "markdown.spellcheck",
    section: "markdown",
    label: "拼写检查",
    keywords: "spellcheck 拼写 检查 语言",
    effect: "restart",
  },
  // ── Export（12.5）──
  {
    id: "export.location-mode",
    section: "export",
    label: "默认导出目录",
    keywords: "export location 导出 目录 auto custom",
    effect: "instant",
  },
  {
    id: "export.custom-dir",
    section: "export",
    label: "自定义导出目录",
    keywords: "export custom 目录 导出 folder",
    effect: "instant",
  },
  {
    id: "export.yaml-overrides",
    section: "export",
    label: "YAML 覆盖导出设置",
    keywords: "yaml override 覆盖 导出 front matter",
    effect: "restart",
  },
  {
    id: "export.items",
    section: "export",
    label: "导出项管理",
    keywords: "export items 导出项 增删 排序",
    effect: "instant",
  },
  {
    id: "export.html-include-outline",
    section: "export",
    label: "HTML 导出包含大纲",
    keywords: "html outline 大纲 include 导出",
    effect: "instant",
  },
  {
    id: "export.html-append-head-body",
    section: "export",
    label: "HTML 追加 head/body 标签",
    keywords: "html head body 标签 导出",
    effect: "restart",
  },
  {
    id: "export.html-theme",
    section: "export",
    label: "HTML 导出主题",
    keywords: "html theme 主题 导出",
    effect: "restart",
  },
  {
    id: "export.pdf-paper",
    section: "export",
    label: "PDF 纸张",
    keywords: "pdf paper 纸张 a4 导出",
    effect: "instant",
  },
  {
    id: "export.pdf-margin",
    section: "export",
    label: "PDF 页边距（英寸）",
    keywords: "pdf margin 边距 导出",
    effect: "restart",
  },
  {
    id: "export.pdf-theme",
    section: "export",
    label: "PDF 主题",
    keywords: "pdf theme 主题 浅色 导出",
    effect: "instant",
  },
  {
    id: "export.pdf-page-break-h1",
    section: "export",
    label: "PDF 一级标题分页",
    keywords: "pdf page break h1 分页 导出",
    effect: "instant",
  },
  {
    id: "export.pdf-header",
    section: "export",
    label: "PDF 页眉",
    keywords: "pdf header 页眉 导出",
    effect: "instant",
  },
  {
    id: "export.pdf-footer",
    section: "export",
    label: "PDF 页脚",
    keywords: "pdf footer 页脚 导出",
    effect: "instant",
  },
];

/** id → 条目索引（分区表单组件经 SettingRow 消费同一条目，徽标/占位单一事实源） */
export const SETTINGS_ITEM_BY_ID: Record<string, SettingsItem> = Object.fromEntries(
  SETTINGS_ITEMS.map((item) => [item.id, item]),
);

/**
 * 面板内 Ctrl+F 过滤（AC-S1-2）
 * @param items 全量条目
 * @param query 搜索词（空/纯空白 = 全量返回；label 与 keywords 大小写不敏感包含匹配）
 * @returns 命中条目（保持注册表原序）
 */
export function filterSettingsItems(items: SettingsItem[], query: string): SettingsItem[] {
  const q = query.trim().toLowerCase();
  if (q === "") return items;
  return items.filter(
    (item) => item.label.toLowerCase().includes(q) || item.keywords.toLowerCase().includes(q),
  );
}
