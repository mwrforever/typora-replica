// keyBinding 组合串解析（10 C1：Typora 语法 → ProseMirror keymap 键名）
//
// Typora 语法："Ctrl+Shift+P"；本应用 Windows 平台，Ctrl/Cmd/Meta 统一归一 ProseMirror 的
// Mod（=Ctrl）。输出规范：修饰键按 Mod-Alt-Shift 固定序；单字符主键保留小写（如 "Mod-Shift-p"，
// PM 约定字母键以小写引用）；具名主键输出 canonical 事件键名（如 "Mod-F12" / "Mod-ArrowUp"）——
// prosemirror-keymap 的 keydownHandler 以 KeyboardEvent.key 原样查表（大小写敏感），
// canonical 键名必须匹配 normalizeKeyName 后的事件键名，否则解析通过但按键静默失效
// （批 3 审核 Important-1）。
// 非法输入返回 undefined——调用方 console.warn 后忽略（AC-C1-4：忽略告警不崩溃）。
// 设计取舍：必须有 Ctrl/Cmd 修饰才接受（Shift/Alt 单独组合会劫持普通输入，不开放）。

/** 修饰键记号（大小写不敏感；control 为全称别名） */
const MODIFIERS = new Set(["ctrl", "control", "cmd", "meta", "alt", "shift"]);

/**
 * 具名主键白名单 → canonical 事件键名映射（键：小写输入记号；值：canonical 事件键名）。
 * canonical 键名必须匹配 prosemirror-keymap normalizeKeyName 后的事件键名（大小写敏感）：
 * keydownHandler 以 KeyboardEvent.key 原样查表，小写形态（如 f12）注入成功但按键永不生效。
 * 方向键以事件键名 Arrow* 为准（旧记号 up/left 等与事件键名本身错位，一并矫正）；
 * Space 为 normalizeKeyName 特例——绑定侧 "Space" 会归一为空格键的 event.key（" "），
 * 与真实按键事件对齐。
 */
const NAMED_KEYS = new Map<string, string>([
  ["f1", "F1"],
  ["f2", "F2"],
  ["f3", "F3"],
  ["f4", "F4"],
  ["f5", "F5"],
  ["f6", "F6"],
  ["f7", "F7"],
  ["f8", "F8"],
  ["f9", "F9"],
  ["f10", "F10"],
  ["f11", "F11"],
  ["f12", "F12"],
  ["enter", "Enter"],
  ["tab", "Tab"],
  ["backspace", "Backspace"],
  ["delete", "Delete"],
  ["escape", "Escape"],
  ["insert", "Insert"],
  ["space", "Space"],
  ["home", "Home"],
  ["end", "End"],
  ["pageup", "PageUp"],
  ["pagedown", "PageDown"],
  ["up", "ArrowUp"],
  ["down", "ArrowDown"],
  ["left", "ArrowLeft"],
  ["right", "ArrowRight"],
]);

/** 单字符符号主键白名单（ProseMirror 常用可绑定符号） */
const SYMBOL_KEYS = new Set(["`", "-", "=", "[", "]", ";", "'", ",", ".", "/", "\\", "+"]);

/**
 * 解析 keyBinding 组合串
 * @param combo 用户配置组合串（如 "Ctrl+Shift+P"、"Ctrl+F12"）
 * @returns ProseMirror 键名（单字符主键如 "Mod-Shift-p"；具名主键为 canonical 事件键名，
 *          如 "Mod-F12" / "Mod-ArrowUp"）；非法输入 undefined
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
  // 主键校验与 canonical 化：单字符 = 字母数字或符号白名单，原样输出（字母保持小写）；
  // 多字符 = 具名键白名单，映射为 canonical 事件键名（查表大小写敏感，禁再小写化）
  let canonicalMain: string | undefined;
  if (main.length === 1) {
    if (/[a-z0-9]/i.test(main) || SYMBOL_KEYS.has(main)) canonicalMain = main;
  } else {
    canonicalMain = NAMED_KEYS.get(main);
  }
  // 白名单未命中（含具名键查表 miss）= 非法主键
  if (canonicalMain === undefined) return undefined;
  const parts: string[] = ["Mod"];
  if (mods.includes("alt")) parts.push("Alt");
  if (mods.includes("shift")) parts.push("Shift");
  parts.push(canonicalMain);
  return parts.join("-");
}
