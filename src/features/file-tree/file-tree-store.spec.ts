import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useFileTreeStore } from "./file-tree-store";
import { listDirDetailed, watchDir, unwatchDir } from "../../services/file-io";

vi.mock("../../services/file-io", () => ({
  listDirDetailed: vi.fn(),
  watchDir: vi.fn().mockResolvedValue(undefined),
  unwatchDir: vi.fn().mockResolvedValue(undefined),
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
    // Rust 侧按合并窗口批量回调（WatchEvent[]，BUG-14 契约）
    let handler: ((evs: { kind: string; path: string }[]) => void) | undefined;
    vi.mocked(watchDir).mockImplementation(async (_p: string, cb) => {
      handler = cb;
    });
    vi.mocked(listDirDetailed).mockResolvedValue([]);
    const store = useFileTreeStore();
    await store.loadDir("C:/d");
    expect(store.loading).toBe(false);
    handler?.([{ kind: "create", path: "C:/d/x.md" }]);
    handler?.([{ kind: "modify", path: "C:/d/x.md" }]); // 防抖窗口内合并
    expect(listDirDetailed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(listDirDetailed).toHaveBeenCalledTimes(2); // 防抖后只重扫一次
  });

  // AC-F5-3：手动 Refresh 兜底——绕过防抖窗口强制重扫当前目录，
  // watch 事件流之外的用户显式操作路径（简报 Task 9 用例逐字）
  it("手动 refresh 强制重扫（AC-F5-3）", async () => {
    vi.mocked(listDirDetailed).mockResolvedValue([]);
    const store = useFileTreeStore();
    await store.loadDir("C:/d");
    // 外部目录变更（如手动保存新文件）后 mock 返回值变化，refresh 应拉取最新数据
    vi.mocked(listDirDetailed).mockResolvedValue([
      { path: "C:/d/new.md", name: "new.md", isDir: false, ext: "md" },
    ]);
    await store.refresh();
    expect(store.tree).toHaveLength(1);
    expect(listDirDetailed).toHaveBeenCalledTimes(2);
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

  // 简报 Task 12 用例逐字：全局搜索入口（F12）行为锁定——搜索框显示 + 侧栏隐藏时展开 + Outline 面板自动切文件树
  it("showSearch 展开侧栏并切到文件树面板（AC-F12-1/2/3）", () => {
    const store = useFileTreeStore();
    store.toggleSidebar(); // 先隐藏侧栏
    store.switchPanel("outline"); // 再切到大纲面板
    store.showSearch();
    expect(store.sidebarVisible).toBe(true); // 侧栏隐藏时展开（AC-F12-3）
    expect(store.activePanel).toBe("tree"); // Outline 面板自动切文件树（AC-F12-2）
    expect(store.searchVisible).toBe(true); // 搜索框显示（AC-F12-1）
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

  it("loadDir 并发：后发起者胜出，过期结果丢弃且只订阅胜出目录（P3-2 代次守卫）", async () => {
    // 第一个 loadDir（A）挂起，第二个 loadDir（B）先完成——A 的过期结果必须被丢弃
    let resolveA!: (v: { path: string; name: string; isDir: boolean; ext: string }[]) => void;
    vi.mocked(listDirDetailed)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveA = resolve)))
      .mockResolvedValue([{ path: "C:/b/x.md", name: "x.md", isDir: false, ext: "md" }]);
    const store = useFileTreeStore();
    const pA = store.loadDir("C:/a");
    const pB = store.loadDir("C:/b");
    await pB; // B 完成：currentDir=B、订阅 B
    expect(store.currentDir).toBe("C:/b");
    // A 的 listDir 晚完成：代次守卫丢弃过期结果（不覆盖 B、不订阅 A）
    resolveA([{ path: "C:/a/old.md", name: "old.md", isDir: false, ext: "md" }]);
    await pA;
    expect(store.currentDir).toBe("C:/b");
    expect(store.tree.map((n) => n.path)).toEqual(["C:/b/x.md"]);
    expect(store.loading).toBe(false);
    expect(watchDir).toHaveBeenCalledTimes(1); // 仅胜出目录订阅一次
    expect(watchDir).toHaveBeenCalledWith("C:/b", expect.any(Function));
  });

  // D2 多槽语义：目录切换须先 unwatch 旧目录再订阅新目录（Rust 侧按路径多槽，
  // 不再自动替换——旧槽不显式停止会残留）；unwatch 失败不阻断主链路（P3-3 语义保持）
  it("切换目录先 unwatch 旧目录，unwatch 失败不阻断订阅", async () => {
    vi.mocked(listDirDetailed).mockResolvedValue([]);
    // 首次 unwatch 失败（如 invoke 拒绝）：仍须完成新目录订阅与登记
    vi.mocked(unwatchDir).mockRejectedValueOnce(new Error("停止监视失败"));
    const store = useFileTreeStore();
    await store.loadDir("C:/a");
    expect(store.watchedDir).toBe("C:/a");
    await store.loadDir("C:/b");
    // unwatch 旧目录先于订阅新目录
    expect(unwatchDir).toHaveBeenCalledWith("C:/a");
    const unwatchOrder = vi.mocked(unwatchDir).mock.invocationCallOrder[0];
    const watchOrder = vi.mocked(watchDir).mock.invocationCallOrder[1];
    expect(unwatchOrder).toBeLessThan(watchOrder);
    // unwatch 失败不阻断：新目录照常订阅并登记
    expect(store.watchedDir).toBe("C:/b");
    expect(watchDir).toHaveBeenCalledWith("C:/b", expect.any(Function));
  });

  it("watchDir 订阅失败：目录数据可用、watchedDir 不登记、下次同目录重试（P3-3 自愈）", async () => {
    vi.mocked(listDirDetailed).mockResolvedValue([
      { path: "C:/d/a.md", name: "a.md", isDir: false, ext: "md" },
    ]);
    vi.mocked(watchDir).mockRejectedValueOnce(new Error("注册监视目录失败"));
    const store = useFileTreeStore();
    await store.loadDir("C:/d");
    // 订阅失败不阻断加载链路：currentDir/树已更新（仅自动刷新暂缺）
    expect(store.currentDir).toBe("C:/d");
    expect(store.tree).toHaveLength(1);
    // 失败不登记 watchedDir：同目录再次 loadDir 会重试订阅（自愈，不永久静默失效）
    expect(store.watchedDir).toBeUndefined();
    await store.loadDir("C:/d");
    expect(watchDir).toHaveBeenCalledTimes(2);
    expect(store.watchedDir).toBe("C:/d");
  });

  it("watchDir 订阅期间被更新的 loadDir 取代：不登记过期代 watchedDir（P3-2 守卫延伸）", async () => {
    // B 的订阅挂起期间 C 完成：B 的订阅结果不得把 watchedDir 漂移回旧目录
    let resolveWatchB!: () => void;
    vi.mocked(listDirDetailed)
      .mockResolvedValueOnce([{ path: "C:/b/x.md", name: "x.md", isDir: false, ext: "md" }])
      .mockResolvedValueOnce([{ path: "C:/c/y.md", name: "y.md", isDir: false, ext: "md" }]);
    vi.mocked(watchDir)
      .mockImplementationOnce(() => new Promise<void>((resolve) => (resolveWatchB = resolve)))
      .mockResolvedValue(undefined);
    const store = useFileTreeStore();
    const pB = store.loadDir("C:/b");
    await Promise.resolve(); // B 已发起订阅（挂起）
    const pC = store.loadDir("C:/c");
    await pC; // C 完成：watchedDir=C
    expect(store.currentDir).toBe("C:/c");
    expect(store.watchedDir).toBe("C:/c");
    // B 的订阅晚完成：代次守卫阻止登记（watchedDir 保持 C）
    resolveWatchB();
    await pB;
    expect(store.watchedDir).toBe("C:/c");
    expect(watchDir).toHaveBeenCalledTimes(2);
  });
});
