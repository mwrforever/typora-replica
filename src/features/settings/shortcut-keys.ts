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
// 窗口保留组合（isWindowReservedCombo / WINDOW_RESERVED_PM_KEYS）：与窗口级快捷键同名的
// 组合一律拒绝——编辑器 keymap 命中仅 preventDefault 不阻断传播，同名窗口快捷键将与编辑器
// 动作双重执行（code-review M-1②）；12 模块接管窗口快捷键并统一 defaultPrevented 收口前，
// keyBinding 入口不得产生该类冲突组合，调用方经 isWindowReservedCombo 区分告警文案。

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
 * 窗口保留组合（canonical pmKey）：各窗口级快捷键服务当前实际注册、window 层恒消费的组合。
 * 名单来源（与各 shortcuts 服务保持同步，12 模块接管后随窗口注册表统一维护）：
 * 02 Ctrl+S 保存 / Ctrl+P 快速打开；03 Ctrl+Shift+L 侧栏 / Ctrl+Shift+F 全局搜索 /
 * Ctrl+Shift+1/2/3 面板切换；04 Ctrl+N 新建标签 / Ctrl+W 关闭标签 / Ctrl+Tab 轮换 /
 * Ctrl+Shift+T 重开关闭标签；06 Ctrl+F 搜索 / Ctrl+H 替换；10 Ctrl+, 面板开合。
 * （F3/Shift+F3/Escape 无 Ctrl 修饰，parseShortcutCombo 本就拒绝，不入集。）
 */
const WINDOW_RESERVED_PM_KEYS: ReadonlySet<string> = new Set([
  "Mod-s",
  "Mod-p",
  "Mod-Shift-l",
  "Mod-Shift-f",
  "Mod-Shift-1",
  "Mod-Shift-2",
  "Mod-Shift-3",
  "Mod-n",
  "Mod-w",
  "Mod-Tab",
  "Mod-Shift-t",
  "Mod-f",
  "Mod-h",
  "Mod-,",
]);

/**
 * 语法层解析（不检查窗口保留面）：Typora 组合串 → canonical ProseMirror 键名
 * @param combo 用户配置组合串
 * @returns canonical 键名；语法非法（修饰键/主键白名单未命中）undefined
 */
function parseCanonical(combo: string): string | undefined {
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

/**
 * 判定组合串是否命中窗口保留面（调用方区分告警文案用——parseShortcutCombo 对保留组合
 * 同样返回 undefined，仅凭其返回值无法区分「语法非法」与「窗口冲突」）
 * @param combo 用户配置组合串
 * @returns true = 与窗口级快捷键同名（canonical 化后比对，大小写/别名形态同样命中）
 */
export function isWindowReservedCombo(combo: string): boolean {
  const canonical = parseCanonical(combo);
  return canonical !== undefined && WINDOW_RESERVED_PM_KEYS.has(canonical);
}

/**
 * 解析 keyBinding 组合串
 * @param combo 用户配置组合串（如 "Ctrl+Shift+P"、"Ctrl+F12"）
 * @returns ProseMirror 键名（单字符主键如 "Mod-Shift-p"；具名主键为 canonical 事件键名，
 *          如 "Mod-F12" / "Mod-ArrowUp"）；非法输入或窗口保留组合（Ctrl+S/N/W/P/F/H/,/
 *          Shift+L/Shift+F/Shift+T/Tab/Shift+1/2/3，见 WINDOW_RESERVED_PM_KEYS）均 undefined
 */
export function parseShortcutCombo(combo: string): string | undefined {
  const pmKey = parseCanonical(combo);
  if (pmKey === undefined) return undefined;
  // 窗口保留组合拒绝（M-1②）：编辑器 keymap 命中仅 preventDefault 不阻断传播，
  // 同名窗口快捷键将与编辑器动作双重执行，keyBinding 入口不得产生该类组合
  if (WINDOW_RESERVED_PM_KEYS.has(pmKey)) return undefined;
  return pmKey;
}
