// keyBinding 组合串解析（10 C1：Typora 语法 → ProseMirror keymap 键名）
//
// Typora 语法："Ctrl+Shift+P"；本应用 Windows 平台，Ctrl/Cmd/Meta 统一归一 ProseMirror 的
// Mod（=Ctrl）。输出规范：修饰键按 Mod-Alt-Shift 固定序 + 小写主键（如 "Mod-Shift-p"），
// 与 prosemirror-keymap 的 normalizeKeyName 归一形态一致。
// 非法输入返回 undefined——调用方 console.warn 后忽略（AC-C1-4：忽略告警不崩溃）。
// 设计取舍：必须有 Ctrl/Cmd 修饰才接受（Shift/Alt 单独组合会劫持普通输入，不开放）。

/** 修饰键记号（大小写不敏感；control 为全称别名） */
const MODIFIERS = new Set(["ctrl", "control", "cmd", "meta", "alt", "shift"]);

/** 具名主键白名单（功能键 / 导航键 / 编辑键；单字符主键另行校验） */
const NAMED_KEYS = new Set([
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f9",
  "f10",
  "f11",
  "f12",
  "enter",
  "tab",
  "backspace",
  "delete",
  "escape",
  "insert",
  "space",
  "home",
  "end",
  "pageup",
  "pagedown",
  "up",
  "down",
  "left",
  "right",
]);

/** 单字符符号主键白名单（ProseMirror 常用可绑定符号） */
const SYMBOL_KEYS = new Set(["`", "-", "=", "[", "]", ";", "'", ",", ".", "/", "\\", "+"]);

/**
 * 解析 keyBinding 组合串
 * @param combo 用户配置组合串（如 "Ctrl+Shift+P"）
 * @returns ProseMirror 键名（如 "Mod-Shift-p"）；非法输入 undefined
 */
export function parseShortcutCombo(combo: string): string | undefined {
  const tokens = combo
    .split("+")
    .map((t) => t.trim())
    .filter((t) => t !== "");
  // 至少一个修饰键 + 一个主键
  if (tokens.length < 2) return undefined;
  const main = tokens[tokens.length - 1]!.toLowerCase();
  const mods = tokens.slice(0, -1).map((t) => t.toLowerCase());
  // 前缀位必须全是修饰键（主键名出现在前缀 = 顺序错误，判非法）
  if (!mods.every((m) => MODIFIERS.has(m))) return undefined;
  const hasCtrlLike = mods.some(
    (m) => m === "ctrl" || m === "control" || m === "cmd" || m === "meta",
  );
  // 无 Ctrl/Cmd 修饰的组合拒绝（AC-C1-4 防劫持口径）
  if (!hasCtrlLike) return undefined;
  // 主键校验：单字符 = 字母数字或符号白名单；多字符 = 具名键白名单
  const validMain =
    main.length === 1 ? /[a-z0-9]/i.test(main) || SYMBOL_KEYS.has(main) : NAMED_KEYS.has(main);
  if (!validMain) return undefined;
  const parts: string[] = ["Mod"];
  if (mods.includes("alt")) parts.push("Alt");
  if (mods.includes("shift")) parts.push("Shift");
  parts.push(main);
  return parts.join("-");
}
