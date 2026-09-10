// keyBinding 组合串解析测试（AC-C1-2 典型组合 / AC-C1-4 非法忽略）
// 具名主键期望 canonical 事件键名形态：prosemirror-keymap 的 keydownHandler 以
// KeyboardEvent.key 原样查表（大小写敏感），小写产物（如 Mod-f12）解析通过但按键
// 永不生效（批 3 审核 Important-1）——缝合用例组以真实按键验证防字符串层钉错期望。
import { keydownHandler } from "@milkdown/kit/prose/keymap";
import { describe, expect, it } from "vitest";
import { isWindowReservedCombo, parseShortcutCombo } from "./shortcut-keys";

describe("parseShortcutCombo 合法组合", () => {
  it("AC-C1-2 示例：Ctrl+Shift+P → Mod-Shift-p", () => {
    expect(parseShortcutCombo("Ctrl+Shift+P")).toBe("Mod-Shift-p");
  });

  it("Ctrl+Alt+1 → Mod-Alt-1（功能组合含数字主键）", () => {
    expect(parseShortcutCombo("Ctrl+Alt+1")).toBe("Mod-Alt-1");
  });

  it("Ctrl+Shift+] → Mod-Shift-]（符号主键；原 Ctrl+Shift+= 样例已入 W3 窗口保留面）", () => {
    expect(parseShortcutCombo("Ctrl+Shift+]")).toBe("Mod-Shift-]");
  });

  it("Ctrl+F12 → Mod-F12（具名功能键 canonical 形态，事件键名查表大小写敏感）", () => {
    expect(parseShortcutCombo("Ctrl+F12")).toBe("Mod-F12");
  });

  it("Ctrl+Up → Mod-ArrowUp（方向键 canonical 为事件键名 ArrowUp）", () => {
    expect(parseShortcutCombo("Ctrl+Up")).toBe("Mod-ArrowUp");
  });

  it("Ctrl+Space → Mod-Space（normalizeKeyName 将 Space 特例归一为空格键 event.key）", () => {
    expect(parseShortcutCombo("Ctrl+Space")).toBe("Mod-Space");
  });

  it("Ctrl+` → Mod-`（反引号主键）", () => {
    expect(parseShortcutCombo("Ctrl+`")).toBe("Mod-`");
  });

  it("修饰键顺序无关且输出规范序（Mod-Alt-Shift）", () => {
    expect(parseShortcutCombo("Shift+Alt+Ctrl+K")).toBe("Mod-Alt-Shift-k");
  });
});

describe("parseShortcutCombo 非法组合（返回 undefined，调用方告警忽略）", () => {
  it("无修饰键拒绝（防劫持普通输入键）", () => {
    expect(parseShortcutCombo("Shift+A")).toBeUndefined();
    expect(parseShortcutCombo("Alt+F4")).toBeUndefined();
  });

  it("仅修饰键无主键拒绝", () => {
    expect(parseShortcutCombo("Ctrl")).toBeUndefined();
    expect(parseShortcutCombo("Ctrl+Shift+")).toBeUndefined();
  });

  it("未知记号拒绝（主键名出现在前缀位）", () => {
    expect(parseShortcutCombo("Ctrl+A+P")).toBeUndefined();
  });

  it("空串与纯空白拒绝", () => {
    expect(parseShortcutCombo("")).toBeUndefined();
    expect(parseShortcutCombo("   ")).toBeUndefined();
  });

  it("未知具名键拒绝（防脏键面进 keymap）", () => {
    expect(parseShortcutCombo("Ctrl+NotAKey")).toBeUndefined();
    // 白名单外单字符符号（@ 不可绑定）同拒绝
    expect(parseShortcutCombo("Ctrl+@")).toBeUndefined();
  });
});

