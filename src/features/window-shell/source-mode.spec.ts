// 源码模式切换状态机测试（12 W4；AC-M-6/7/8 的切换逻辑核心，100% 覆盖）
//
// 编辑器侧依赖与源码层宿主全部以 vi.fn 夹具注入，逐条断言：
// - 切入：装载全文 + 光标映射（含 Front Matter 行偏移折算）+ 焦点移交；
// - 切出：内容变更才回写（AC-M-8）+ 行列逆映射 + revealRange 光标恢复（AC-M-7）；
// - 守卫：编辑器未就绪/宿主未就绪不切入；非源码态切出 no-op；
// - 标签切换：源码态刷新为活跃标签内容（未回写编辑丢弃告警）。
// 单例装配段（useSourceMode）：01 依赖模块整体 mock，验证真实接线
// （依赖回调/转发宿主/active 镜像/标签切换 watch）。
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import type { Editor } from "@milkdown/kit/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSourceMode, resetSourceModeForTest, useSourceMode } from "./source-mode";
import type { SourceModeDeps, SourceModeHost } from "./source-mode";
import { useTabsController } from "../tabs/tabs-controller";

vi.mock("../editor/editor-manager", () => ({
  editorManager: {
    getEditor: vi.fn(() => ({})),
    getMarkdown: vi.fn(() => "# 单例文档"),
    setContent: vi.fn(),
    getView: vi.fn(() => undefined),
    adopt: vi.fn(),
    subscribeMarkdownUpdated: vi.fn(() => vi.fn()),
    subscribeDocUpdated: vi.fn(() => vi.fn()),
    subscribeSelectionUpdated: vi.fn(() => vi.fn()),
    insertMarkdown: vi.fn(),
  },
}));
vi.mock("../editor/source-pos", () => ({
  pmPosToLineCol: vi.fn(() => ({ line: 0, col: 0 })),
  lineColToPmPos: vi.fn(() => 0),
}));
vi.mock("../editor/reveal-range", () => ({ revealRange: vi.fn() }));

import { editorManager } from "../editor/editor-manager";
import { revealRange } from "../editor/reveal-range";

/** 编辑器侧依赖夹具（全 vi.fn；默认「编辑器就绪 + 光标在段落首」形态） */
function makeDeps(): SourceModeDeps {
  return {
    getEditor: vi.fn((): Editor | undefined => ({}) as Editor),
    getMarkdown: vi.fn(() => "# 标题\n\n正文"),
    setContent: vi.fn(),
    getPmCursor: vi.fn(() => 1),
    pmPosToLineCol: vi.fn(() => ({ line: 0, col: 0 })),
    lineColToPmPos: vi.fn(() => 6),
    revealRange: vi.fn(),
    focusEditor: vi.fn(),
  };
}

