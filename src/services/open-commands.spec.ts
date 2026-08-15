// 打开/另存对话框命令层：open/save 插件封装（12 菜单装配消费）
// mock dialog 插件：工厂仅创建箭头函数，mockOpen/mockSave 在用例运行时才被解引用，
// 不触发 vi.mock 工厂的 TDZ 约束（与 settings.spec 的 vi.hoisted 模式同理）
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockOpen = vi.fn();
const mockSave = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...a: unknown[]) => mockOpen(...a),
  save: (...a: unknown[]) => mockSave(...a),
}));

import { openFileDialog, openFolderDialog, saveAsDialog } from "./open-commands";

describe("打开/另存对话框命令层（12 菜单装配消费）", () => {
  beforeEach(() => {
    mockOpen.mockReset();
    mockSave.mockReset();
  });

  it("openFileDialog 过滤 markdown 并返回选中路径", async () => {
    mockOpen.mockResolvedValue("C:/docs/a.md");
    const p = await openFileDialog();
    expect(p).toBe("C:/docs/a.md");
    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        multiple: false,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      }),
    );
  });

  it("openFolderDialog 目录模式", async () => {
    mockOpen.mockResolvedValue("C:/docs");
    const p = await openFolderDialog();
    expect(p).toBe("C:/docs");
    expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({ directory: true }));
  });

  it("用户取消返回 null", async () => {
    mockOpen.mockResolvedValue(null);
    expect(await openFileDialog()).toBeNull();
  });

  it("saveAsDialog 透传默认路径", async () => {
    mockSave.mockResolvedValue("C:/docs/b.md");
    const p = await saveAsDialog("C:/docs/a.md");
    expect(p).toBe("C:/docs/b.md");
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "C:/docs/a.md" }));
  });
});
