// keyBinding 组合串解析测试（AC-C1-2 典型组合 / AC-C1-4 非法忽略）
import { describe, expect, it } from "vitest";
import { parseShortcutCombo } from "./shortcut-keys";

describe("parseShortcutCombo 合法组合", () => {
  it("AC-C1-2 示例：Ctrl+Shift+P → Mod-Shift-p", () => {
    expect(parseShortcutCombo("Ctrl+Shift+P")).toBe("Mod-Shift-p");
  });

  it("Ctrl+Alt+1 → Mod-Alt-1（功能组合含数字主键）", () => {
    expect(parseShortcutCombo("Ctrl+Alt+1")).toBe("Mod-Alt-1");
  });

  it("Ctrl+Shift+= → Mod-Shift-=（符号主键）", () => {
    expect(parseShortcutCombo("Ctrl+Shift+=")).toBe("Mod-Shift-=");
  });

  it("Ctrl+F12 → Mod-f12（具名功能键）", () => {
    expect(parseShortcutCombo("Ctrl+F12")).toBe("Mod-f12");
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
  });
});
