// 重复导出会话级记忆测试（X6 登记面 + 复用/覆盖两命令：登记/读取/按 tab 隔离/重置/重执行分派）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// tabs-store 桩：activeTabId 经外部可变变量控制，模拟多标签切换
const tabsState = vi.hoisted(() => ({ activeTabId: "tab-1" as string | undefined }));
vi.mock("../tabs/tabs-store", () => ({
  useTabsStore: () => ({
    get activeTabId() {
      return tabsState.activeTabId;
    },
  }),
}));

// 导出管线桩：rerunSnapshot 经动态 import 加载，vi.mock 对动态 import 同样生效
const exportMocks = vi.hoisted(() => ({
  exportHtml: vi.fn(),
  exportPlainHtml: vi.fn(),
  exportPdf: vi.fn(),
}));
vi.mock("./html-export", () => ({
  exportHtml: exportMocks.exportHtml,
  exportPlainHtml: exportMocks.exportPlainHtml,
}));
vi.mock("./pdf-export", () => ({
  exportPdf: exportMocks.exportPdf,
}));

import {
  exportOverwriteWithPrevious,
  exportWithPrevious,
  getPreviousSnapshot,
  recordExportSnapshot,
  resetExportPreviousForTest,
} from "./export-previous";

describe("export-previous（X6 登记面）", () => {
  beforeEach(() => {
    resetExportPreviousForTest();
    tabsState.activeTabId = "tab-1";
  });

  afterEach(() => {
    // 覆盖警告经 window.confirm 弹出，桩须逐用例还原；导出桩实现与调用记录逐用例清零
    vi.unstubAllGlobals();
    exportMocks.exportHtml.mockReset();
    exportMocks.exportPlainHtml.mockReset();
    exportMocks.exportPdf.mockReset();
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

describe("export-previous（X6 复用/覆盖两命令）", () => {
  beforeEach(() => {
    resetExportPreviousForTest();
    tabsState.activeTabId = "tab-a";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    exportMocks.exportHtml.mockReset();
    exportMocks.exportPlainHtml.mockReset();
    exportMocks.exportPdf.mockReset();
  });

  it("AC-X6-1：有快照时复用上次选项与路径重新导出（HTML）", async () => {
    recordExportSnapshot("html", "D:/old.html", { includeOutline: true });
    exportMocks.exportHtml.mockResolvedValue({ path: "D:/old.html", format: "html" });
    const result = await exportWithPrevious();
    // 快照选项原样复用 + 目标路径锁定快照路径
    expect(exportMocks.exportHtml).toHaveBeenCalledTimes(1);
    expect(exportMocks.exportHtml).toHaveBeenCalledWith({
      includeOutline: true,
      destinationPath: "D:/old.html",
    });
    expect(result).toEqual({ path: "D:/old.html", format: "html" });
  });

  it("AC-X6-1：无快照回落正常 HTML 导出（无参调用、不弹错不打断）", async () => {
    const result = await exportWithPrevious();
    expect(exportMocks.exportHtml).toHaveBeenCalledWith();
    expect(result).toBeUndefined();
  });

  it("AC-X6-2：确认覆盖后按快照格式走 PDF 管线并锁定快照路径", async () => {
    recordExportSnapshot("pdf", "D:/out/report.pdf", {});
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    exportMocks.exportPdf.mockResolvedValue({ path: "D:/out/report.pdf", format: "pdf" });
    const result = await exportOverwriteWithPrevious();
    // 覆盖警告必须先于导出弹出且被用户确认
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(exportMocks.exportPdf).toHaveBeenCalledTimes(1);
    expect(exportMocks.exportPdf).toHaveBeenCalledWith({ destinationPath: "D:/out/report.pdf" });
    expect(exportMocks.exportHtml).not.toHaveBeenCalled();
    expect(result).toEqual({ path: "D:/out/report.pdf", format: "pdf" });
  });

  it("AC-X6-2：用户取消覆盖警告则不执行任何导出", async () => {
    recordExportSnapshot("pdf", "D:/out/report.pdf", {});
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);
    const result = await exportOverwriteWithPrevious();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(exportMocks.exportPdf).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("AC-X6-3：切换文档后无快照，覆盖导出静默返回 undefined（按文档隔离）", async () => {
    recordExportSnapshot("html", "D:/old.html", {});
    tabsState.activeTabId = "tab-z";
    const result = await exportOverwriteWithPrevious();
    expect(result).toBeUndefined();
    expect(exportMocks.exportHtml).not.toHaveBeenCalled();
    expect(exportMocks.exportPdf).not.toHaveBeenCalled();
  });

  it("AC-X6-2：HTML 快照覆盖导出走 HTML 管线（按快照格式分派）", async () => {
    recordExportSnapshot("html", "D:/out/page.html", { includeOutline: true });
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    exportMocks.exportHtml.mockResolvedValue({ path: "D:/out/page.html", format: "html" });
    const result = await exportOverwriteWithPrevious();
    expect(exportMocks.exportPdf).not.toHaveBeenCalled();
    expect(exportMocks.exportHtml).toHaveBeenCalledWith({
      includeOutline: true,
      destinationPath: "D:/out/page.html",
    });
    expect(result).toEqual({ path: "D:/out/page.html", format: "html" });
  });
});
