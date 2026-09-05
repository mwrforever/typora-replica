// search-store 状态机用例（100% 覆盖组）：service 全量 mock，事件注入走 hoisted 桩。
// 文件树 store 用真实 Pinia 实例仅置 currentDir 字段（纯内存字段，无 IO 副作用；
// 其模块链 file-io/tree-utils 在 jsdom 引入安全，无需轻桩）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const h = vi.hoisted(() => ({
  /** 每次 startGlobalSearch 调用的 [root, query, opts, onBatch] 记录 */
  startCalls: [] as Array<{
    root: string;
    query: string;
    opts: Record<string, unknown>;
    onBatch: (evs: unknown[]) => void;
  }>,
  cancelCount: vi.fn(),
  /** 可换拒绝桩：非空时下一次 startGlobalSearch reject 该值 */
  rejectNext: undefined as unknown,
  /** 可换拒绝桩：非空时下一次 cancelGlobalSearch reject 该值（取消通道异常路径） */
  cancelRejectNext: undefined as unknown,
}));

vi.mock("../../services/search-service", () => ({
  startGlobalSearch: (
    root: string,
    query: string,
    opts: Record<string, unknown>,
    onBatch: (evs: unknown[]) => void,
  ) => {
    if (h.rejectNext !== undefined) {
      const err = h.rejectNext;
      h.rejectNext = undefined;
      return Promise.reject(err);
    }
    h.startCalls.push({ root, query, opts, onBatch });
    return Promise.resolve();
  },
  cancelGlobalSearch: () => {
    h.cancelCount();
    if (h.cancelRejectNext !== undefined) {
      const err = h.cancelRejectNext;
      h.cancelRejectNext = undefined;
      return Promise.reject(err);
    }
    return Promise.resolve();
  },
}));

import { useSearchStore } from "./search-store";
import { useFileTreeStore } from "../file-tree/file-tree-store";

beforeEach(() => {
  setActivePinia(createPinia());
  h.startCalls.length = 0;
  h.cancelCount.mockClear();
  h.rejectNext = undefined;
  h.cancelRejectNext = undefined;
});

describe("面板状态机", () => {
  it("toggleFind/toggleReplace/close 三态语义；close 保留查询词（AC-F24 会话记忆）", () => {
    const s = useSearchStore();
    s.toggleFind(); // 关 → 开(find)
    expect(s.visible && s.mode === "find").toBe(true);
    s.setQuery("词");
    s.toggleReplace(); // 开(find) → 切 replace 不关
    expect(s.visible && s.mode === "replace").toBe(true);
    s.toggleFind(); // 开(replace) → 切回 find（对称语义）
    expect(s.visible && s.mode === "find").toBe(true);
    s.toggleFind(); // 开(find) → 关闭
    expect(s.visible).toBe(false);
    s.toggleFind(); // 重开恢复上次关键词
    expect(s.query).toBe("词");
    s.close();
    s.toggleReplace(); // 直开替换态
    expect(s.visible && s.mode === "replace").toBe(true);
    s.toggleReplace(); // 开(replace) → 关闭（对称语义）
    expect(s.visible).toBe(false);
  });

  it("toggleOption 三开关独立翻转", () => {
    const s = useSearchStore();
    s.toggleOption("caseSensitive");
    s.toggleOption("regexp");
    expect(s.caseSensitive && s.regexp && !s.wholeWord).toBe(true);
  });

  it("setReplacement/setStatus/applyCounts/setActiveIndex 回写面板态（Task 4/5 消费契约）", () => {
    const s = useSearchStore();
    s.setReplacement("替换词");
    expect(s.replacement).toBe("替换词");
    s.setStatus("invalid-regex");
    expect(s.queryStatus).toBe("invalid-regex");
    s.applyCounts(10, 3);
    expect(s.matchCount).toBe(10);
    expect(s.activeIndex).toBe(3);
    s.setActiveIndex(5);
    expect(s.activeIndex).toBe(5);
  });

  it("toggleExpandFile 增删展开集；globalMatchTotal 汇总结果行数", () => {
    const s = useSearchStore();
    s.globalResults.push(
      {
        filePath: "C:/ws/a.md",
        fileName: "a.md",
        matches: [
          { lineNumber: 1, lineText: "x", firstMatchIndex: 0 },
          { lineNumber: 2, lineText: "y", firstMatchIndex: 1 },
        ],
      },
      {
        filePath: "C:/ws/b.md",
        fileName: "b.md",
        encoding: "gbk",
        matches: [{ lineNumber: 3, lineText: "z", firstMatchIndex: 2 }],
      },
    );
    expect(s.globalMatchTotal).toBe(3);
    s.toggleExpandFile("C:/ws/a.md");
    expect(s.expandedFiles.has("C:/ws/a.md")).toBe(true);
    s.toggleExpandFile("C:/ws/a.md"); // 再切一次移除（增删双分支）
    expect(s.expandedFiles.has("C:/ws/a.md")).toBe(false);
  });
});

