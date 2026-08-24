// 搜索面板与全局搜索状态机（06 核心，100% 覆盖组）
//
// 面板态（find/replace 两模式、三开关、计数、会话级记忆——不落盘，Typora 无
// 记忆开关的官方记载，自定策略从简）+ 全局搜索态（流式结果聚合/truncated/
// 代次守卫）。防抖定时器与代次序号为模块级私有变量（Pinia state 不收函数）。
// 结果上限 maxResults 由 service 层固定注入（GLOBAL_MAX_RESULTS=50，见
// services/search-service），store 仅透传三开关快照。
import { defineStore } from "pinia";
import {
  cancelGlobalSearch,
  startGlobalSearch,
  type GlobalSearchMatch,
  type SearchStreamEvent,
} from "../../services/search-service";
import { useFileTreeStore } from "../file-tree/file-tree-store";

export type FindMode = "find" | "replace";
/** 查询可用性（find-controller 受控构建后回写，UI 据此呈现红字/禁用） */
export type QueryStatus = "idle" | "ok" | "invalid-regex" | "matches-empty";

/** 全局结果文件分组（同 filePath 分批合并） */
export interface GlobalFileResult {
  filePath: string;
  fileName: string;
  /** 非 UTF-8 编码标注（AC-F26-5）；utf8 时 undefined */
  encoding?: string;
  matches: GlobalSearchMatch[];
}

/** 侧栏顶部框逐键防抖窗口 */
const GLOBAL_DEBOUNCE_MS = 300;

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
/** 代次序号：新发起即 ++，过期批次的 Channel 回调整体丢弃 */
let globalSeq = 0;

export const useSearchStore = defineStore("search", {
  state: () => ({
    // —— 当前文件查找/替换面板（AC-F24/F25）——
    visible: false,
    mode: "find" as FindMode,
    query: "",
    replacement: "",
    caseSensitive: false,
    wholeWord: false,
    regexp: false,
    matchCount: 0,
    activeIndex: 0,
    queryStatus: "idle" as QueryStatus,
    // —— 跨文件全局搜索（AC-F26）——
    globalQuery: "",
    globalCaseSensitive: false,
    globalWholeWord: false,
    globalRegexp: false,
    globalResults: [] as GlobalFileResult[],
    globalTruncated: false,
    globalSearching: false,
    globalError: undefined as string | undefined,
    /** 手动展开的多匹配文件（默认折叠，用户实测形态） */
    expandedFiles: new Set<string>(),
  }),

  getters: {
    /** 结果行总数（列表头部摘要消费） */
    globalMatchTotal: (state): number =>
      state.globalResults.reduce((sum, r) => sum + r.matches.length, 0),
  },

  actions: {
    /** Ctrl+F：关→开(find)；开(replace)→切 find；开(find)→关闭 */
    toggleFind(): void {
      if (!this.visible) {
        this.visible = true;
        this.mode = "find";
      } else if (this.mode === "replace") {
        this.mode = "find";
      } else {
        this.close();
      }
    },

    /** Ctrl+H：与 toggleFind 对称 */
    toggleReplace(): void {
      if (!this.visible) {
        this.visible = true;
        this.mode = "replace";
      } else if (this.mode === "find") {
        this.mode = "replace";
      } else {
        this.close();
      }
    },

    /** 关闭面板（ESC/Ctrl+F 复用）；查询词保留供重开恢复 */
    close(): void {
      this.visible = false;
    },

    setQuery(v: string): void {
      this.query = v;
    },
    setReplacement(v: string): void {
      this.replacement = v;
    },
    /** 三开关翻转（面板与全局搜索共用：六键联合覆盖两套开关） */
    toggleOption(
      name:
        | "caseSensitive"
        | "wholeWord"
        | "regexp"
        | "globalCaseSensitive"
        | "globalWholeWord"
        | "globalRegexp",
    ): void {
      this[name] = !this[name];
    },
    setStatus(status: QueryStatus): void {
      this.queryStatus = status;
    },
    applyCounts(count: number, activeIndex: number): void {
      this.matchCount = count;
      this.activeIndex = activeIndex;
    },
    setActiveIndex(index: number): void {
      this.activeIndex = index;
    },

    /**
     * 全局搜索请求（侧栏顶部框逐键入口）：防抖 300ms 后发起；
     * 空词立即取消在途任务并清空结果（AC-F26-6 取消语义的前端侧）
     */
    requestGlobalSearch(query: string): void {
      this.globalQuery = query;
      if (!query || !useFileTreeStore().currentDir) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = undefined;
        void this.runGlobalSearch();
        return;
      }
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = undefined;
        void this.runGlobalSearch();
      }, GLOBAL_DEBOUNCE_MS);
    },

    /** 立即执行挂起的搜索（Enter 提交入口） */
    flushGlobalSearch(): void {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
      void this.runGlobalSearch();
    },

    /** 发起扫描（内部：代次推进 + 流式回调接线） */
    async runGlobalSearch(): Promise<void> {
      const root = useFileTreeStore().currentDir;
      if (!this.globalQuery || !root) {
        this.resetGlobal();
        void cancelGlobalSearch().catch(() => undefined); // 在途任务取消（幂等）
        return;
      }
      const seq = ++globalSeq;
      this.globalSearching = true;
      this.globalError = undefined;
      this.globalResults = [];
      this.globalTruncated = false;
      this.expandedFiles = new Set();
      try {
        await startGlobalSearch(
          root,
          this.globalQuery,
          {
            caseSensitive: this.globalCaseSensitive,
            wholeWord: this.globalWholeWord,
            regexp: this.globalRegexp,
          },
          (events) => {
            // 代次守卫：新搜索发起后旧批次整体丢弃
            if (seq === globalSeq) this.applyStreamEvents(events);
          },
        );
      } catch (error) {
        if (seq !== globalSeq) return; // 过期代的失败不覆盖新一代状态
        this.globalError = error instanceof Error ? error.message : String(error);
        this.globalSearching = false;
      }
    },

    /** Channel 批量事件回写：同文件分批合并 / done 收口 / error 静默跳过 */
    applyStreamEvents(events: SearchStreamEvent[]): void {
      for (const ev of events) {
        if (ev.type === "result") {
          const existing = this.globalResults.find((r) => r.filePath === ev.filePath);
          if (existing) {
            existing.matches.push(...ev.matches);
            // 编码标注以首批判定为准，后续批不覆盖
          } else {
            this.globalResults.push({
              filePath: ev.filePath,
              fileName: ev.fileName,
              encoding: ev.encoding ?? undefined,
              matches: [...ev.matches],
            });
          }
        } else if (ev.type === "done") {
          this.globalTruncated = ev.truncated;
          this.globalSearching = false;
        } else {
          // 单文件读取失败不中断整体（spec §5.3① 契约）；首版仅控制台提示
          console.warn(`[MarkWell] 全局搜索跳过无法读取的文件 ${ev.path}: ${ev.message}`);
        }
      }
    },

    resetGlobal(): void {
      this.globalResults = [];
      this.globalTruncated = false;
      this.globalSearching = false;
      this.globalError = undefined;
    },

    /** 展开/折叠某文件的结果分组（多匹配文件默认折叠） */
    toggleExpandFile(path: string): void {
      if (this.expandedFiles.has(path)) this.expandedFiles.delete(path);
      else this.expandedFiles.add(path);
    },
  },
});
