import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useFileTreeStore } from "./file-tree-store";
import { listDirDetailed, watchDir } from "../../services/file-io";

vi.mock("../../services/file-io", () => ({
  listDirDetailed: vi.fn(),
  watchDir: vi.fn().mockResolvedValue(undefined),
}));

describe("fileTreeStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("loadDir 拉取白名单条目并构建树、登记 currentDir", async () => {
    vi.mocked(listDirDetailed).mockResolvedValue([
      { path: "C:/d/a.md", name: "a.md", isDir: false, ext: "md" },
      { path: "C:/d/sub", name: "sub", isDir: true, ext: "" },
      { path: "C:/d/sub/b.md", name: "sub/b.md", isDir: false, ext: "md" },
    ]);
    const store = useFileTreeStore();
    await store.loadDir("C:/d");
    expect(store.currentDir).toBe("C:/d");
    expect(store.tree).toHaveLength(2);
    expect(store.tree[0].name).toBe("a.md");
    expect(store.tree[0].path).toBe("C:/d/a.md"); // 完整路径
    expect(store.tree[1].children).toHaveLength(1); // sub 展开后含 b.md
    expect(store.tree[1].children[0].path).toBe("C:/d/sub/b.md");
    expect(listDirDetailed).toHaveBeenCalledWith("C:/d", {
      extFilters: [
        "md",
        "markdown",
        "mdown",
        "mmd",
        "text",
        "txt",
        "rmarkdown",
        "mkd",
        "mdwn",
        "mdtxt",
        "rmd",
        "qmd",
        "mdtext",
        "mdx",
      ],
      hideHidden: true,
      sortBy: "natural",
      direction: "asc",
      groupFolderFirst: true,
    });
  });

  it("watch 事件 300ms 防抖合并刷新", async () => {
    let handler: ((ev: { kind: string; path: string }) => void) | undefined;
    vi.mocked(watchDir).mockImplementation(async (_p: string, cb) => {
      handler = cb;
    });
    vi.mocked(listDirDetailed).mockResolvedValue([]);
    const store = useFileTreeStore();
    await store.loadDir("C:/d");
    expect(store.loading).toBe(false);
    handler?.({ kind: "create", path: "C:/d/x.md" });
    handler?.({ kind: "modify", path: "C:/d/x.md" }); // 防抖窗口内合并
    expect(listDirDetailed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(listDirDetailed).toHaveBeenCalledTimes(2); // 防抖后只重扫一次
  });

  it("toggleSidebar/switchPanel/setSort 状态变更", () => {
    const store = useFileTreeStore();
    expect(store.sidebarVisible).toBe(true);
    store.toggleSidebar();
    expect(store.sidebarVisible).toBe(false);
    store.switchPanel("list");
    expect(store.activePanel).toBe("list");
    store.setSort("mtime", "desc");
    expect(store.sortBy).toBe("mtime");
    expect(store.direction).toBe("desc");
    store.setGroupFolder(false);
    expect(store.groupFolderFirst).toBe(false);
  });

  // 补充用例（简报 3 例之外）：覆盖展开/选中/搜索框/recent 面板与 setSort 无方向分支，
  // 满足 vite.config.ts 阈值组对 file-tree-store.ts 的 100% 要求（Task 4 报告记录）
  it("toggleExpand/select/showSearch/hideSearch、recent 面板与 setSort 无方向参数的状态变更", () => {
    const store = useFileTreeStore();
    store.toggleExpand("sub");
    expect(store.expandedPaths.has("sub")).toBe(true);
    store.toggleExpand("sub");
    expect(store.expandedPaths.has("sub")).toBe(false);
    store.select("C:/d/a.md");
    expect(store.selectedPath).toBe("C:/d/a.md");
    store.switchPanel("recent"); // F9 最近位置面板（Task 10/11 消费契约，计划 Interfaces 四值）
    expect(store.activePanel).toBe("recent");
    store.showSearch();
    expect(store.sidebarVisible).toBe(true);
    expect(store.activePanel).toBe("tree");
    expect(store.searchVisible).toBe(true);
    store.hideSearch();
    expect(store.searchVisible).toBe(false);
    store.setSort("alpha"); // 无方向参数：保留当前方向不变
    expect(store.sortBy).toBe("alpha");
    expect(store.direction).toBe("asc");
  });

  // 补充用例：loadDir 失败路径——保持旧目录/旧树一致、不切换监视（Task 4 审查修复 2）
  it("loadDir 失败时保持旧目录/旧树一致且不建立新目录监视", async () => {
    vi.mocked(listDirDetailed)
      .mockResolvedValueOnce([{ path: "C:/d/a.md", name: "a.md", isDir: false, ext: "md" }])
      .mockRejectedValueOnce(new Error("目录不存在或不可访问"));
    const store = useFileTreeStore();
    await store.loadDir("C:/d");
    expect(store.currentDir).toBe("C:/d");
    // 切换失败：拒绝向上抛出，currentDir/树保持旧值
    await expect(store.loadDir("C:/bad")).rejects.toThrow("目录不存在或不可访问");
    expect(store.currentDir).toBe("C:/d"); // 失败不登记新目录
    expect(store.tree).toHaveLength(1); // 树保持旧数据
    expect(store.loading).toBe(false); // loading 恢复
    expect(watchDir).toHaveBeenCalledTimes(1); // 失败目录不建立监视
  });
});
