// 原生菜单树构建纯函数（12 窗口外壳 W2；AC-M-1/AC-M-2 数据源）
//
// 职责：按 00 spec §11 七菜单表（唯一权威）构建 MenuNode JSON 值树 +
// 合成 label 快捷键文本（"命令名\t组合串"，\t 分隔）。纯函数无 IO 无副作用，
// 单测 100%（spec §4 核心域：菜单-命令路由表配套数据）。
//
// label 快捷键文本两类策略（调研报告 1.10）：
// 1. catalog 内命令（10 SHORTCUT_COMMANDS）→ 经 MenuTreeInput.shortcutEntries
//   （settingsStore.menuShortcutEntries 实时合并 keyBinding 覆盖）取 label 与组合串；
// 2. 其余项 → 硬编码中文 label + 组合串（逐项对照 00 spec §11 表）。
// 真实性纪律：可启用项的组合串必须是当前真实注册的快捷键（编辑器内置键位/窗口级
// keydown/WebView 原生光标行为——Edit 菜单「跳转到顶部/底部」的 Ctrl+Home/End 为
// WebView 自带编辑键位，前端不拦截由 WebView 执行）；未注册组合的项不拼 "\t" 段
//（防虚假快捷键提示）；后续工作包注册组合后随批补文案。禁用项可保留设计目标组合
//（AC 禁用态语义，不可点不产生虚假承诺）。
import type { MenuNode } from "../../services/menu-io";
import type { MenuShortcutEntry } from "../settings/shortcut-binding";
import type { ExportMenuEntry } from "../export/export-commands";
import type { ThemeMeta } from "../../services/theme-io";
import type { ThemeMode } from "../theme/theme-store";

/** 菜单树构建输入（动态数据全部显式入参，纯函数可测） */
export interface MenuTreeInput {
  /** 快捷键展示条目（catalog 15 命令；默认表 + keyBinding 覆盖实时合并） */
  shortcutEntries: readonly MenuShortcutEntry[];
  /** 导出菜单条目（getExportMenuEntries 实时产物；run 由 menuRouter 消费） */
  exportEntries: readonly ExportMenuEntry[];
  /** 主题列表（themeStore.themes；Themes 动态子菜单数据源，AC-M-4） */
  themes: readonly ThemeMeta[];
  /** 当前激活主题名（按系统色系解析；undefined = 无激活主题，全部不勾选） */
  activeThemeName: string | undefined;
  /** 当前色系（Themes 勾选归属与主题切换的模式入参） */
  activeMode: ThemeMode;
  /** 最近文件路径列表（RecentFiles.list；Open Recent 动态子菜单数据源） */
  recentPaths: readonly string[];
}

/**
 * 合成菜单 label 快捷键文本（"命令名\t组合串"形态，\t 分隔；组合串空则不拼）
 * @param label 菜单显示名
 * @param combo 组合串（undefined/空串 = 无快捷键文本段）
 * @returns 完整 label 文本
 */
export function composeMenuLabel(label: string, combo: string | undefined): string {
  return combo ? `${label}\t${combo}` : label;
}

/** 不可用菜单项快捷构造（禁用态语义集中标注） */
function disabled(id: string, label: string): MenuNode {
  return { kind: "item", id, label, enabled: false };
}

/** 从快捷键条目取 catalog 命令的展示数据（label/组合串单一来源） */
function catalogEntry(
  entries: readonly MenuShortcutEntry[],
  commandId: string,
): { label: string; combo: string } {
  const entry = entries.find((e) => e.commandId === commandId);
  // 目录键恒存在（catalog 声明保障）；防御缺键回落无快捷键文本，不抛错断链
  return entry ? { label: entry.label, combo: entry.combo } : { label: commandId, combo: "" };
}

/** catalog 命令 → 可执行菜单项（label/组合串走实时条目；AC-M-2 实时文本路径） */
function catalogItem(
  id: string,
  commandId: string,
  entries: readonly MenuShortcutEntry[],
): MenuNode {
  const { label, combo } = catalogEntry(entries, commandId);
  return { kind: "item", id, label: composeMenuLabel(label, combo), enabled: true };
}

/**
 * 构建 File 菜单子树（00 spec §11.1：New/New Window/New Tab/Open/Open Quickly/
 * Open Recent/Reopen Closed/Save/Save As/Export/Print/Preference/Close）
 */