/** 源码层宿主夹具（内存文本 + 光标记录，模拟 CodeMirror 行为） */
function makeHost(initialText = "") {
  let text = initialText;
  let cursor = { line: 0, col: 0 };
  const load = vi.fn((next: string, at: { line: number; col: number }) => {
    text = next;
    cursor = at;
  });
  return {
    isReady: vi.fn(() => true),
    load,
    getText: vi.fn(() => text),
    getCursor: vi.fn(() => cursor),
    focus: vi.fn(),
  } satisfies SourceModeHost;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("切入源码模式（WYSIWYG → source）", () => {
  it("装载当前全文并把 PM 光标映射为源码行列后移交焦点（AC-M-6）", () => {
    const deps = makeDeps();
    const host = makeHost();
    const machine = createSourceMode(deps, host);
    expect(machine.getState()).toBe("wysiwyg");
    expect(machine.enter()).toBe(true);
    expect(machine.getState()).toBe("source");
    expect(host.load).toHaveBeenCalledOnce();
    expect(host.load).toHaveBeenCalledWith("# 标题\n\n正文", { line: 0, col: 0 });
    expect(host.focus).toHaveBeenCalledOnce();
  });

  it("含 Front Matter 文档：源码光标行按 FM 行数下移（定界两行 + 内文行数）", () => {
    const deps = makeDeps();
    deps.getMarkdown = vi.fn(() => "---\ntitle: 元数据\ndraft: true\n---\n# 标题");
    const host = makeHost();
    const machine = createSourceMode(deps, host);
    machine.enter();
    // PM 正文行 0 → 源码行 0 + 2 定界行 + 2 内文行 = 行 4
    expect(host.load).toHaveBeenCalledWith("---\ntitle: 元数据\ndraft: true\n---\n# 标题", {
      line: 4,
      col: 0,
    });
  });

  it("编辑器未就绪不切入（防空串污染源码层）", () => {
    const deps = makeDeps();
    deps.getEditor = vi.fn(() => undefined);
    const host = makeHost();
    const machine = createSourceMode(deps, host);
    expect(machine.enter()).toBe(false);
    expect(machine.getState()).toBe("wysiwyg");
    expect(host.load).not.toHaveBeenCalled();
  });

  it("源码层宿主未就绪不切入", () => {
    const deps = makeDeps();
    const host = makeHost();
    host.isReady = vi.fn(() => false);
    const machine = createSourceMode(deps, host);
    expect(machine.enter()).toBe(false);
    expect(machine.getState()).toBe("wysiwyg");
  });

  it("已处源码态重复切入为幂等 no-op", () => {
    const deps = makeDeps();
    const host = makeHost();
    const machine = createSourceMode(deps, host);
    machine.enter();
    expect(machine.enter()).toBe(true);
    expect(host.load).toHaveBeenCalledOnce();
  });
});

describe("切出源码模式（source → WYSIWYG）", () => {
  it("内容有变更时经 setContent 回写（AC-M-8）", () => {
    const deps = makeDeps();
    const host = makeHost();
    const machine = createSourceMode(deps, host);
    machine.enter();
    host.load("# 标题\n\n正文已编辑", { line: 0, col: 0 });
    expect(machine.exit()).toBe(true);
    expect(deps.setContent).toHaveBeenCalledOnce();
    expect(deps.setContent).toHaveBeenCalledWith("# 标题\n\n正文已编辑");
    expect(machine.getState()).toBe("wysiwyg");
  });

  it("内容无变更不回写（避免空 undo 步破坏撤销链）", () => {
    const deps = makeDeps();
    const host = makeHost();
    const machine = createSourceMode(deps, host);
    machine.enter();
    expect(machine.exit()).toBe(true);
    expect(deps.setContent).not.toHaveBeenCalled();
  });

  it("光标按行列逆映射后经 revealRange(pos,pos,1) 恢复并归还焦点（AC-M-7）", () => {
    const deps = makeDeps();
    const host = makeHost();
    const machine = createSourceMode(deps, host);
    machine.enter();
    // 模拟用户在源码层移动光标到行 2 列 5（无 FM 文档：源码行即正文行）
    host.load(deps.getMarkdown(), { line: 2, col: 5 });
    deps.lineColToPmPos = vi.fn(() => 9);
    machine.exit();
    expect(deps.lineColToPmPos).toHaveBeenCalledWith(expect.anything(), { line: 2, col: 5 });
    expect(deps.revealRange).toHaveBeenCalledOnce();
    expect(deps.revealRange).toHaveBeenCalledWith(expect.anything(), 9, 9, 1);
    expect(deps.focusEditor).toHaveBeenCalledOnce();
  });

  it("切出光标折算含 Front Matter 行偏移（源码行 − 偏移 = 正文行）", () => {
    const deps = makeDeps();
    deps.getMarkdown = vi.fn(() => "---\ntitle: 元数据\n---\n# 标题");
    const host = makeHost();
    const machine = createSourceMode(deps, host);
    machine.enter();
    // 偏移 = 1 行 FM 内文 + 2 行定界 = 3：源码行 4 → 正文行 1
    host.load(deps.getMarkdown(), { line: 4, col: 0 });
    machine.exit();
    expect(deps.lineColToPmPos).toHaveBeenCalledWith(expect.anything(), { line: 1, col: 0 });
  });

  it("编辑器丢失（标签已关等边缘）降级退出：状态复位不回写", () => {
    const deps = makeDeps();
    const host = makeHost();
    const machine = createSourceMode(deps, host);
    machine.enter();
    deps.getEditor = vi.fn(() => undefined);
    expect(machine.exit()).toBe(false);
    expect(machine.getState()).toBe("wysiwyg");
    expect(deps.setContent).not.toHaveBeenCalled();
  });

  it("宿主未就绪降级退出：状态复位不触达源码层读数", () => {
    const deps = makeDeps();
    const host = makeHost();
    const machine = createSourceMode(deps, host);
    machine.enter();
    host.isReady = vi.fn(() => false);
    expect(machine.exit()).toBe(false);
    expect(machine.getState()).toBe("wysiwyg");
    expect(deps.setContent).not.toHaveBeenCalled();
    expect(deps.revealRange).not.toHaveBeenCalled();
  });

  it("非源码态切出为 no-op（返回 false 状态不变）", () => {
    const deps = makeDeps();
    const host = makeHost();
    const machine = createSourceMode(deps, host);
    expect(machine.exit()).toBe(false);
    expect(machine.getState()).toBe("wysiwyg");
  });
});

describe("toggle 双向切换（Ctrl+/ 单一入口）", () => {
  it("wysiwyg 态切入、source 态切出（往返一次回到原态）", () => {
    const deps = makeDeps();
    const host = makeHost();
    const machine = createSourceMode(deps, host);
    expect(machine.toggle()).toBe(true);
    expect(machine.getState()).toBe("source");
    expect(machine.toggle()).toBe(true);
    expect(machine.getState()).toBe("wysiwyg");
  });

  it("切入被守卫拒绝时 toggle 返回 false 且状态不变", () => {
    const deps = makeDeps();
    deps.getEditor = vi.fn(() => undefined);
    const host = makeHost();
    const machine = createSourceMode(deps, host);
    expect(machine.toggle()).toBe(false);
    expect(machine.getState()).toBe("wysiwyg");
  });
});

describe("标签切换刷新（syncToActiveTab）", () => {
  it("源码态下刷新为活跃标签全文并重算光标（跟随活跃标签）", () => {
    const deps = makeDeps();
    const host = makeHost();
    const machine = createSourceMode(deps, host);
    machine.enter();
    deps.getMarkdown = vi.fn(() => "# 另一个标签");
    deps.getPmCursor = vi.fn(() => 3);
    deps.pmPosToLineCol = vi.fn(() => ({ line: 0, col: 2 }));
    machine.syncToActiveTab();
    expect(host.load).toHaveBeenCalledTimes(2);
    expect(host.load).toHaveBeenLastCalledWith("# 另一个标签", { line: 0, col: 2 });
    expect(machine.getState()).toBe("source");
  });

  it("源码态下有未回写编辑时告警丢弃（04 无按标签写回接口，MVP 披露项）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps();
    const host = makeHost();
    const machine = createSourceMode(deps, host);
    machine.enter();
    host.load("# 已编辑", { line: 0, col: 0 });
    machine.syncToActiveTab();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("丢弃"));
  });

  it("非源码态下切换标签为 no-op", () => {
    const deps = makeDeps();
    const host = makeHost();
    const machine = createSourceMode(deps, host);
    machine.syncToActiveTab();
    expect(host.load).not.toHaveBeenCalled();
  });

  it("编辑器丢失时刷新静默跳过（不崩溃）", () => {
    const deps = makeDeps();
    const host = makeHost();
    const machine = createSourceMode(deps, host);
    machine.enter();
    deps.getEditor = vi.fn(() => undefined);
    expect(() => machine.syncToActiveTab()).not.toThrow();
    expect(host.load).toHaveBeenCalledOnce();
  });

  it("宿主未就绪时刷新静默跳过（无可刷新目标）", () => {
    const deps = makeDeps();
    const host = makeHost();
    const machine = createSourceMode(deps, host);
    machine.enter();
    host.isReady = vi.fn(() => false);
    machine.syncToActiveTab();
    expect(host.load).toHaveBeenCalledOnce();
  });
});

