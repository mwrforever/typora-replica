// 面板开合快捷键测试（Ctrl+, 开合 / 其余按键不触发 / 注销生效）
//
// 合成 KeyboardEvent 直发 window（真实监听链路，与 search-shortcuts.spec 同口径）；
// afterEach 注销监听避免用例间 window 级监听泄漏（本仓快捷键用例既有惯例）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerSettingsShortcuts } from "./settings-shortcuts";

function pressKey(key: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
}

describe("registerSettingsShortcuts", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("Ctrl+, 触发面板开合", () => {
    const onTogglePanel = vi.fn();
    cleanup = registerSettingsShortcuts({ onTogglePanel });
    pressKey(",", { ctrlKey: true });
    expect(onTogglePanel).toHaveBeenCalledOnce();
  });

  it("无修饰 / Shift / Alt 修饰的逗号不触发（窗口级纯 Ctrl 组合口径）", () => {
    const onTogglePanel = vi.fn();
    cleanup = registerSettingsShortcuts({ onTogglePanel });
    pressKey(",");
    pressKey(",", { ctrlKey: true, shiftKey: true });
    pressKey(",", { ctrlKey: true, altKey: true });
    pressKey(",", { ctrlKey: true, metaKey: true });
    expect(onTogglePanel).not.toHaveBeenCalled();
  });

  it("Ctrl+非逗号键不触发（修饰链全假侧 + 键名判定早退，让位其余 Ctrl 组合）", () => {
    const onTogglePanel = vi.fn();
    cleanup = registerSettingsShortcuts({ onTogglePanel });
    pressKey("x", { ctrlKey: true });
    pressKey("F5", { ctrlKey: true });
    expect(onTogglePanel).not.toHaveBeenCalled();
  });

  it("注销函数移除监听（App 卸载清理）", () => {
    const onTogglePanel = vi.fn();
    const dispose = registerSettingsShortcuts({ onTogglePanel });
    dispose();
    pressKey(",", { ctrlKey: true });
    expect(onTogglePanel).not.toHaveBeenCalled();
  });
});
