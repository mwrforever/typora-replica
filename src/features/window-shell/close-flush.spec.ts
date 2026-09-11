// 关窗前源码层回写测试（12 窗口外壳：源码态静默数据丢失修复）
//
// 依赖全注入（flushPendingWrite 产物/活跃标签/置脏通道），逐条断言装配决策：
// - flushed：回写后即时置脏，使标签赶上同一同步回调内的退出聚合（防抖置脏来不及）；
// - failed：置脏拦截直通关窗 + console.error 留痕（不静默 destroy）；
// - clean/inactive：不干预常规关窗流程；
// - 边界：无活跃标签（undefined）不置脏不崩溃。
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSourceEditsBeforeClose } from "./close-flush";
import type { SourceCloseFlushDeps } from "./close-flush";
import type { SourceFlushOutcome } from "./source-mode";

/** 依赖夹具：产物可指定，置脏与活跃标签读取为可观测 spy（null = 无活跃标签） */
function makeDeps(outcome: SourceFlushOutcome, activeTabId: string | null = "tab-1") {
  return {
    flushPendingWrite: vi.fn(() => outcome),
    activeTabId: vi.fn(() => activeTabId ?? undefined),
    markDirty: vi.fn(),
  } satisfies SourceCloseFlushDeps;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("关窗前源码层回写（flushSourceEditsBeforeClose）", () => {
  it("flushed：回写后即时置脏，活跃标签进入本轮退出聚合（AC-M-18 覆盖源码层编辑）", () => {
    const deps = makeDeps("flushed");
    flushSourceEditsBeforeClose(deps);
    expect(deps.flushPendingWrite).toHaveBeenCalledOnce();
    expect(deps.markDirty).toHaveBeenCalledOnce();
    expect(deps.markDirty).toHaveBeenCalledWith("tab-1");
  });

  it("failed：置脏拦截直通关窗 + console.error 留痕（回写失败不静默 destroy）", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps("failed");
    flushSourceEditsBeforeClose(deps);
    expect(deps.markDirty).toHaveBeenCalledWith("tab-1");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("回写失败"));
  });

  it("clean：源码层无未回写编辑，不置脏不干预常规关窗", () => {
    const deps = makeDeps("clean");
    flushSourceEditsBeforeClose(deps);
    expect(deps.markDirty).not.toHaveBeenCalled();
  });

  it("inactive：非源码态不置脏（WYSIWYG 关窗走既有流程）", () => {
    const deps = makeDeps("inactive");
    flushSourceEditsBeforeClose(deps);
    expect(deps.markDirty).not.toHaveBeenCalled();
  });

  it("无活跃标签（undefined）时 flushed 不置脏不崩溃（无标签即无内容可丢）", () => {
    const deps = makeDeps("flushed", null);
    expect(() => flushSourceEditsBeforeClose(deps)).not.toThrow();
    expect(deps.markDirty).not.toHaveBeenCalled();
  });
});
