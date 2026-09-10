// 窗口外壳快捷键测试（12 W2：Ctrl+O 打开 / Ctrl+Shift+S 另存为；
// 12 W3：F11 全屏 / Ctrl+Shift+0/=/- 缩放三键 / Ctrl+Shift+N 新建窗口）
//
// 合成 KeyboardEvent 直发 window（与 app-shortcuts.spec 同口径）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerWindowShellShortcuts } from "./window-shortcuts";

/** 回调夹具（全 vi.fn；单用例按需断言目标回调） */
function makeHandlers() {
  return {
    onOpenFile: vi.fn(),
    onSaveAs: vi.fn(),
    onToggleFullscreen: vi.fn(),
    onZoomReset: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onNewWindow: vi.fn(),
  };
}

describe("registerWindowShellShortcuts（W2：Ctrl+O / Ctrl+Shift+S）", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("Ctrl+O 触发打开文件并拦截默认行为", () => {
    const handlers = makeHandlers();
    cleanup = registerWindowShellShortcuts(handlers);
    const event = new KeyboardEvent("keydown", { key: "o", ctrlKey: true, cancelable: true });
    const prevented = !window.dispatchEvent(event);
    expect(handlers.onOpenFile).toHaveBeenCalledOnce();
    expect(handlers.onSaveAs).not.toHaveBeenCalled();
    expect(prevented).toBe(true);
  });

  it("Ctrl+Shift+S 触发另存为（与纯 Ctrl+S 保存区分）", () => {
    const handlers = makeHandlers();
    cleanup = registerWindowShellShortcuts(handlers);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, shiftKey: true, cancelable: true }),
    );
    expect(handlers.onSaveAs).toHaveBeenCalledOnce();
    expect(handlers.onOpenFile).not.toHaveBeenCalled();
  });

  it("无 Ctrl 修饰 / Alt/Meta 修饰不触发（窗口级纯 Ctrl 组合口径）", () => {
    const handlers = makeHandlers();
    cleanup = registerWindowShellShortcuts(handlers);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "o", cancelable: true }));
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "o", altKey: true, cancelable: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", metaKey: true, shiftKey: true, cancelable: true }),
    );
    expect(handlers.onOpenFile).not.toHaveBeenCalled();
    expect(handlers.onSaveAs).not.toHaveBeenCalled();
  });

  it("编辑器已消费的按键不重复触发（defaultPrevented 守卫，TASK 10#3 同款）", () => {
    const handlers = makeHandlers();
    cleanup = registerWindowShellShortcuts(handlers);
    const openEvent = new KeyboardEvent("keydown", { key: "o", ctrlKey: true, cancelable: true });
    openEvent.preventDefault();
    window.dispatchEvent(openEvent);
    expect(handlers.onOpenFile).not.toHaveBeenCalled();
  });

  it("纯 Ctrl+S（无 Shift）不归本服务（02 保存路径独占，分流判定早退）", () => {
    const handlers = makeHandlers();
    cleanup = registerWindowShellShortcuts(handlers);
    const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true });
    const prevented = !window.dispatchEvent(event);
    expect(handlers.onOpenFile).not.toHaveBeenCalled();
    expect(handlers.onSaveAs).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
  });

  it("注销后不再触发", () => {
    const handlers = makeHandlers();
    const dispose = registerWindowShellShortcuts(handlers);
    dispose();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "o", ctrlKey: true }));
    expect(handlers.onOpenFile).not.toHaveBeenCalled();
  });
});

describe("registerWindowShellShortcuts（W3：F11 全屏，AC-M-13）", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("F11 单键触发全屏切换并拦截默认行为", () => {
    const handlers = makeHandlers();
    cleanup = registerWindowShellShortcuts(handlers);
    const event = new KeyboardEvent("keydown", { key: "F11", cancelable: true });
    const prevented = !window.dispatchEvent(event);
    expect(handlers.onToggleFullscreen).toHaveBeenCalledOnce();
    expect(prevented).toBe(true);
  });

  it("带修饰键的 F11 不触发（保留系统/编辑器组合语义）", () => {
    const handlers = makeHandlers();
    cleanup = registerWindowShellShortcuts(handlers);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F11", ctrlKey: true, cancelable: true }),
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F11", shiftKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F11", altKey: true }));
    expect(handlers.onToggleFullscreen).not.toHaveBeenCalled();
  });
});

