// 文件树面板组件测试（03 文件树，F3 渲染层）
//
// 覆盖：树节点渲染与名称展示 / 目录默认折叠点击展开 / 点击文件 emit open-file /
// 空态提示。数据直接注入 store.tree，不触达 invoke（file-io 已 mock）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import FileTreePanel from "./FileTreePanel.vue";
import { useFileTreeStore } from "./file-tree-store";

// mock 服务层：面板组件不触达 invoke
vi.mock("../../services/file-io", () => ({
  listDirDetailed: vi.fn().mockResolvedValue([]),
  watchDir: vi.fn().mockResolvedValue(undefined),
}));

describe("FileTreePanel", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("渲染树节点并展示名称", async () => {
    const store = useFileTreeStore();
    store.tree = [
      { path: "C:/d/a.md", relPath: "a.md", name: "a.md", isDir: false, ext: "md", children: [] },
      {
        path: "C:/d/sub",
        relPath: "sub",
        name: "sub",
        isDir: true,
        ext: "",
        children: [
          {
            path: "C:/d/sub/b.md",
            relPath: "sub/b.md",
            name: "b.md",
            isDir: false,
            ext: "md",
            children: [],
          },
        ],
      },
    ];
    const wrapper = mount(FileTreePanel);
    expect(wrapper.text()).toContain("a.md");
    expect(wrapper.text()).toContain("sub");
    // 目录默认折叠：子节点 b.md 不渲染（未展开）
    expect(wrapper.text()).not.toContain("b.md");
  });

  it("点击目录展开子节点，点击文件 emit open-file", async () => {
    const store = useFileTreeStore();
    // 注意：文件置于目录之前——find(".file-tree-item--file") 取首个匹配，
    // 展开 sub 后 DOM 顺序为 sub/b.md/a.md，若 sub 在前则首个文件匹配到 b.md
    store.tree = [
      { path: "C:/d/a.md", relPath: "a.md", name: "a.md", isDir: false, ext: "md", children: [] },
      {
        path: "C:/d/sub",
        relPath: "sub",
        name: "sub",
        isDir: true,
        ext: "",
        children: [
          {
            path: "C:/d/sub/b.md",
            relPath: "sub/b.md",
            name: "b.md",
            isDir: false,
            ext: "md",
            children: [],
          },
        ],
      },
    ];
    const wrapper = mount(FileTreePanel);
    await wrapper.find(".file-tree-item--dir").trigger("click");
    expect(wrapper.text()).toContain("b.md"); // 展开后渲染子节点
    await wrapper.find(".file-tree-item--file").trigger("click");
    expect(wrapper.emitted("open-file")?.[0]).toEqual(["C:/d/a.md"]);
  });

  it("空态提示（目录无受支持文件）", () => {
    const wrapper = mount(FileTreePanel);
    expect(wrapper.text()).toContain("空");
  });
});
