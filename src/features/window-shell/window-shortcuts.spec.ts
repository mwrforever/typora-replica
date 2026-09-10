// 窗口外壳快捷键测试（12 W2：Ctrl+O 打开 / Ctrl+Shift+S 另存为）
//
// 合成 KeyboardEvent 直发 window（与 app-shortcuts.spec 同口径）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerWindowShellShortcuts } from "./window-shortcuts";

describe("registerWindowShellShortcuts", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("Ctrl+O 触发打开文件并拦截默认行为", () => {
    const onOpenFile = vi.fn();
    const onSaveAs = vi.fn();
    cleanup = registerWindowShellShortcuts({ onOpenFile, onSaveAs });
    const event = new KeyboardEvent("keydown", { key: "o", ctrlKey: true, cancelable: true });
    const prevented = !window.dispatchEvent(event);
    expect(onOpenFile).toHaveBeenCalledOnce();
    expect(onSaveAs).not.toHaveBeenCalled();
    expect(prevented).toBe(true);
  });

  it("Ctrl+Shift+S 触发另存为（与纯 Ctrl+S 保存区分）", () => {
    const onOpenFile = vi.fn();
    const onSaveAs = vi.fn();
    cleanup = registerWindowShellShortcuts({ onOpenFile, onSaveAs });
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, shiftKey: true, cancelable: true }),
    );
    expect(onSaveAs).toHaveBeenCalledOnce();
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("无 Ctrl 修饰 / Alt/Meta 修饰不触发（窗口级纯 Ctrl 组合口径）", () => {
    const onOpenFile = vi.fn();
    const onSaveAs = vi.fn();
    cleanup = registerWindowShellShortcuts({ onOpenFile, onSaveAs });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "o", cancelable: true }));
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "o", altKey: true, cancelable: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", metaKey: true, shiftKey: true, cancelable: true }),
    );
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(onSaveAs).not.toHaveBeenCalled();
  });

  it("编辑器已消费的按键不重复触发（defaultPrevented 守卫，TASK 10#3 同款）", () => {
    const onOpenFile = vi.fn();
    const onSaveAs = vi.fn();
    cleanup = registerWindowShellShortcuts({ onOpenFile, onSaveAs });
    const openEvent = new KeyboardEvent("keydown", { key: "o", ctrlKey: true, cancelable: true });
    openEvent.preventDefault();
    window.dispatchEvent(openEvent);
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("纯 Ctrl+S（无 Shift）不归本服务（02 保存路径独占，分流判定早退）", () => {
    const onOpenFile = vi.fn();
    const onSaveAs = vi.fn();
    cleanup = registerWindowShellShortcuts({ onOpenFile, onSaveAs });
    const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true });
    const prevented = !window.dispatchEvent(event);
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(onSaveAs).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
  });

  it("注销后不再触发", () => {
    const onOpenFile = vi.fn();
    const dispose = registerWindowShellShortcuts({ onOpenFile, onSaveAs: vi.fn() });
    dispose();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "o", ctrlKey: true }));
    expect(onOpenFile).not.toHaveBeenCalled();
  });
});
