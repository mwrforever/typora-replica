// 文件树状态（03 文件树，F2-F12 共享 UI 状态）
//
// 单一职责：侧栏可见性/面板切换/当前目录与树数据/排序状态/选中与展开集合。
// 数据源：listDirDetailed（Rust 侧完成白名单过滤/隐藏过滤/排序）——store 不做
// 二次过滤，仅按 name 的 / 层级组装树结构。
// 自动刷新：watchDir 事件流 + 300ms 防抖（spec §3），手动 refresh 强制重扫。
// 线程安全：Pinia store 单实例，全部状态变更走 action（Vue 响应式）。
import { defineStore } from "pinia";
import { listDirDetailed, watchDir, type DirEntry } from "../../services/file-io";
import { SUPPORTED_TEXT_EXTENSIONS, buildTree, type TreeNode } from "./tree-utils";

export type PanelKey = "outline" | "list" | "tree" | "recent";
export type SortBy = "alpha" | "natural" | "mtime" | "ctime";

/** 防抖窗口（spec §3：目录变更事件防抖如 300ms） */
const WATCH_DEBOUNCE_MS = 300;

export const useFileTreeStore = defineStore("fileTree", {
  state: () => ({
    /** 侧栏当前目录（02 DocumentSession.currentDir 的镜像，loadDir 时同步） */
    currentDir: undefined as string | undefined,
    /** 树数据（已按白名单/隐藏/排序，Rust 侧完成） */
    tree: [] as TreeNode[],
    /** 扁平条目缓存（文件列表面板复用） */
    entries: [] as DirEntry[],
    /** 选中条目路径 */
    selectedPath: undefined as string | undefined,
    /** 展开目录集合（TreeNode.relPath，树内稳定标识） */
    expandedPaths: new Set<string>(),
    /** 排序键（缺省自然序） */
    sortBy: "natural" as SortBy,
    /** 排序方向（缺省升序） */
    direction: "asc" as "asc" | "desc",
    /** Group by Folder（默认开，AC-F6-1） */
    groupFolderFirst: true,
    /** 侧栏可见（默认展开） */
    sidebarVisible: true,
    /** 当前面板：大纲占位/文件列表/文件树/最近位置（F9 菜单进入，非快捷键面板） */
    activePanel: "tree" as PanelKey,
    /** 全局搜索框可见（F12 入口，搜索逻辑归 06） */
    searchVisible: false,
    /** 加载中（首屏/刷新） */
    loading: false,
    /** watch 防抖定时器句柄 */
    refreshTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    /** watch 当前目录（避免重复订阅同一目录） */
    watchedDir: undefined as string | undefined,
    /** loadDir 代次序号（P3-2：并发加载时后发起者胜出，过期结果丢弃） */
    loadSeq: 0,
  }),

  actions: {
    /** 加载目录（F1-1/2：选择文件夹/打开文件父目录进入侧栏） */
    async loadDir(dir: string): Promise<void> {
      // 代次守卫：本次请求序号——await 期间被更新的 loadDir 取代时让位，
      // 防止「后完成者覆盖后发起者」导致 currentDir/tree 与编辑器目录漂移
      const seq = ++this.loadSeq;
      this.loading = true;
      try {
        const entries = await listDirDetailed(dir, {
          extFilters: [...SUPPORTED_TEXT_EXTENSIONS],
          hideHidden: true,
          sortBy: this.sortBy,
          direction: this.direction,
          groupFolderFirst: this.groupFolderFirst,
        });
        // 过期结果（等待期间已有更新的 loadDir）：丢弃，不覆盖新目录数据
        if (seq !== this.loadSeq) return;
        // 拉取成功后才登记目录并更新数据：失败时保持旧目录/旧树一致，
        // 避免 currentDir 已指向新目录而 tree/entries 仍是旧数据的漂移态
        this.currentDir = dir;
        this.entries = entries;
        this.tree = buildTree(entries, dir);
        // 目录切换后重新订阅监视（Rust 侧替换旧监视）；仅成功路径切换，
        // 失败不破坏旧目录的既有监视
        if (this.watchedDir !== dir) {
          try {
            await watchDir(dir, () => this.scheduleRefresh());
            // 订阅成功才登记 watchedDir；订阅期间被更新的 loadDir 取代
            // 则不登记本代（防 watchedDir 漂移回旧目录）
            if (seq === this.loadSeq) this.watchedDir = dir;
          } catch {
            // P3-3：watch_dir 拒绝（invoke 失败）时保持 watchedDir 旧值——
            // 同目录下次 loadDir 会重试订阅（自愈），目录数据本身仍可用
            // （仅自动刷新暂缺，不阻断加载链路）
          }
        }
      } finally {
        // 仅最新代复位 loading（过期代不得覆盖新代的加载中状态）
        if (seq === this.loadSeq) this.loading = false;
      }
    },

    /** 防抖重扫（watch 事件与手动刷新共用入口） */
    scheduleRefresh(): void {
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => void this.refresh(), WATCH_DEBOUNCE_MS);
    },

    /** 强制重扫（手动 Refresh 兜底，AC-F5-3） */
    async refresh(): Promise<void> {
      if (this.currentDir) await this.loadDir(this.currentDir);
    },

    /** 侧栏开关（Ctrl+Shift+L / 状态栏事件源共用） */
    toggleSidebar(): void {
      this.sidebarVisible = !this.sidebarVisible;
    },

    /** 面板切换（Ctrl+Shift+1/2/3；搜索入口自动切文件树） */
    switchPanel(key: PanelKey): void {
      this.activePanel = key;
    },

    /** 设置排序（F6：四种排序各可升降序） */
    setSort(by: SortBy, direction?: "asc" | "desc"): void {
      this.sortBy = by;
      if (direction) this.direction = direction;
      void this.refresh();
    },

    /** Group by Folder 开关（默认开） */
    setGroupFolder(value: boolean): void {
      this.groupFolderFirst = value;
      void this.refresh();
    },

    /** 展开/折叠目录（仅切换该 relPath 节点的展开状态，非递归） */
    toggleExpand(path: string): void {
      if (this.expandedPaths.has(path)) this.expandedPaths.delete(path);
      else this.expandedPaths.add(path);
    },

    /** 选中条目（打开文件/高亮） */
    select(path: string): void {
      this.selectedPath = path;
    },

    /** 显示全局搜索框（F12 入口；同时展开侧栏并切到文件树面板） */
    showSearch(): void {
      this.sidebarVisible = true;
      this.switchPanel("tree");
      this.searchVisible = true;
    },

    /** 关闭搜索框 */
    hideSearch(): void {
      this.searchVisible = false;
    },
  },
});
