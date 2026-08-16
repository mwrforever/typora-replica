// 窗口级快捷键测试（02 注册，12 可接管）
//
// 4 用例覆盖：Ctrl+S 触发并阻止默认 / Ctrl+P 触发快速打开 /
// 无 Ctrl 修饰不触发（含 Shift 组合排除）/ 注销后不再触发。
import { describe, expect, it, vi, afterEach } from "vitest";
import { registerAppShortcuts } from "./app-shortcuts";

describe("窗口级快捷键（02 注册，12 可接管）", () => {
  afterEach(() => {
    window.dispatchEvent(new KeyboardEvent("keyup")); // 清理（注销函数已在用例内调用）
  });

  it("Ctrl+S 触发保存并阻止默认", () => {
    const onSave = vi.fn();
    const cleanup = registerAppShortcuts({ onSave, onQuickOpen: vi.fn() });
    const ev = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true });
    const prevented = !window.dispatchEvent(ev);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(true);
    cleanup();
  });

  it("Ctrl+P 触发快速打开", () => {
    const onQuickOpen = vi.fn();
    const cleanup = registerAppShortcuts({ onSave: vi.fn(), onQuickOpen });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true }));
    expect(onQuickOpen).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("无 Ctrl 修饰的按键不触发", () => {
    const onSave = vi.fn();
    const cleanup = registerAppShortcuts({ onSave, onQuickOpen: vi.fn() });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, shiftKey: true }));
    expect(onSave).not.toHaveBeenCalled();
    cleanup();
  });

  it("注销后不再触发", () => {
    const onSave = vi.fn();
    const cleanup = registerAppShortcuts({ onSave, onQuickOpen: vi.fn() });
    cleanup();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));
    expect(onSave).not.toHaveBeenCalled();
  });
});