describe("parseShortcutCombo 窗口保留组合拒绝（code-review M-1②）", () => {
  // 编辑器 keymap 命中仅 preventDefault 不阻断传播，同名窗口快捷键（保存/新建标签/搜索
  // 面板等）将与编辑器动作双重执行——keyBinding 入口不得产生该类冲突组合
  it("窗口层已注册的组合拒绝（保存/快速打开/标签/搜索/侧栏/面板开合）", () => {
    expect(parseShortcutCombo("Ctrl+S")).toBeUndefined(); // 02 保存
    expect(parseShortcutCombo("Ctrl+P")).toBeUndefined(); // 02 快速打开
    expect(parseShortcutCombo("Ctrl+N")).toBeUndefined(); // 04 新建标签
    expect(parseShortcutCombo("Ctrl+W")).toBeUndefined(); // 04 关闭标签
    expect(parseShortcutCombo("Ctrl+Shift+T")).toBeUndefined(); // 04 重开关闭标签
    expect(parseShortcutCombo("Ctrl+Tab")).toBeUndefined(); // 04 标签轮换
    expect(parseShortcutCombo("Ctrl+Shift+Tab")).toBeUndefined(); // 04 标签轮换 Shift 反向（R-1）
    expect(parseShortcutCombo("Ctrl+F")).toBeUndefined(); // 06 搜索面板
    expect(parseShortcutCombo("Ctrl+H")).toBeUndefined(); // 06 替换面板
    expect(parseShortcutCombo("Ctrl+Shift+L")).toBeUndefined(); // 03 侧栏开关
    expect(parseShortcutCombo("Ctrl+Shift+F")).toBeUndefined(); // 03 全局搜索
    expect(parseShortcutCombo("Ctrl+Shift+1")).toBeUndefined(); // 03 面板切换
    expect(parseShortcutCombo("Ctrl+,")).toBeUndefined(); // 10 面板开合
    expect(parseShortcutCombo("Ctrl+O")).toBeUndefined(); // 12 打开文件（W2 菜单装配）
    expect(parseShortcutCombo("Ctrl+Shift+S")).toBeUndefined(); // 12 另存为（W2 菜单装配）
    expect(parseShortcutCombo("Ctrl+Shift+N")).toBeUndefined(); // 12 新建窗口（W3，AC-M-16）
    expect(parseShortcutCombo("Ctrl+Shift+0")).toBeUndefined(); // 12 缩放原始尺寸（W3，AC-M-14）
    expect(parseShortcutCombo("Ctrl+Shift+=")).toBeUndefined(); // 12 缩放放大（W3，AC-M-14）
    expect(parseShortcutCombo("Ctrl+Shift+-")).toBeUndefined(); // 12 缩放缩小（W3，AC-M-14）
  });

  it("大小写与修饰键别名归一后同样命中拒绝（canonical 化比对防绕过）", () => {
    expect(parseShortcutCombo("ctrl+s")).toBeUndefined();
    expect(parseShortcutCombo("Control+S")).toBeUndefined();
    expect(parseShortcutCombo("Ctrl+Shift+l")).toBeUndefined();
  });

  it("非保留组合不受影响（Ctrl+J 正常解析）", () => {
    expect(parseShortcutCombo("Ctrl+J")).toBe("Mod-j");
  });
});

describe("isWindowReservedCombo 冲突判定（调用方区分告警文案）", () => {
  it("窗口保留组合返回 true（含大小写与别名形态）", () => {
    expect(isWindowReservedCombo("Ctrl+S")).toBe(true);
    expect(isWindowReservedCombo("Ctrl+Shift+L")).toBe(true);
    expect(isWindowReservedCombo("ctrl+n")).toBe(true);
    // 12 W2 菜单装配引入的键盘通路（Ctrl+O 打开 / Ctrl+Shift+S 另存为）
    expect(isWindowReservedCombo("Ctrl+O")).toBe(true);
    expect(isWindowReservedCombo("Ctrl+Shift+S")).toBe(true);
  });

  it("非保留组合与非法组合返回 false", () => {
    expect(isWindowReservedCombo("Ctrl+J")).toBe(false);
    expect(isWindowReservedCombo("Shift+B")).toBe(false); // 非法组合非窗口冲突
    expect(isWindowReservedCombo("Ctrl+NotAKey")).toBe(false);
  });
});

describe("parseShortcutCombo 产物经真实按键验证（缝合用例）", () => {
  // 批 3 审核 Important-1 回归防线：解析产物必须能被 prosemirror-keymap keydownHandler
  // 的真实事件键名查表命中（handled: true），防止「字符串层钉错期望」类静默失效复发。
  // 缝合断言只触达 command 调用面（state/dispatch 原样透传给命令），无需完整 EditorView 实例。
  const fakeView = {
    state: {},
    dispatch: () => {},
  } as unknown as Parameters<ReturnType<typeof keydownHandler>>[0];

  it("Ctrl+F12 产物注册后真实按下 F12 可命中（handled: true）", () => {
    const key = parseShortcutCombo("Ctrl+F12");
    expect(key).toBeDefined();
    const handle = keydownHandler({ [key!]: () => true });
    expect(handle(fakeView, new KeyboardEvent("keydown", { key: "F12", ctrlKey: true }))).toBe(
      true,
    );
  });

  it("Ctrl+Up 产物注册后真实按下 ArrowUp 可命中（方向键事件键名错位防线）", () => {
    const key = parseShortcutCombo("Ctrl+Up");
    expect(key).toBeDefined();
    const handle = keydownHandler({ [key!]: () => true });
    expect(handle(fakeView, new KeyboardEvent("keydown", { key: "ArrowUp", ctrlKey: true }))).toBe(
      true,
    );
  });

  it("Ctrl+Space 产物注册后真实按下空格键可命中（Space 归一特例防线）", () => {
    const key = parseShortcutCombo("Ctrl+Space");
    expect(key).toBeDefined();
    const handle = keydownHandler({ [key!]: () => true });
    expect(handle(fakeView, new KeyboardEvent("keydown", { key: " ", ctrlKey: true }))).toBe(true);
  });
});