describe("requestGlobalSearch 防抖与取消（AC-F26-6）", () => {
  it("逐键输入 300ms 防抖后单次发起；flushGlobalSearch 立即清定时器直发", async () => {
    vi.useFakeTimers();
    try {
      const fileTree = useFileTreeStore();
      fileTree.currentDir = "C:/ws";
      const s = useSearchStore();
      s.requestGlobalSearch("关");
      s.requestGlobalSearch("关键");
      s.requestGlobalSearch("关键词");
      expect(h.startCalls).toHaveLength(0); // 防抖窗口内未发起
      await vi.advanceTimersByTimeAsync(300);
      expect(h.startCalls).toHaveLength(1);
      expect(h.startCalls[0]).toMatchObject({ root: "C:/ws", query: "关键词" });
      // 三开关快照透传；maxResults 由 service 层固定注入（store 不重复携带）
      expect(h.startCalls[0]!.opts).toEqual({
        caseSensitive: false,
        wholeWord: false,
        regexp: false,
      });

      s.requestGlobalSearch("关键词2"); // 新一轮防抖挂起
      s.flushGlobalSearch(); // Enter 直发
      await vi.advanceTimersByTimeAsync(0);
      expect(h.startCalls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(400); // 挂起定时器已被清除，不再多发
      expect(h.startCalls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("空词立即取消并清空（不发扫描）；无工作区目录不发请求", () => {
    const fileTree = useFileTreeStore();
    fileTree.currentDir = "C:/ws";
    const s = useSearchStore();
    s.globalResults.push({
      filePath: "x",
      fileName: "x.md",
      matches: [{ lineNumber: 1, lineText: "x", firstMatchIndex: 0 }],
    });
    s.requestGlobalSearch("词"); // 先挂起一轮防抖（覆盖空词到达时清除挂起定时器）
    s.requestGlobalSearch(""); // 清空输入 → 立即取消在途任务
    expect(h.cancelCount).toHaveBeenCalled();
    expect(s.globalResults).toHaveLength(0);
    // 挂起定时器已被清除：直发的是取消清理路径，不产生扫描
    expect(h.startCalls).toHaveLength(0);

    fileTree.currentDir = undefined;
    s.requestGlobalSearch("词");
    expect(h.startCalls).toHaveLength(0);
    expect(s.globalSearching).toBe(false);
  });

  it("flushGlobalSearch 无挂起防抖时亦安全直发（静默期 Enter 走取消清理路径）", async () => {
    useFileTreeStore().currentDir = "C:/ws";
    const s = useSearchStore();
    // 取消通道自身拒绝亦静默吞掉：清理兜底不阻断 UI、不上抛未处理拒绝
    h.cancelRejectNext = new Error("取消通道异常");
    s.flushGlobalSearch(); // 空词 + 无定时器：直达取消清理，不发扫描
    await Promise.resolve(); // 让吞错回调执行（fire-and-forget 语义核验）
    expect(h.startCalls).toHaveLength(0);
    expect(h.cancelCount).toHaveBeenCalled();
  });
});

describe("applyStreamEvents 聚合与代次守卫", () => {
  it("result/done/truncated 回写；同文件分批合并；error 静默 warn 不中断", async () => {
    vi.useFakeTimers();
    try {
      useFileTreeStore().currentDir = "C:/ws";
      const s = useSearchStore();
      s.requestGlobalSearch("词");
      await vi.advanceTimersByTimeAsync(300);
      const batch = h.startCalls[0]!.onBatch;
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        batch([
          {
            type: "result",
            filePath: "C:/ws/a.md",
            fileName: "a.md",
            encoding: "gbk",
            matches: [{ lineNumber: 1, lineText: "词一", firstMatchIndex: 0 }],
          },
          { type: "error", path: "C:/ws/bad.bin", message: "疑似二进制" },
        ]);
        batch([
          {
            type: "result",
            filePath: "C:/ws/a.md",
            fileName: "a.md",
            encoding: null,
            matches: [{ lineNumber: 9, lineText: "词二", firstMatchIndex: 1 }],
          },
          {
            type: "result",
            filePath: "C:/ws/b.md",
            fileName: "b.md",
            encoding: null,
            matches: [{ lineNumber: 3, lineText: "词三", firstMatchIndex: 2 }],
          },
          { type: "done", truncated: true },
        ]);
        expect(warnSpy).toHaveBeenCalledTimes(1); // 单文件读取失败仅提示不中断
      } finally {
        warnSpy.mockRestore();
      }
      expect(s.globalResults).toHaveLength(2); // 同文件分批合并为一条
      expect(s.globalResults[0]!.matches).toHaveLength(2);
      // 合并不覆盖首批判定：a.md 维持首批的 gbk 标注（AC-F26-5）
      expect(s.globalResults[0]!.encoding).toBe("gbk");
      // 新文件组的 null 编码归一为 undefined（utf8 缺省不标注）
      expect(s.globalResults[1]!.encoding).toBeUndefined();
      expect(s.globalTruncated).toBe(true);
      expect(s.globalSearching).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("新搜索使旧回调代次过期：旧批次丢弃不覆盖新结果", async () => {
    vi.useFakeTimers();
    try {
      useFileTreeStore().currentDir = "C:/ws";
      const s = useSearchStore();
      s.requestGlobalSearch("一");
      await vi.advanceTimersByTimeAsync(300);
      const firstBatch = h.startCalls[0]!.onBatch;
      s.requestGlobalSearch("二"); // 第二次发起 → 第一次代次过期
      s.flushGlobalSearch();
      await vi.advanceTimersByTimeAsync(0);
      firstBatch([{ type: "done", truncated: false }]);
      expect(s.globalSearching).toBe(true); // 旧 done 被丢弃，仍在搜索
      const secondBatch = h.startCalls[h.startCalls.length - 1]!.onBatch;
      secondBatch([{ type: "done", truncated: false }]);
      expect(s.globalSearching).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("invoke 拒绝写入 globalError 并复位 searching（无效正则路径）", async () => {
    vi.useFakeTimers();
    try {
      useFileTreeStore().currentDir = "C:/ws";
      const s = useSearchStore();
      h.rejectNext = new Error("无效的搜索表达式");
      s.requestGlobalSearch("(");
      s.flushGlobalSearch();
      await vi.advanceTimersByTimeAsync(0);
      expect(s.globalSearching).toBe(false);
      expect(s.globalError).toContain("无效的搜索表达式");

      // 非 Error 拒绝值走 String(error) 归一路径（service 已规范化的消息原样呈现）
      h.rejectNext = "扫描根目录不可访问";
      s.requestGlobalSearch("(");
      s.flushGlobalSearch();
      await vi.advanceTimersByTimeAsync(0);
      expect(s.globalError).toBe("扫描根目录不可访问");
    } finally {
      vi.useRealTimers();
    }
  });

  it("过期代的 invoke 拒绝不覆盖新一代状态（守卫早退分支）", async () => {
    vi.useFakeTimers();
    try {
      useFileTreeStore().currentDir = "C:/ws";
      const s = useSearchStore();
      h.rejectNext = new Error("过期的扫描失败");
      s.requestGlobalSearch("一");
      s.flushGlobalSearch(); // 第一代立即发起（受理即拒，续延排队）
      s.requestGlobalSearch("二");
      s.flushGlobalSearch(); // 第二代替换：代次推进后第一代的失败才被消费
      await vi.advanceTimersByTimeAsync(0);
      expect(s.globalSearching).toBe(true); // 过期失败不得复位新一代的搜索中态
      expect(s.globalError).toBeUndefined(); // 过期失败不得写入错误
      const secondBatch = h.startCalls[h.startCalls.length - 1]!.onBatch;
      secondBatch([{ type: "done", truncated: false }]);
      expect(s.globalSearching).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
