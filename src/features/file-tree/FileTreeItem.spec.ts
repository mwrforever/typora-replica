// 文件树递归节点组件测试（03 文件树，F7 拖拽数据源契约）
//
// 覆盖：dragstart 向 dataTransfer 写入完整路径（text/plain 与
// application/x-markwell-path 双 mime 键）——App.vue 编辑器 drop 消费的数据源。
// 组件内部使用 store（展开/选中态），mount 前须激活 Pinia；服务层已 mock。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import FileTreeItem from "./FileTreeItem.vue";

// mock 服务层：组件仅依赖 store 状态，不触达 invoke
vi.mock("../../services/file-io", () => ({
  listDirDetailed: vi.fn().mockResolvedValue([]),
  watchDir: vi.fn().mockResolvedValue(undefined),
}));

describe("FileTreeItem", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("拖拽携带完整路径（F7 数据源）", async () => {
    const wrapper = mount(FileTreeItem, {
      props: {
        node: {
          path: "C:/d/sub/x.md",
          relPath: "sub/x.md",
          name: "x.md",
          isDir: false,
          ext: "md",
          children: [],
        },
        depth: 1,
      },
    });
    const dt = { setData: vi.fn() } as unknown as DataTransfer;
    await wrapper.find(".file-tree-item").trigger("dragstart", { dataTransfer: dt });
    expect(dt.setData).toHaveBeenCalledWith("text/plain", "C:/d/sub/x.md");
    expect(dt.setData).toHaveBeenCalledWith("application/x-markwell-path", "C:/d/sub/x.md");
  });
});
