// 文件树右键菜单组件测试（03 文件树，F4 十二项动作 + 新建/重命名内联输入）
//
// 覆盖：十二项渲染与新窗口/撤销 disabled / 新建文件内联输入（非法字符/合法回车）/
// 新建文件夹 / 重命名预填与提交 / Esc 取消 / Duplicate 命名与冲突 -1 / 删除回收站与刷新 /
// 复制路径 / 在资源管理器中显示 / 搜索 / 最近位置 / 空白处 currentDir 兜底 / 失败提示。
// 服务层 file-io 与 opener 插件均 mock，仅验证组件契约（Rust 错误消息透传由父组件统一处理）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import FileTreeMenu from "./FileTreeMenu.vue";
import { useFileTreeStore } from "./file-tree-store";
import * as fileIo from "../../services/file-io";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

vi.mock("../../services/file-io", () => ({
  createFile: vi.fn().mockResolvedValue(undefined),
  createDir: vi.fn().mockResolvedValue(undefined),
  renamePath: vi.fn().mockResolvedValue(undefined),
  duplicatePath: vi.fn().mockResolvedValue(undefined),
  deleteToTrash: vi.fn().mockResolvedValue(undefined),
  listDirDetailed: vi.fn().mockResolvedValue([]),
  watchDir: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
}));

