// 导出另存对话框封装测试（透传 save 参数形态 / 取消 null 语义）
import { beforeEach, describe, expect, it, vi } from "vitest";

const { saveMock } = vi.hoisted(() => ({ saveMock: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  // save 为独立具名导出，mock 桩由用例按需覆写返回值
  save: saveMock,
}));

import { exportSaveDialog } from "./export-dialog";

describe("exportSaveDialog", () => {
  beforeEach(() => {
    saveMock.mockReset();
  });

  it("透传标题/默认路径/过滤器给 save（AC-X1 另存对话框形态）", async () => {
    saveMock.mockResolvedValue("D:/out/手册.html");
    const picked = await exportSaveDialog({
      defaultPath: "D:/out/手册.html",
      filterName: "HTML",
      ext: "html",
    });
    expect(picked).toBe("D:/out/手册.html");
    // 参数形态钉死：标题固定"导出"，过滤器单扩展名（不含点）
    expect(saveMock).toHaveBeenCalledWith({
      title: "导出",
      defaultPath: "D:/out/手册.html",
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
  });

  it("用户取消返回 null（调用方静默终止导出）", async () => {
    saveMock.mockResolvedValue(null);
    const picked = await exportSaveDialog({ defaultPath: "x.pdf", filterName: "PDF", ext: "pdf" });
    expect(picked).toBeNull();
  });
});
