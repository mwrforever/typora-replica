// 侧栏快捷键注册测试（03 文件树，F2/F12）
//
// 覆盖：Ctrl+Shift+L/1/2/3/F 触发对应回调 / 注销后不再触发 /
// 纯 Ctrl（无 Shift）不触发（与 02 registerAppShortcuts 互不干扰）。
import { describe, expect, it } from "vitest";
import { registerFileTreeShortcuts } from "./file-tree-shortcuts";

describe("file-tree-shortcuts", () => {
  it("Ctrl+Shift+L 切换侧栏 / Ctrl+Shift+1/2/3 切换面板 / Ctrl+Shift+F 搜索", () => {
    const calls: string[] = [];
    const cleanup = registerFileTreeShortcuts({
      toggleSidebar: () => calls.push("toggle"),
      switchPanel: (key) => calls.push(`panel:${key}`),
      showSearch: () => calls.push("search"),
    });
    const fire = (key: string) =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    fire("l");
    fire("1");
    fire("2");
    fire("3");
    fire("f");
    expect(calls).toEqual(["toggle", "panel:outline", "panel:list", "panel:tree", "search"]);
    cleanup();
    fire("l");
    expect(calls).toHaveLength(5); // 注销后不再触发
  });

  it("纯 Ctrl（无 Shift）不触发（与 02 快捷键互不干扰）", () => {
    const calls: string[] = [];
    const cleanup = registerFileTreeShortcuts({
      toggleSidebar: () => calls.push("toggle"),
      switchPanel: () => calls.push("panel"),
      showSearch: () => calls.push("search"),
    });
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "l", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(calls).toEqual([]);
    cleanup();
  });
});