function buildFileMenu(input: MenuTreeInput): MenuNode {
  // Open Recent 子菜单：最近文件逐项（id 携路径，menuRouter 按同键建路由）+ 清除项；
  // 列表为空时不渲染分组分隔线（防空段残留）
  const recentItems: MenuNode[] = input.recentPaths.map((path) => ({
    kind: "item",
    id: `file.open-recent.${path}`,
    label: path,
    enabled: true,
  }));
  const openRecent: MenuNode = {
    kind: "submenu",
    id: "file.open-recent",
    label: "最近打开",
    items: [
      ...recentItems,
      ...(recentItems.length > 0 ? [{ kind: "separator" } as MenuNode] : []),
      { kind: "item", id: "file.clear-recent", label: "清除列表", enabled: true },
    ],
  };
  // Export 子菜单：导出项实时列表（enabled 透传占位禁用）+ 两固定项前插分隔线
  //（分隔线语义归 12 渲染——export-commands.ts 尾随固定项约定）
  const firstFixedIndex = input.exportEntries.findIndex((e) => e.id === "export-with-previous");
  const exportItems: MenuNode[] = input.exportEntries
    .map((entry, index) => {
      const nodes: MenuNode[] = [];
      // 首个固定项前渲染分隔线（格式项 ∥ 重复导出固定项的分组边界）
      if (index === firstFixedIndex) nodes.push({ kind: "separator" });
      nodes.push({
        kind: "item",
        id: `export.${entry.id}`,
        label: entry.label,
        enabled: entry.enabled,
      });
      return nodes;
    })
    .flat();
  return {
    kind: "submenu",
    id: "menu.file",
    label: "文件",
    items: [
      // 新建标签页：00 spec §11.1 标注 Win 无快捷键（官方 Not Supported）——label
      // 不拼组合段；Ctrl+N 键盘通路归「新建」（04 tabs-shortcuts 仍注册新建标签）
      { kind: "item", id: "file.new-tab", label: "新建标签页", enabled: true },
      // 新建窗口：12 W3 已接入（Ctrl+Shift+N 随 W3 注册，AC-M-16）
      { kind: "item", id: "file.new-window", label: "新建窗口\tCtrl+Shift+N", enabled: true },
      { kind: "item", id: "file.new", label: "新建\tCtrl+N", enabled: true },
      { kind: "separator" },
      { kind: "item", id: "file.open", label: "打开\tCtrl+O", enabled: true },
      { kind: "item", id: "file.open-quickly", label: "快速打开\tCtrl+P", enabled: true },
      openRecent,
      {
        kind: "item",
        id: "file.reopen-closed",
        label: "重新打开关闭的文件\tCtrl+Shift+T",
        enabled: true,
      },
      { kind: "separator" },
      { kind: "item", id: "file.save", label: "保存\tCtrl+S", enabled: true },
      { kind: "item", id: "file.save-as", label: "另存为\tCtrl+Shift+S", enabled: true },
      {
        kind: "submenu",
        id: "file.export",
        label: "导出",
        items: exportItems,
      },
      // 打印：无打印实现面（09 侧仅 export_pdf 落盘管线），用户裁决首版禁用态
      disabled("file.print", "打印"),
      { kind: "separator" },
      { kind: "item", id: "file.preference", label: "偏好设置\tCtrl+,", enabled: true },
      catalogItem("file.close", "Close Tab", input.shortcutEntries),
    ],
  };
}

/**
 * 构建 Edit 菜单子树（00 spec §11.2；编辑器命令经 01 命令目录执行——id 前缀
 * "editor." 的路由统一转 runEditorMenuCommand，命令名即目录键）
 */
function buildEditMenu(): MenuNode {
  return {
    kind: "submenu",
    id: "menu.edit",
    label: "编辑",
    items: [
      { kind: "item", id: "editor.New Paragraph", label: "新段落\tEnter", enabled: true },
      { kind: "item", id: "editor.New Line", label: "新行\tShift+Enter", enabled: true },
      { kind: "separator" },
      { kind: "predefined", item: "Cut", label: "剪切" },
      { kind: "predefined", item: "Copy", label: "复制" },
      { kind: "predefined", item: "Paste", label: "粘贴" },
      { kind: "item", id: "app.copy-as-markdown", label: "复制为 Markdown", enabled: true },
      { kind: "item", id: "app.paste-as-plain-text", label: "粘贴为纯文本", enabled: true },
      { kind: "separator" },
      { kind: "predefined", item: "SelectAll", label: "全选" },
      // 行/句选择、表格删行、样式范围、词选择/删除：01 无对应命令实现面，明确禁用
      disabled("edit.select-line", "选择行/句\tCtrl+L"),
      disabled("edit.delete-row", "删除行\tCtrl+Shift+Backspace"),
      disabled("edit.select-style-scope", "选择样式范围\tCtrl+E"),
      disabled("edit.select-word", "选择词\tCtrl+D"),
      disabled("edit.delete-word", "删除词\tCtrl+Shift+D"),
      { kind: "separator" },
      { kind: "item", id: "editor.Jump to Top", label: "跳转到顶部\tCtrl+Home", enabled: true },
      { kind: "item", id: "editor.Jump to Bottom", label: "跳转到底部\tCtrl+End", enabled: true },
      { kind: "item", id: "editor.Jump to Selection", label: "跳转到选区", enabled: true },
      { kind: "separator" },
      { kind: "item", id: "app.toggle-find", label: "查找\tCtrl+F", enabled: true },
      { kind: "item", id: "app.toggle-replace", label: "替换\tCtrl+H", enabled: true },
      { kind: "item", id: "app.find-next", label: "查找下一个\tF3", enabled: true },
      { kind: "item", id: "app.find-prev", label: "查找上一个\tShift+F3", enabled: true },
      { kind: "separator" },
      // 以下为无实现面入口：明确禁用（00 spec §11.2 对应功能未落地）
      disabled("edit.emoji", "表情和符号"),
      disabled("edit.math-tools", "数学工具"),
      disabled("edit.whitespace", "空格与换行"),
      disabled("edit.spell-check", "拼写检查…"),
    ],
  };
}

