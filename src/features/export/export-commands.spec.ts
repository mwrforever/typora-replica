// 导出菜单装配接口与命令单一入口测试（X7 装配面 + runExport 选项汇合）
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// 导出管线与重复导出命令全部打桩：runExport 的分派与选项合并是本模块被测行为
const exportMocks = vi.hoisted(() => ({
  exportHtml: vi.fn(),
  exportPlainHtml: vi.fn(),
  exportPdf: vi.fn(),
  exportWithPrevious: vi.fn(),
  exportOverwriteWithPrevious: vi.fn(),
}));
vi.mock("./html-export", () => ({
  exportHtml: exportMocks.exportHtml,
  exportPlainHtml: exportMocks.exportPlainHtml,
}));
vi.mock("./pdf-export", () => ({
  exportPdf: exportMocks.exportPdf,
}));
vi.mock("./export-previous", () => ({
  exportWithPrevious: exportMocks.exportWithPrevious,
  exportOverwriteWithPrevious: exportMocks.exportOverwriteWithPrevious,
}));

import { getExportMenuEntries, runExport } from "./export-commands";
import { useExportStore } from "./export-store";

describe("export-commands（X7 装配面）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    exportMocks.exportHtml.mockReset();
    exportMocks.exportPlainHtml.mockReset();
    exportMocks.exportPdf.mockReset();
    exportMocks.exportWithPrevious.mockReset();
    exportMocks.exportOverwriteWithPrevious.mockReset();
  });

  it("装配列表 id 序 = 4 内置格式项 + 末尾两重复导出项（分隔线语义归渲染层）", () => {
    expect(getExportMenuEntries().map((e) => e.id)).toEqual([
      "pdf",
      "html",
      "html-plain",
      "image",
      "export-with-previous",
      "overwrite-with-previous",
    ]);
  });

  it("AC-X7-1：新增导出项后装配列表实时包含（每次调用实时重算 store）", () => {
    const store = useExportStore();
    store.addItem("归档格式");
    const labels = getExportMenuEntries().map((e) => e.label);
    expect(labels).toContain("归档格式");
  });

  it("Image 占位项不可用（X4 首版禁用）", () => {
    const image = getExportMenuEntries().find((e) => e.id === "image");
    expect(image?.enabled).toBe(false);
  });

  it("pdf/html/html-plain 格式项分派到对应导出函数（各恰好一次）", async () => {
    await runExport("pdf");
    await runExport("html");
    await runExport("html-plain");
    expect(exportMocks.exportPdf).toHaveBeenCalledTimes(1);
    expect(exportMocks.exportHtml).toHaveBeenCalledTimes(1);
    expect(exportMocks.exportPlainHtml).toHaveBeenCalledTimes(1);
  });

  it("C3 选项汇合：store 非默认选项合并进导出选项（HTML 大纲 + PDF 页眉页脚 h1 分页）", async () => {
    const store = useExportStore();
    store.includeOutline = true;
    store.pdfHeader = "第 ${pageNo} 页";
    store.pdfFooter = "${title}";
    store.pdfPageBreakH1 = true;
    await runExport("html");
    await runExport("pdf");
    expect(exportMocks.exportHtml).toHaveBeenCalledWith({ includeOutline: true });
    // PDF 选项只汇合页眉页脚/h1 分页（大纲是 HTML 专属选项，不入 PDF 管线）
    expect(exportMocks.exportPdf).toHaveBeenCalledWith({
      header: "第 ${pageNo} 页",
      footer: "${title}",
      breakH1: true,
    });
  });

  it("空选项纯净：默认 store 下 HTML 导出收到空对象（不携带缺省键）", async () => {
    await runExport("html");
    const arg = exportMocks.exportHtml.mock.calls[0]?.[0];
    expect(Object.keys(arg ?? {})).toHaveLength(0);
  });

  it("装配条目的 run 绑定单一入口（菜单点击经 runExport 分派并汇合 store 选项）", async () => {
    const store = useExportStore();
    store.pdfHeader = "${title}";
    const pdfEntry = getExportMenuEntries().find((e) => e.id === "pdf");
    await pdfEntry?.run();
    expect(exportMocks.exportPdf).toHaveBeenCalledWith({ header: "${title}" });
  });

  it("X6 两命令经固定 id 分派到 export-previous 对应函数", async () => {
    await runExport("export-with-previous");
    await runExport("overwrite-with-previous");
    expect(exportMocks.exportWithPrevious).toHaveBeenCalledTimes(1);
    expect(exportMocks.exportOverwriteWithPrevious).toHaveBeenCalledTimes(1);
  });

  it("未知格式 id（X5 自定义占位）静默返回 undefined 不报错", async () => {
    await expect(runExport("pandoc")).resolves.toBeUndefined();
  });

  it("导出管线失败时错误上抛（由调用方呈现，不静默吞掉）", async () => {
    exportMocks.exportPdf.mockRejectedValue(new Error("PDF 导出失败"));
    await expect(runExport("pdf")).rejects.toThrow("PDF 导出失败");
  });
});
