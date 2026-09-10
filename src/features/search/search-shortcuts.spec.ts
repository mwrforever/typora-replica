// window 层快捷键分发用例：合成 KeyboardEvent 直发 window（真实监听链路）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSearchShortcuts } from "./search-shortcuts";

describe("registerSearchShortcuts", () => {
  const handlers = {
    onToggleFind: vi.fn(),
    onToggleReplace: vi.fn(),
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onClose: vi.fn(),
  };
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    for (const fn of Object.values(handlers)) fn.mockClear();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  function press(init: KeyboardEventInit): KeyboardEvent {
    const ev = new KeyboardEvent("keydown", { cancelable: true, bubbles: true, ...init });
    window.dispatchEvent(ev);
    return ev;
  }

  it("Ctrl+F/Ctrl+H 分发开关回调并拦截默认行为", () => {
    cleanup = registerSearchShortcuts(handlers);
    expect(press({ key: "f", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(handlers.onToggleFind).toHaveBeenCalledOnce();
    expect(press({ key: "h", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(handlers.onToggleReplace).toHaveBeenCalledOnce();
  });

  it("带 Shift/Alt/Meta 的 Ctrl 组合不命中（避免与其他模块冲突）", () => {
    cleanup = registerSearchShortcuts(handlers);
    press({ key: "f", ctrlKey: true, shiftKey: true });
    press({ key: "h", ctrlKey: true, altKey: true });
    expect(handlers.onToggleFind).not.toHaveBeenCalled();
    expect(handlers.onToggleReplace).not.toHaveBeenCalled();
  });

  it("F3 → Next、Shift+F3 → Prev 且拦截默认（浏览器查找栏）", () => {
    cleanup = registerSearchShortcuts(handlers);
    press({ key: "F3" });
    expect(handlers.onNext).toHaveBeenCalledOnce();
    press({ key: "F3", shiftKey: true });
    expect(handlers.onPrev).toHaveBeenCalledOnce();
  });

  it("Escape 恒上报 onClose（可见性守卫由接线方负责）；IME 组合期全部跳过", () => {
    cleanup = registerSearchShortcuts(handlers);
    press({ key: "Escape" });
    expect(handlers.onClose).toHaveBeenCalledOnce();
    press({ key: "f", ctrlKey: true, isComposing: true });
    press({ key: "F3", isComposing: true });
    expect(handlers.onToggleFind).not.toHaveBeenCalled();
    expect(handlers.onNext).not.toHaveBeenCalled();
  });

  it("返回注销函数：注销后不再分发", () => {
    cleanup = registerSearchShortcuts(handlers);
    cleanup();
    cleanup = undefined;
    press({ key: "f", ctrlKey: true });
    expect(handlers.onToggleFind).not.toHaveBeenCalled();
  });

  it("编辑器已消费的按键不重复触发搜索面板（defaultPrevented 守卫，TASK 10#3）", () => {
    // prosemirror-view 命中键位仅 preventDefault 不阻断传播，事件仍冒泡到 window；
    // keyBinding 把编辑器命令绑到 Ctrl+F/H 时面板动作不得二次执行
    cleanup = registerSearchShortcuts(handlers);
    const findEvent = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    });
    findEvent.preventDefault();
    window.dispatchEvent(findEvent);
    const replaceEvent = new KeyboardEvent("keydown", {
      key: "h",
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    });
    replaceEvent.preventDefault();
    window.dispatchEvent(replaceEvent);
    expect(handlers.onToggleFind).not.toHaveBeenCalled();
    expect(handlers.onToggleReplace).not.toHaveBeenCalled();
  });
});