/**
 * 构建 Paragraph 菜单子树（00 spec §11.3；标题 1-6/正文/代码块走 catalog 实时条目，
 * 其余走 01 命令目录硬编码 label）
 */
function buildParagraphMenu(input: MenuTreeInput): MenuNode {
  const headingItems: MenuNode[] = [1, 2, 3, 4, 5, 6].map((level) =>
    catalogItem(`editor.Heading ${level}`, `Heading ${level}`, input.shortcutEntries),
  );
  return {
    kind: "submenu",
    id: "menu.paragraph",
    label: "段落",
    items: [
      ...headingItems,
      catalogItem("editor.Paragraph", "Paragraph", input.shortcutEntries),
      {
        kind: "item",
        id: "editor.Increase Heading Level",
        label: "增加标题级别\tCtrl+=",
        enabled: true,
      },
      {
        kind: "item",
        id: "editor.Decrease Heading Level",
        label: "减少标题级别\tCtrl+-",
        enabled: true,
      },
      { kind: "separator" },
      // 表格可执行（01 目录 InsertTable）；组合键 Ctrl+T 未注册，不拼虚假快捷键
      { kind: "item", id: "editor.Table", label: "表格", enabled: true },
      catalogItem("editor.Code Fences", "Code Fences", input.shortcutEntries),
      // 数学块：无插入命令面（Crepe latex 仅有行内 toggle），明确禁用
      disabled("editor.Math Block", "数学块\tCtrl+Shift+M"),
      { kind: "item", id: "editor.Quote", label: "引用块", enabled: true },
      { kind: "item", id: "editor.Ordered List", label: "有序列表", enabled: true },
      { kind: "item", id: "editor.Unordered List", label: "无序列表", enabled: true },
      { kind: "item", id: "editor.Indent", label: "增加缩进\tCtrl+[", enabled: true },
      { kind: "item", id: "editor.Outdent", label: "减少缩进\tCtrl+]", enabled: true },
    ],
  };
}

/**
 * 构建 Format 菜单子树（00 spec §11.4；加粗/斜体/行内代码走 catalog 实时条目，
 * 删除线走 01 命令目录，下划线/超链接/图片/清除格式无实现面明确禁用）
 */
function buildFormatMenu(input: MenuTreeInput): MenuNode {
  return {
    kind: "submenu",
    id: "menu.format",
    label: "格式",
    items: [
      catalogItem("editor.Bold", "Bold", input.shortcutEntries),
      catalogItem("editor.Italic", "Italic", input.shortcutEntries),
      // 下划线：schema 无 underline mark（E16 范围外），明确禁用
      disabled("editor.Underline", "下划线\tCtrl+U"),
      catalogItem("editor.Inline Code", "Inline Code", input.shortcutEntries),
      // 删除线可执行（01 目录 ToggleStrikeThrough）；Alt+Shift+5 未注册不拼快捷键
      { kind: "item", id: "editor.Strike", label: "删除线", enabled: true },
      { kind: "separator" },
      // 超链接：toggleLink 空载荷会插入无 href 链接（E14 输入流程未接菜单），明确禁用
      disabled("editor.Hyperlink", "超链接\tCtrl+K"),
      // 图片：Ctrl+Shift+I 菜单插入流程未实现（07 为粘贴上传链路），明确禁用
      disabled("editor.Image", "图片\tCtrl+Shift+I"),
      // 清除格式：无单命令实现面（需批量卸除标记组合操作），明确禁用
      disabled("editor.Clear Format", "清除格式\tCtrl+\\"),
    ],
  };
}