describe("FileTreeMenu", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    // 清空跨用例的 mock 调用记录，保证 not.toHaveBeenCalled 断言不受用例顺序影响
    vi.clearAllMocks();
  });

  it("渲染 12 项且新窗口/撤销 disabled", () => {
    const wrapper = mount(FileTreeMenu, {
      props: { visible: true, x: 10, y: 10, targetPath: "C:/d/a.md" },
    });
    const items = wrapper.findAll(".file-tree-menu__item");
    expect(items.length).toBe(12);
    expect(wrapper.find('[data-menu="new-window"]').attributes("disabled")).toBeDefined();
    expect(wrapper.find('[data-menu="undo"]').attributes("disabled")).toBeDefined();
  });

  it("新建文件内联输入：非法字符提示不创建，合法回车创建", async () => {
    const store = useFileTreeStore();
    store.entries = [];
    const wrapper = mount(FileTreeMenu, {
      props: { visible: true, x: 10, y: 10, targetPath: "C:/d" },
    });
    await wrapper.find('[data-menu="new-file"]').trigger("click");
    const input = wrapper.find(".file-tree-menu__inline input");
    await input.setValue("bad?name.md");
    await input.trigger("keydown", { key: "Enter" });
    expect(fileIo.createFile).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("非法字符");
    await input.setValue("good.md");
    await input.trigger("keydown", { key: "Enter" });
    expect(fileIo.createFile).toHaveBeenCalledWith("C:/d/good.md");
  });

  it("Duplicate 调用 duplicateTargetName 命名（冲突判断基于 entries）", async () => {
    const store = useFileTreeStore();
    store.entries = [
      { path: "C:/d/readme.md", name: "readme.md", isDir: false, ext: "md" },
      { path: "C:/d/readme copy.md", name: "readme copy.md", isDir: false, ext: "md" },
    ];
    const wrapper = mount(FileTreeMenu, {
      props: { visible: true, x: 10, y: 10, targetPath: "C:/d/readme.md" },
    });
    await wrapper.find('[data-menu="duplicate"]').trigger("click");
    expect(fileIo.duplicatePath).toHaveBeenCalledWith("C:/d/readme.md", "C:/d/readme copy-1.md");
  });

  it("删除调用 deleteToTrash 并请求刷新", async () => {
    const wrapper = mount(FileTreeMenu, {
      props: { visible: true, x: 10, y: 10, targetPath: "C:/d/a.md" },
    });
    await wrapper.find('[data-menu="delete"]').trigger("click");
    expect(fileIo.deleteToTrash).toHaveBeenCalledWith("C:/d/a.md");
    expect(wrapper.emitted("refresh")).toBeTruthy();
  });

  it("打开动作透传 targetPath 并关闭菜单", async () => {
    const wrapper = mount(FileTreeMenu, {
      props: { visible: true, x: 10, y: 10, targetPath: "C:/d/a.md" },
    });
    await wrapper.find('[data-menu="open"]').trigger("click");
    expect(wrapper.emitted("open")?.[0]).toEqual(["C:/d/a.md"]);
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("新建文件夹内联输入：Enter 创建目录并请求刷新", async () => {
    const store = useFileTreeStore();
    store.entries = [];
    const wrapper = mount(FileTreeMenu, {
      props: { visible: true, x: 10, y: 10, targetPath: "C:/d" },
    });
    await wrapper.find('[data-menu="new-dir"]').trigger("click");
    await wrapper.find(".file-tree-menu__inline input").setValue("sub");
    await wrapper.find(".file-tree-menu__inline input").trigger("keydown", { key: "Enter" });
    expect(fileIo.createDir).toHaveBeenCalledWith("C:/d/sub");
    expect(wrapper.emitted("refresh")).toBeTruthy();
  });

  it("重命名内联输入：预填当前文件名，Enter 提交 renamePath", async () => {
    const wrapper = mount(FileTreeMenu, {
      props: { visible: true, x: 10, y: 10, targetPath: "C:/d/a.md" },
    });
    await wrapper.find('[data-menu="rename"]').trigger("click");
    const input = wrapper.find(".file-tree-menu__inline input");
    expect((input.element as HTMLInputElement).value).toBe("a.md");
    await input.setValue("b.md");
    await input.trigger("keydown", { key: "Enter" });
    expect(fileIo.renamePath).toHaveBeenCalledWith("C:/d/a.md", "C:/d/b.md");
    expect(wrapper.emitted("refresh")).toBeTruthy();
  });

  it("Esc 取消内联输入：不创建且输入框消失", async () => {
    const wrapper = mount(FileTreeMenu, {
      props: { visible: true, x: 10, y: 10, targetPath: "C:/d" },
    });
    await wrapper.find('[data-menu="new-file"]').trigger("click");
    const input = wrapper.find(".file-tree-menu__inline input");
    await input.setValue("x.md");
    await input.trigger("keydown", { key: "Escape" });
    expect(fileIo.createFile).not.toHaveBeenCalled();
    expect(wrapper.find(".file-tree-menu__inline").exists()).toBe(false);
  });

  it("复制路径写入剪贴板并关闭", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const wrapper = mount(FileTreeMenu, {
      props: { visible: true, x: 10, y: 10, targetPath: "C:/d/a.md" },
    });
    await wrapper.find('[data-menu="copy-path"]').trigger("click");
    expect(writeText).toHaveBeenCalledWith("C:/d/a.md");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("在资源管理器中显示调用 revealItemInDir", async () => {
    const wrapper = mount(FileTreeMenu, {
      props: { visible: true, x: 10, y: 10, targetPath: "C:/d/a.md" },
    });
    await wrapper.find('[data-menu="reveal"]').trigger("click");
    expect(revealItemInDir).toHaveBeenCalledWith("C:/d/a.md");
  });

  it("搜索：展开侧栏切文件树面板并显示搜索框", async () => {
    const store = useFileTreeStore();
    store.sidebarVisible = false;
    const wrapper = mount(FileTreeMenu, { props: { visible: true, x: 10, y: 10, targetPath: "" } });
    await wrapper.find('[data-menu="search"]').trigger("click");
    expect(store.sidebarVisible).toBe(true);
    expect(store.activePanel).toBe("tree");
    expect(store.searchVisible).toBe(true);
  });

  it("最近位置切换到 recent 面板", async () => {
    const store = useFileTreeStore();
    const wrapper = mount(FileTreeMenu, { props: { visible: true, x: 10, y: 10, targetPath: "" } });
    await wrapper.find('[data-menu="recent"]').trigger("click");
    expect(store.activePanel).toBe("recent");
  });

  it("空白处（空 targetPath）新建文件：用 store.currentDir 兜底", async () => {
    const store = useFileTreeStore();
    store.entries = [];
    store.currentDir = "C:/root";
    const wrapper = mount(FileTreeMenu, { props: { visible: true, x: 10, y: 10, targetPath: "" } });
    await wrapper.find('[data-menu="new-file"]').trigger("click");
    await wrapper.find(".file-tree-menu__inline input").setValue("n.md");
    await wrapper.find(".file-tree-menu__inline input").trigger("keydown", { key: "Enter" });
    expect(fileIo.createFile).toHaveBeenCalledWith("C:/root/n.md");
  });

  it("内联创建失败：提示错误且不关闭菜单", async () => {
    vi.mocked(fileIo.createFile).mockRejectedValueOnce(new Error("exists"));
    const store = useFileTreeStore();
    store.entries = [];
    const wrapper = mount(FileTreeMenu, {
      props: { visible: true, x: 10, y: 10, targetPath: "C:/d" },
    });
    await wrapper.find('[data-menu="new-file"]').trigger("click");
    await wrapper.find(".file-tree-menu__inline input").setValue("dup.md");
    await wrapper.find(".file-tree-menu__inline input").trigger("keydown", { key: "Enter" });
    expect(wrapper.text()).toContain("创建/重命名失败");
    expect(wrapper.emitted("close")).toBeFalsy();
  });

  it("Duplicate 常规命名并请求刷新", async () => {
    const store = useFileTreeStore();
    store.entries = [];
    const wrapper = mount(FileTreeMenu, {
      props: { visible: true, x: 10, y: 10, targetPath: "C:/d/a.md" },
    });
    await wrapper.find('[data-menu="duplicate"]').trigger("click");
    expect(fileIo.duplicatePath).toHaveBeenCalledWith("C:/d/a.md", "C:/d/a copy.md");
    expect(wrapper.emitted("refresh")).toBeTruthy();
  });

  it("Duplicate 失败：静默处理并仍请求刷新", async () => {
    vi.mocked(fileIo.duplicatePath).mockRejectedValueOnce(new Error("io"));
    const store = useFileTreeStore();
    store.entries = [];
    const wrapper = mount(FileTreeMenu, {
      props: { visible: true, x: 10, y: 10, targetPath: "C:/d/a.md" },
    });
    await wrapper.find('[data-menu="duplicate"]').trigger("click");
    expect(wrapper.emitted("refresh")).toBeTruthy();
  });

  it("删除失败：静默处理并仍请求刷新", async () => {
    vi.mocked(fileIo.deleteToTrash).mockRejectedValueOnce(new Error("io"));
    const wrapper = mount(FileTreeMenu, {
      props: { visible: true, x: 10, y: 10, targetPath: "C:/d/a.md" },
    });
    await wrapper.find('[data-menu="delete"]').trigger("click");
    expect(wrapper.emitted("refresh")).toBeTruthy();
  });

  it("visible=false 时不渲染菜单", () => {
    const wrapper = mount(FileTreeMenu, { props: { visible: false, x: 0, y: 0, targetPath: "" } });
    expect(wrapper.find(".file-tree-menu").exists()).toBe(false);
  });
});
