// 重复导出会话级记忆测试（X6 登记面：登记/读取/按 tab 隔离/重置）
import { beforeEach, describe, expect, it, vi } from "vitest";

// tabs-store 桩：activeTabId 经外部可变变量控制，模拟多标签切换
const tabsState = vi.hoisted(() => ({ activeTabId: "tab-1" as string | undefined }));
vi.mock("../tabs/tabs-store", () => ({
  useTabsStore: () => ({
    get activeTabId() {
      return tabsState.activeTabId;
    },
  }),
}));

import {
  getPreviousSnapshot,
  recordExportSnapshot,
  resetExportPreviousForTest,
} from "./export-previous";

describe("export-previous（X6 登记面）", () => {
  beforeEach(() => {
    resetExportPreviousForTest();
    tabsState.activeTabId = "tab-1";
  });

  it("登记后读取到完整快照（format/destinationPath/options）", () => {
    recordExportSnapshot("html", "D:/out/手册.html", { includeOutline: true });
    const snap = getPreviousSnapshot();
    expect(snap?.format).toBe("html");
    expect(snap?.destinationPath).toBe("D:/out/手册.html");
    expect(snap?.options).toEqual({ includeOutline: true });
    expect(typeof snap?.savedAt).toBe("number");
  });

  it("无登记时返回 undefined", () => {
    expect(getPreviousSnapshot()).toBeUndefined();
  });

  it("切换 tab 后读取的是新 tab 的快照（按文档隔离）", () => {
    recordExportSnapshot("html", "D:/out/tab1.html", {});
    tabsState.activeTabId = "tab-2";
    // tab-2 尚无登记 → undefined；登记后读到 tab-2 自己的快照
    expect(getPreviousSnapshot()).toBeUndefined();
    recordExportSnapshot("html-plain", "D:/out/tab2.html", {});
    expect(getPreviousSnapshot()?.destinationPath).toBe("D:/out/tab2.html");
    // 切回 tab-1：仍是 tab-1 原快照（互不串扰）
    tabsState.activeTabId = "tab-1";
    expect(getPreviousSnapshot()?.destinationPath).toBe("D:/out/tab1.html");
  });

  it("同文档重复导出覆盖旧快照（保留最新）", () => {
    recordExportSnapshot("html", "D:/out/old.html", {});
    recordExportSnapshot("pdf", "D:/out/new.pdf", { header: "t" });
    const snap = getPreviousSnapshot();
    expect(snap?.format).toBe("pdf");
    expect(snap?.destinationPath).toBe("D:/out/new.pdf");
  });

  it("reset 清空全部会话记忆（用例间隔离）", () => {
    recordExportSnapshot("html", "D:/out/a.html", {});
    resetExportPreviousForTest();
    expect(getPreviousSnapshot()).toBeUndefined();
  });
});
