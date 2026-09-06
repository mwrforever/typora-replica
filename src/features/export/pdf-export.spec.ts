// PDF 导出编排测试（mock invoke 与管线，AC-X2 前端侧参数组装）
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn(async () => undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invokeMock(...(a as [])),
}));
const buildPdfMock = vi.hoisted(() =>
  vi.fn(async () => ({ document: "<html>PDF 源</html>", title: "手册" })),
);
vi.mock("./html-export", () => ({ buildExportDocumentForPdf: buildPdfMock }));
const saveDialogMock = vi.hoisted(() =>
  vi.fn(async (): Promise<string | null> => "D:/out/手册.pdf"),
);
vi.mock("./export-dialog", () => ({ exportSaveDialog: saveDialogMock }));
vi.mock("./export-location", async (importOriginal) => {
  // 展开 Real 模块：setLastExportDir/getLastExportDirForTest 走真实会话记忆，
  // 仅替换 resolveExportDefaultPath（对话框默认路径锚定既有用例）
  const actual = await importOriginal<typeof import("./export-location")>();
  return {
    ...actual,
    resolveExportDefaultPath: vi.fn((fileName: string) => `D:/out/${fileName}`),
  };
});
const useTabsStoreMock = vi.hoisted(() =>
  vi.fn(() => ({ activeTab: undefined as { path?: string } | undefined })),
);
vi.mock("../tabs/tabs-store", () => ({ useTabsStore: useTabsStoreMock }));
// 导出 store 桩：默认 auto/空串（与未装载时真实初值一致，既有用例依赖）；
// 位置接线用例以 mockReturnValueOnce 改写为 custom（askPdfTarget 动态 import 亦被本桩拦截）
const useExportStoreMock = vi.hoisted(() =>
  vi.fn(() => ({
    locationMode: "auto" as "auto" | "document-dir" | "custom",
    customDir: "",
  })),
);
vi.mock("./export-store", () => ({ useExportStore: useExportStoreMock }));
const recordMock = vi.hoisted(() => vi.fn());
vi.mock("./export-previous", () => ({ recordExportSnapshot: recordMock }));

import {
  getLastExportDirForTest,
  resolveExportDefaultPath,
  setLastExportDir,
} from "./export-location";
import { exportPdf } from "./pdf-export";

