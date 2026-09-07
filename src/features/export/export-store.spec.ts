// 导出项管理 store 测试（AC-X7-1 新增生效 / AC-X7-2 内置锁定 / 持久化接线）
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("../../services/settings", () => ({
  loadSettings: vi.fn(async () => ({
    export: {
      locationMode: "custom",
      customDir: "D:/c",
      includeOutline: true,
      pdfHeader: "h",
      pdfFooter: "f",
      pdfPageBreakH1: true,
    },
  })),
  updateSettings: vi.fn(async () => undefined),
}));

import { useExportStore } from "./export-store";
import { loadSettings, updateSettings } from "../../services/settings";

describe("useExportStore 导出项管理", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("初始内置 4 项（PDF/HTML/HTML 无样式/Image），Image 占位禁用", () => {
    const store = useExportStore();
    expect(store.items.map((i) => i.id)).toEqual(["pdf", "html", "html-plain", "image"]);
    expect(store.items.find((i) => i.id === "image")?.enabled).toBe(false);
    expect(store.items.every((i) => i.builtin)).toBe(true);
  });

  it("AC-X7-1 新增自定义导出项出现在列表尾（Export 菜单数据源）", () => {
    const store = useExportStore();
    store.addItem("我的归档格式");
    expect(store.items.at(-1)?.label).toBe("我的归档格式");
    expect(store.items.at(-1)?.builtin).toBe(false);
    expect(store.items.at(-1)?.enabled).toBe(true);
  });

  it("AC-X7-2 删除内置项被拒绝（锁定，列表不变）", () => {
    const store = useExportStore();
    expect(() => store.removeItem("pdf")).toThrow("内置导出项不可删除");
    expect(store.items.some((i) => i.id === "pdf")).toBe(true);
  });

  it("删除自定义项生效", () => {
    const store = useExportStore();
    store.addItem("临时项");
    const id = store.items.at(-1)!.id;
    store.removeItem(id);
    expect(store.items.some((i) => i.id === id)).toBe(false);
  });

  it("改名：内置拒绝 / 自定义生效", () => {
    const store = useExportStore();
    expect(() => store.renameItem("html", "新名")).toThrow("内置导出项不可改名");
    store.addItem("旧名");
    const id = store.items.at(-1)!.id;
    store.renameItem(id, "新名");
    expect(store.items.find((i) => i.id === id)?.label).toBe("新名");
  });

  it("改序：move 到合法位置生效（自定义项可移至首位）", () => {
    const store = useExportStore();
    store.addItem("自定义");
    const customId = store.items.at(-1)!.id;
    store.moveItem(customId, 0);
    expect(store.items[0]!.id).toBe(customId);
  });

  it("改序：越界目标位置收敛到合法区间（负数→首位，超上界→末位）", () => {
    const store = useExportStore();
    store.moveItem("pdf", -5);
    expect(store.items[0]!.id).toBe("pdf");
    store.moveItem("pdf", 99);
    expect(store.items.at(-1)?.id).toBe("pdf");
  });

  it("id 不存在时增删改均安全无操作（列表保持不变）", () => {
    const store = useExportStore();
    const idsBefore = store.items.map((i) => i.id);
    store.moveItem("not-exist", 0);
    store.removeItem("not-exist");
    store.renameItem("not-exist", "任意");
    expect(store.items.map((i) => i.id)).toEqual(idsBefore);
  });

  it("HTML/PDF 选项默认值与读写（这些值经 runExport 进入导出管线）", () => {
    const store = useExportStore();
    expect(store.includeOutline).toBe(false);
    expect(store.pdfHeader).toBe("");
    expect(store.pdfFooter).toBe("");
    expect(store.pdfPageBreakH1).toBe(false);
    expect(store.locationMode).toBe("auto");
    expect(store.customDir).toBe("");
    store.includeOutline = true;
    store.pdfHeader = "${title}";
    store.pdfPageBreakH1 = true;
    expect(store.includeOutline).toBe(true);
    expect(store.pdfHeader).toBe("${title}");
  });
});

describe("useExportStore 持久化接线", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("loadFromSettings 从持久化设置装载选项", async () => {
    const store = useExportStore();
    await store.loadFromSettings();
    expect(loadSettings).toHaveBeenCalledOnce();
    expect(store.locationMode).toBe("custom");
    expect(store.customDir).toBe("D:/c");
    expect(store.includeOutline).toBe(true);
    expect(store.pdfHeader).toBe("h");
    expect(store.pdfFooter).toBe("f");
    expect(store.pdfPageBreakH1).toBe(true);
  });

  it("persistSettings 把当前选项写回持久化", async () => {
    const store = useExportStore();
    store.includeOutline = true;
    store.pdfHeader = "T";
    await store.persistSettings();
    expect(updateSettings).toHaveBeenCalledWith({
      export: expect.objectContaining({ includeOutline: true, pdfHeader: "T" }),
    });
  });
});