/**
 * 构建 View 菜单子树（00 spec §11.5；侧栏/面板/搜索/切换文档/DevTools/全屏/缩放/
 * 置顶可执行，源码模式/专注/打字机属 W4~W5 工作包，先以禁用态占位）
 */
function buildViewMenu(): MenuNode {
  return {
    kind: "submenu",
    id: "menu.view",
    label: "视图",
    items: [
      { kind: "item", id: "view.toggle-sidebar", label: "切换侧栏\tCtrl+Shift+L", enabled: true },
      { kind: "item", id: "view.panel-outline", label: "大纲\tCtrl+Shift+1", enabled: true },
      { kind: "item", id: "view.panel-list", label: "文章列表\tCtrl+Shift+2", enabled: true },
      { kind: "item", id: "view.panel-tree", label: "文件树\tCtrl+Shift+3", enabled: true },
      { kind: "separator" },
      // 源码模式：W4 接入（Ctrl+/）
      disabled("view.source-mode", "源码模式\tCtrl+/"),
      // 专注模式：W5 接入（F8）
      disabled("view.focus-mode", "专注模式\tF8"),
      // 打字机模式：W5 接入（F9）
      disabled("view.typewriter-mode", "打字机模式\tF9"),
      { kind: "separator" },
      // 全屏/缩放三键：12 W3 已接入（F11 / Ctrl+Shift+0/=/-，AC-M-13/14）
      { kind: "item", id: "view.fullscreen", label: "切换全屏\tF11", enabled: true },
      { kind: "item", id: "view.zoom-actual", label: "原始尺寸\tCtrl+Shift+0", enabled: true },
      { kind: "item", id: "view.zoom-in", label: "放大\tCtrl+Shift+=", enabled: true },
      { kind: "item", id: "view.zoom-out", label: "缩小\tCtrl+Shift+-", enabled: true },
      // 窗口置顶：12 W3 已接入（无默认快捷键——00 spec §2.3，可经 10 keyBinding 自定义）
      { kind: "item", id: "view.always-on-top", label: "窗口置顶", enabled: true },
      { kind: "separator" },
      { kind: "item", id: "view.global-search", label: "全局搜索\tCtrl+Shift+F", enabled: true },
      { kind: "item", id: "view.switch-doc", label: "切换打开的文档\tCtrl+Tab", enabled: true },
      { kind: "item", id: "view.toggle-devtools", label: "开发者工具\tShift+F12", enabled: true },
    ],
  };
}

/**
 * 构建 Themes 菜单子树（00 spec §11.6 动态菜单；主题逐项可勾选 + 打开主题文件夹，
 * AC-M-4：主题列表变化经装配层 watch 触发整树重建）
 */
function buildThemesMenu(input: MenuTreeInput): MenuNode {
  const themeItems: MenuNode[] = input.themes.map((theme) => ({
    kind: "check-item",
    id: `themes.select.${theme.name}`,
    label: theme.label,
    enabled: true,
    // 勾选态 = 当前模式激活主题（selectTheme 的 name 比对口径）
    checked: theme.name === input.activeThemeName,
  }));
  return {
    kind: "submenu",
    id: "menu.themes",
    label: "主题",
    items: [
      ...themeItems,
      ...(themeItems.length > 0 ? [{ kind: "separator" } as MenuNode] : []),
      { kind: "item", id: "themes.open-folder", label: "打开主题文件夹", enabled: true },
    ],
  };
}

/**
 * 构建 Help 菜单子树（00 spec §11.7：帮助入口为静态页面，低优先未实现——
 * 全部禁用态占位，后续迭代接入本地帮助页）
 */
function buildHelpMenu(): MenuNode {
  return {
    kind: "submenu",
    id: "menu.help",
    label: "帮助",
    items: [
      disabled("help.markdown-reference", "Markdown 参考"),
      disabled("help.custom-themes", "自定义主题"),
    ],
  };
}

/**
 * 构建完整菜单树（AC-M-1：File/Edit/Paragraph/Format/View/Themes/Help 七菜单）
 * @param input 动态数据入参（快捷键条目/导出条目/主题/最近文件）
 * @returns 七菜单顶层子树（JSON 值对象，可直接交 services/menu-io 挂载）
 */
export function buildMenuTree(input: MenuTreeInput): MenuNode[] {
  return [
    buildFileMenu(input),
    buildEditMenu(),
    buildParagraphMenu(input),
    buildFormatMenu(input),
    buildViewMenu(),
    buildThemesMenu(input),
    buildHelpMenu(),
  ];
}
