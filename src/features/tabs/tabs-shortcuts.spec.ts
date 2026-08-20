// 标签快捷键测试（04：Ctrl+N 新建 / Ctrl+W 关闭 / Ctrl+Tab 轮换 / Ctrl+Shift+T 重开）
//
// 覆盖三组行为：目标组合逐一触发（含 Ctrl+Tab 在 WebView2 的 key 为 "Tab" 大写）、
// 非目标组合不触发（纯 Shift+Tab / Ctrl+Alt+N / Ctrl+Meta+N / 纯 Ctrl+E）、注销后不再响应。
// fireEvent 走 @testing-library/vue 再导出（项目既有组件用例惯例，避免依赖传递性包）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/vue";
import { registerTabsShortcuts } from "./tabs-shortcuts";

describe("tabs-shortcuts 标签快捷键", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => cleanup?.());

  it("Ctrl+N 新建 / Ctrl+W 关闭 / Ctrl+Tab 正向 / Ctrl+Shift+Tab 反向 / Ctrl+Shift+T 重开", () => {
    const handlers = {
      onNewTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCycle: vi.fn(),
      onReopenClosed: vi.fn(),
    };
    cleanup = registerTabsShortcuts(handlers);
    // 修饰键须显式展开为 key*Key 字段（本版 @testing-library/dom 不支持 ctrl 简写）
    const keydown = (
      key: string,
      mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {},
    ) =>
      fireEvent.keyDown(window, {
        key,
        ctrlKey: mods.ctrl,
        shiftKey: mods.shift,
        altKey: mods.alt,
        metaKey: mods.meta,
      });
    keydown("n", { ctrl: true });
    expect(handlers.onNewTab).toHaveBeenCalledTimes(1);
    keydown("w", { ctrl: true });
    expect(handlers.onCloseTab).toHaveBeenCalledTimes(1);
    keydown("Tab", { ctrl: true });
    expect(handlers.onCycle).toHaveBeenLastCalledWith(1);
    keydown("Tab", { ctrl: true, shift: true });
    expect(handlers.onCycle).toHaveBeenLastCalledWith(-1);
    keydown("t", { ctrl: true, shift: true });
    expect(handlers.onReopenClosed).toHaveBeenCalledTimes(1);
  });

  it("非目标组合不触发（纯 Shift+Tab、Ctrl+Alt+N、Ctrl+Meta+N、纯 Ctrl+E）", () => {
    const handlers = {
      onNewTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCycle: vi.fn(),
      onReopenClosed: vi.fn(),
    };
    cleanup = registerTabsShortcuts(handlers);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    fireEvent.keyDown(window, { key: "n", ctrlKey: true, altKey: true });
    fireEvent.keyDown(window, { key: "n", ctrlKey: true, metaKey: true });
    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    expect(handlers.onNewTab).not.toHaveBeenCalled();
    expect(handlers.onCloseTab).not.toHaveBeenCalled();
    expect(handlers.onCycle).not.toHaveBeenCalled();
    expect(handlers.onReopenClosed).not.toHaveBeenCalled();
  });

  it("cleanup 后不再响应", () => {
    const handlers = {
      onNewTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCycle: vi.fn(),
      onReopenClosed: vi.fn(),
    };
    cleanup = registerTabsShortcuts(handlers);
    cleanup();
    cleanup = undefined;
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(handlers.onNewTab).not.toHaveBeenCalled();
  });
});