describe("useSourceMode 单例装配（真实依赖接线）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetSourceModeForTest();
  });

  it("多处调用返回同一实例（模块级单例——菜单与快捷键同一命令函数）", () => {
    expect(useSourceMode()).toBe(useSourceMode());
  });

  it("active 镜像状态机状态：切入 true、切出 false（视图层 v-show 绑定）", () => {
    const sm = useSourceMode();
    const host = makeHost();
    sm.setHost(host);
    expect(sm.active.value).toBe(false);
    expect(sm.toggle()).toBe(true);
    expect(sm.active.value).toBe(true);
    expect(sm.toggle()).toBe(true);
    expect(sm.active.value).toBe(false);
    sm.setHost(undefined);
  });

  it("setHost 上缴宿主后命令经转发宿主触达（挂载时序解耦）", () => {
    const sm = useSourceMode();
    const host = makeHost();
    sm.setHost(host);
    expect(sm.enter()).toBe(true);
    expect(host.load).toHaveBeenCalledWith("# 单例文档", { line: 0, col: 0 });
    expect(host.focus).toHaveBeenCalledOnce();
    sm.setHost(undefined);
  });

  it("宿主未注册（转发槽位空）时切入被 isReady 守卫拒绝", () => {
    const sm = useSourceMode();
    expect(sm.enter()).toBe(false);
    expect(sm.getState()).toBe("wysiwyg");
    expect(sm.active.value).toBe(false);
  });

  it("切出接线：文本变更回写 + 光标经 revealRange 恢复 + active 复位（AC-M-7/8）", () => {
    // 视图光标桩：getPmCursor 读 selection.from；focusEditor 调 view.focus()
    vi.mocked(editorManager.getView).mockReturnValue({
      state: { selection: { from: 6 } },
      focus: vi.fn(),
    } as never);
    const sm = useSourceMode();
    const host = makeHost();
    sm.setHost(host);
    expect(sm.enter()).toBe(true);
    // 模拟源码层编辑后切出：变更文本经 01 setContent 回写（AC-M-8 接线）
    host.load("# 单例文档\n\n正文编辑后", { line: 2, col: 2 });
    expect(sm.exit()).toBe(true);
    expect(vi.mocked(editorManager.setContent)).toHaveBeenCalledWith("# 单例文档\n\n正文编辑后");
    expect(vi.mocked(revealRange)).toHaveBeenCalledWith(expect.anything(), 0, 0, 1);
    expect(sm.active.value).toBe(false);
    sm.setHost(undefined);
  });

  it("宿主注销后标签切换刷新静默跳过（转发槽位空不崩溃）", () => {
    const sm = useSourceMode();
    const host = makeHost();
    sm.setHost(host);
    expect(sm.enter()).toBe(true);
    sm.setHost(undefined);
    expect(() => sm.syncToActiveTab()).not.toThrow();
    sm.setHost(host);
    expect(sm.exit()).toBe(true);
    sm.setHost(undefined);
  });

  it("标签切换联动：源码态下激活标签变化刷新源码层（watch → syncToActiveTab）", async () => {
    const sm = useSourceMode();
    const host = makeHost();
    sm.setHost(host);
    expect(sm.enter()).toBe(true);
    const tabs = useTabsController();
    tabs.createUntitled();
    tabs.createUntitled();
    const loadsBefore = host.load.mock.calls.length;
    // 激活首个标签（当前活跃为第二标签，激活动作产生 activeTabId 变化）
    tabs.activate(tabs.store.tabs[0]!.id);
    await nextTick();
    // createUntitled 亦切活跃标签（同样触发刷新），此处断言激活动作后仍继续刷新
    expect(host.load.mock.calls.length).toBeGreaterThan(loadsBefore);
    expect(sm.getState()).toBe("source");
    sm.setHost(undefined);
  });
});
