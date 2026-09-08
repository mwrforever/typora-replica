// 快捷键命令目录（10 C1：菜单快捷键展示数据基表 + keyBinding 可绑定命令清单）
//
// commandId 对齐 Typora 菜单命令名（conf.user.json keyBinding 的键面）；
// 首版范围（披露 3）：编辑器域十命令（bindMenuShortcut 目录同步维护）+ 窗口域四命令
// （仅展示数据，执行接线归 12 menuRouter——TASK.md 补验项）。

/** 快捷键命令定义 */
export interface ShortcutCommandDef {
  /** 菜单命令名（conf.user.json keyBinding 的键） */
  commandId: string;
  /** 菜单显示名（中文） */
  label: string;
  /** 命令域：editor = 01 keymap 注入生效；window = 12 菜单/窗口装配消费 */
  domain: "editor" | "window";
  /** 默认组合串（undefined = 无默认快捷键，如 Always on Top） */
  defaultCombo?: string;
}

/** 命令目录（默认组合与 01 内置键位 / 既有窗口快捷键对齐） */
export const SHORTCUT_COMMANDS: ShortcutCommandDef[] = [
  { commandId: "Heading 1", label: "标题 1", domain: "editor", defaultCombo: "Ctrl+1" },
  { commandId: "Heading 2", label: "标题 2", domain: "editor", defaultCombo: "Ctrl+2" },
  { commandId: "Heading 3", label: "标题 3", domain: "editor", defaultCombo: "Ctrl+3" },
  { commandId: "Heading 4", label: "标题 4", domain: "editor", defaultCombo: "Ctrl+4" },
  { commandId: "Heading 5", label: "标题 5", domain: "editor", defaultCombo: "Ctrl+5" },
  { commandId: "Heading 6", label: "标题 6", domain: "editor", defaultCombo: "Ctrl+6" },
  { commandId: "Paragraph", label: "段落", domain: "editor", defaultCombo: "Ctrl+0" },
  { commandId: "Code Fences", label: "代码块", domain: "editor", defaultCombo: "Ctrl+Shift+K" },
  { commandId: "Inline Code", label: "行内代码", domain: "editor", defaultCombo: "Ctrl+Shift+`" },
  { commandId: "Bold", label: "加粗", domain: "editor", defaultCombo: "Ctrl+B" },
  { commandId: "Italic", label: "斜体", domain: "editor", defaultCombo: "Ctrl+I" },
  { commandId: "Always on Top", label: "窗口置顶", domain: "window" },
  {
    commandId: "Toggle Sidebar",
    label: "切换侧栏",
    domain: "window",
    defaultCombo: "Ctrl+Shift+L",
  },
  { commandId: "New Tab", label: "新建标签页", domain: "window", defaultCombo: "Ctrl+N" },
  { commandId: "Close Tab", label: "关闭标签页", domain: "window", defaultCombo: "Ctrl+W" },
];