describe("exportPdf", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    saveDialogMock.mockClear();
    buildPdfMock.mockClear();
    recordMock.mockClear();
    useTabsStoreMock.mockClear();
    useExportStoreMock.mockClear();
  });

  it("invoke export_pdf 携带 HTML 全文 + A4 打印设置 + 目标路径", async () => {
    const result = await exportPdf({ destinationPath: "D:/out/x.pdf" });
    expect(result?.path).toBe("D:/out/x.pdf");
    expect(result?.format).toBe("pdf");
    expect(invokeMock).toHaveBeenCalledWith("export_pdf", {
      htmlContent: "<html>PDF 源</html>",
      settings: {
        printBackground: true,
        pageWidthIn: expect.closeTo(8.27),
        pageHeightIn: expect.closeTo(11.69),
      },
      outputPath: "D:/out/x.pdf",
    });
  });

  it("页眉页脚/h1 分页模板透传 buildExportDocumentForPdf（@page 组装在管线内）", async () => {
    await exportPdf({
      destinationPath: "D:/out/x.pdf",
      header: "${title}",
      footer: "${pageNo}",
      breakH1: true,
    });
    expect(buildPdfMock).toHaveBeenCalledWith(
      expect.objectContaining({ header: "${title}", footer: "${pageNo}", breakH1: true }),
    );
  });

  it("取消保存对话框时不调用 invoke", async () => {
    saveDialogMock.mockResolvedValueOnce(null);
    const result = await exportPdf();
    expect(result).toBeUndefined();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("invoke 拒绝（string 错误）包装为 ExportError 上抛（AC-X2-5 不静默）", async () => {
    invokeMock.mockRejectedValueOnce("打印管线失败");
    await expect(exportPdf({ destinationPath: "D:/out/x.pdf" })).rejects.toThrow("打印管线失败");
  });

  it("invoke 拒绝（Error 对象）同样包装上抛", async () => {
    invokeMock.mockRejectedValueOnce(new Error("IPC 断开"));
    await expect(exportPdf({ destinationPath: "D:/out/x.pdf" })).rejects.toThrow("IPC 断开");
  });

  it("成功后登记会话快照（X6）", async () => {
    await exportPdf({ destinationPath: "D:/out/x.pdf", header: "h" });
    expect(recordMock).toHaveBeenCalledWith(
      "pdf",
      "D:/out/x.pdf",
      expect.objectContaining({ header: "h" }),
    );
  });

  it("成功落盘后回写会话上次导出目录（X8 auto 未命名回落链）", async () => {
    try {
      // 哨兵预置：回写未发生时断言读到哨兵值，消除既有用例泄漏值造成的误通过窗口（批4-M6）
      setLastExportDir("D:/sentinel");
      await exportPdf({ destinationPath: "D:/out/x.pdf" });
      expect(getLastExportDirForTest()).toBe("D:/out");
    } finally {
      // 会话记忆是模块级状态，用例后清理防泄漏到其他用例
      setLastExportDir(undefined);
    }
  });

  it("invoke 拒绝时不回写会话目录（失败路径不污染回落链）", async () => {
    try {
      // 哨兵预置：失败路径断言记忆保持哨兵原值，钉住「拒绝即不回写」语义（批4-M6）
      setLastExportDir("D:/sentinel");
      invokeMock.mockRejectedValueOnce("打印管线失败");
      await expect(exportPdf({ destinationPath: "D:/out/x.pdf" })).rejects.toThrow("打印管线失败");
      expect(getLastExportDirForTest()).toBe("D:/sentinel");
    } finally {
      setLastExportDir(undefined);
    }
  });

  it("无 destinationPath 时以文档目录为 documentDir 组装对话框默认路径", async () => {
    useTabsStoreMock.mockReturnValueOnce({ activeTab: { path: "D:/docs/手册.md" } });
    await exportPdf();
    expect(vi.mocked(resolveExportDefaultPath)).toHaveBeenCalledWith(
      "手册.pdf",
      { locationMode: "auto", customDir: "" },
      { documentDir: "D:/docs" },
    );
    expect(saveDialogMock).toHaveBeenCalledWith({
      defaultPath: "D:/out/手册.pdf",
      filterName: "PDF",
      ext: "pdf",
    });
  });

  it("AC-X8-1：位置模式接线——locationMode/customDir 读导出 store 传入位置解析", async () => {
    useExportStoreMock.mockReturnValueOnce({ locationMode: "custom", customDir: "D:/custom" });
    await exportPdf();
    expect(vi.mocked(resolveExportDefaultPath)).toHaveBeenCalledWith(
      "手册.pdf",
      { locationMode: "custom", customDir: "D:/custom" },
      { documentDir: undefined },
    );
  });

  it("invoke 拒绝（非 string 非 Error 形态）包装为兜底错误消息上抛", async () => {
    invokeMock.mockRejectedValueOnce(undefined);
    await expect(exportPdf({ destinationPath: "D:/out/x.pdf" })).rejects.toThrow("未知打印错误");
  });

  it("title 非法字符净化进默认文件名；纯空白标题回落 Untitled", async () => {
    buildPdfMock.mockResolvedValueOnce({ document: "<html/>", title: 'a/b\\c:d*e?f"g<h>i|j' });
    await exportPdf();
    expect(saveDialogMock).toHaveBeenLastCalledWith({
      defaultPath: "D:/out/a_b_c_d_e_f_g_h_i_j.pdf",
      filterName: "PDF",
      ext: "pdf",
    });
    buildPdfMock.mockResolvedValueOnce({ document: "<html/>", title: "  " });
    await exportPdf();
    expect(saveDialogMock).toHaveBeenLastCalledWith({
      defaultPath: "D:/out/Untitled.pdf",
      filterName: "PDF",
      ext: "pdf",
    });
  });

  it("未命名文档（路径无目录段）时 documentDir 为 undefined", async () => {
    useTabsStoreMock.mockReturnValueOnce({ activeTab: { path: "手册.md" } });
    await exportPdf();
    expect(vi.mocked(resolveExportDefaultPath)).toHaveBeenCalledWith(
      "手册.pdf",
      { locationMode: "auto", customDir: "" },
      { documentDir: undefined },
    );
  });
});