describe("registerWindowShellShortcuts（W3：缩放三键，AC-M-14）", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("Ctrl+Shift+0（物理键位 Digit0）触发恢复原始尺寸", () => {
    const handlers = makeHandlers();
    cleanup = registerWindowShellShortcuts(handlers);
    // Shift 参与时 event.key 随布局漂移（美式键盘 Shift+0 → ")"），
    // 派发携带漂移后的 key 以钉住物理键位判定不受影响
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ")",
        code: "Digit0",
        ctrlKey: true,
        shiftKey: true,
        cancelable: true,
      }),
    );
    expect(handlers.onZoomReset).toHaveBeenCalledOnce();
    expect(handlers.onZoomIn).not.toHaveBeenCalled();
  });

  it("Ctrl+Shift+=（Shift 漂移 key=+，物理键位 Equal）触发放大一档", () => {
    const handlers = makeHandlers();
    cleanup = registerWindowShellShortcuts(handlers);
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "+",
        code: "Equal",
        ctrlKey: true,
        shiftKey: true,
        cancelable: true,
      }),
    );
    expect(handlers.onZoomIn).toHaveBeenCalledOnce();
  });

  it("Ctrl+Shift+-（Shift 漂移 key=_，物理键位 Minus）触发缩小一档", () => {
    const handlers = makeHandlers();
    cleanup = registerWindowShellShortcuts(handlers);
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "_",
        code: "Minus",
        ctrlKey: true,
        shiftKey: true,
        cancelable: true,
      }),
    );
    expect(handlers.onZoomOut).toHaveBeenCalledOnce();
  });

  it("无 Shift 的 Ctrl+0/=/- 不归本服务（编辑器 Paragraph/标题层级键位独占）", () => {
    const handlers = makeHandlers();
    cleanup = registerWindowShellShortcuts(handlers);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "0", code: "Digit0", ctrlKey: true, cancelable: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "=", code: "Equal", ctrlKey: true, cancelable: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "-", code: "Minus", ctrlKey: true, cancelable: true }),
    );
    expect(handlers.onZoomReset).not.toHaveBeenCalled();
    expect(handlers.onZoomIn).not.toHaveBeenCalled();
    expect(handlers.onZoomOut).not.toHaveBeenCalled();
  });

  it("缩放组合键拦截默认行为（WebView 无原生语义也不放行）", () => {
    const handlers = makeHandlers();
    cleanup = registerWindowShellShortcuts(handlers);
    const event = new KeyboardEvent("keydown", {
      key: "+",
      code: "Equal",
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });
    const prevented = !window.dispatchEvent(event);
    expect(prevented).toBe(true);
  });
});

describe("registerWindowShellShortcuts（W3：Ctrl+Shift+N 新建窗口，AC-M-16）", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("Ctrl+Shift+N 触发新建窗口（与纯 Ctrl+N 新建标签区分）", () => {
    const handlers = makeHandlers();
    cleanup = registerWindowShellShortcuts(handlers);
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "N",
        code: "KeyN",
        ctrlKey: true,
        shiftKey: true,
        cancelable: true,
      }),
    );
    expect(handlers.onNewWindow).toHaveBeenCalledOnce();
  });

  it("纯 Ctrl+N 不触发新建窗口（04 新建标签路径独占）", () => {
    const handlers = makeHandlers();
    cleanup = registerWindowShellShortcuts(handlers);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "n", code: "KeyN", ctrlKey: true, cancelable: true }),
    );
    expect(handlers.onNewWindow).not.toHaveBeenCalled();
  });

  it("Ctrl+Shift+N 已被消费时不重复触发（defaultPrevented 守卫）", () => {
    const handlers = makeHandlers();
    cleanup = registerWindowShellShortcuts(handlers);
    const event = new KeyboardEvent("keydown", {
      key: "N",
      code: "KeyN",
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });
    event.preventDefault();
    window.dispatchEvent(event);
    expect(handlers.onNewWindow).not.toHaveBeenCalled();
  });
});
