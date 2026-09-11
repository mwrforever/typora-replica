// 视图模式控制器测试（12 窗口外壳 W5；Focus/Typewriter 开关状态机核心 100%）
//
// 依赖全注入（同 source-mode.spec 的 createSourceMode 夹具口径）：编辑器侧配置
// 读写以内存 Map 模拟，调度器受控（微任务手动冲刷），断言面向状态机对外行为——
// 开关翻转、配置派发、标签切换/实例出现后的最终一致同步。
// 单例装配段：01 门面与 01 插件门面整体 mock（捕获 selectionUpdated 回调可控触发），
// settings store 走真实实例（active pinia），覆盖真实接线链（订阅/偏好 watch/微任务对账）。
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mocks = vi.hoisted(() => ({
  /** 捕获 01 selectionUpdated 订阅回调（单例装配时登记，用例内手动触发） */
  selectionCb: undefined as (() => void) | undefined,
}));

vi.mock("../editor/editor-manager", () => ({
  editorManager: {
    getEditor: vi.fn(() => undefined),
    subscribeSelectionUpdated: vi.fn((cb: () => void) => {
      mocks.selectionCb = cb;
      return () => undefined;
    }),
  },
}));

vi.mock("../editor/focus-typewriter-plugin", () => ({
  getFocusTypewriterConfig: vi.fn(() => undefined),
  setFocusTypewriterConfig: vi.fn(),
}));

import { createViewModes, resetViewModesForTest, useViewModes } from "./view-modes";
import type { ViewModesSnapshot } from "./view-modes";
import { editorManager } from "../editor/editor-manager";
import { setFocusTypewriterConfig } from "../editor/focus-typewriter-plugin";
import { DEFAULT_SETTINGS } from "../../services/settings";
import { useSettingsStore } from "../settings/settings-store";
import type { Editor } from "@milkdown/kit/core";

/** 微任务冲刷（queueMicrotask 调度器真实执行窗口） */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

/** 内存配置仓（模拟每实例插件状态；editor 缺失 = 未就绪） */
function makeDeps() {
  const store = new Map<Editor, ViewModesSnapshot>();
  const queue: Array<() => void> = [];
  return {
    store,
    flush: () => {
      for (const cb of queue.splice(0)) cb();
    },
    getEditor: vi.fn((): Editor | undefined => editor),
    readConfig: vi.fn((editor: Editor) => store.get(editor)),
    writeConfig: vi.fn((editor: Editor, patch: Partial<ViewModesSnapshot>) => {
      const current = store.get(editor) ?? {
        focusEnabled: false,
        typewriterEnabled: false,
        typewriterClickCenter: true,
      };
      store.set(editor, { ...current, ...patch });
    }),
    schedule: vi.fn((cb: () => void) => {
      queue.push(cb);
    }),
  };
}

// 夹具编辑器假对象（控制器只透传给配置读写回调，不触碰其成员）
const editor = { tag: "test-editor" } as unknown as Editor;

describe("createViewModes 开关状态机", () => {
  it("toggleFocus/toggleTypewriter 翻转状态并派发对应配置补丁", () => {
    const deps = makeDeps();
    deps.store.set(editor, {
      focusEnabled: false,
      typewriterEnabled: false,
      typewriterClickCenter: true,
    });
    const controller = createViewModes(deps);
    expect(controller.focusEnabled.value).toBe(false);
    expect(controller.toggleFocus()).toBe(true);
    expect(controller.focusEnabled.value).toBe(true);
    expect(deps.writeConfig).toHaveBeenCalledWith(editor, { focusEnabled: true });
    expect(controller.toggleTypewriter()).toBe(true);
    expect(deps.writeConfig).toHaveBeenCalledWith(editor, { typewriterEnabled: true });
    // 再翻一次回关态
    expect(controller.toggleFocus()).toBe(false);
    expect(deps.writeConfig).toHaveBeenLastCalledWith(editor, { focusEnabled: false });
  });

  it("编辑器未就绪时开关仅保留期望态不派发（实例出现后经同步补齐）", () => {
    const deps = makeDeps();
    deps.getEditor = vi.fn(() => undefined);
    const controller = createViewModes(deps);
    expect(controller.toggleFocus()).toBe(true);
    expect(deps.writeConfig).not.toHaveBeenCalled();
    // 值仍翻转：菜单勾选态与后续同步以期望态为准
    expect(controller.focusEnabled.value).toBe(true);
  });

  it("setClickCenter 更新偏好并派发；同值重复设置不派发（幂等）", () => {
    const deps = makeDeps();
    deps.store.set(editor, {
      focusEnabled: false,
      typewriterEnabled: false,
      typewriterClickCenter: true,
    });
    const controller = createViewModes(deps);
    controller.setClickCenter(false);
    expect(deps.writeConfig).toHaveBeenCalledWith(editor, { typewriterClickCenter: false });
    expect(controller.desiredConfig().typewriterClickCenter).toBe(false);
    deps.writeConfig.mockClear();
    controller.setClickCenter(false);
    expect(deps.writeConfig).not.toHaveBeenCalled();
  });
});

describe("createViewModes 实例同步（标签切换最终一致）", () => {
  it("选区事件触发微任务同步：实例配置与期望态一致时不派发（对账短路）", () => {
    const deps = makeDeps();
    deps.store.set(editor, {
      focusEnabled: true,
      typewriterEnabled: false,
      typewriterClickCenter: true,
    });
    const controller = createViewModes(deps);
    controller.toggleFocus(); // 期望态与实例一致（store 已是 true）
    deps.writeConfig.mockClear();
    controller.onSelectionChanged();
    deps.flush();
    expect(deps.writeConfig).not.toHaveBeenCalled();
  });

  it("新实例（默认全关）落后于期望态时同步补齐配置（标签切换场景）", () => {
    const deps = makeDeps();
    const controller = createViewModes(deps);
    controller.toggleFocus();
    controller.toggleTypewriter();
    // 模拟切换到全新实例：期望态已翻转，新实例无任何配置（readConfig undefined → 补齐）
    const freshEditor = { tag: "fresh-editor" } as unknown as Editor;
    deps.getEditor = vi.fn(() => freshEditor);
    controller.onSelectionChanged();
    expect(deps.schedule).toHaveBeenCalled();
    deps.flush();
    expect(deps.writeConfig).toHaveBeenLastCalledWith(freshEditor, {
      focusEnabled: true,
      typewriterEnabled: true,
      typewriterClickCenter: true,
    });
  });

  it("窗口内多次选区事件合并为一次同步（防抖幂等）", () => {
    const deps = makeDeps();
    const controller = createViewModes(deps);
    controller.onSelectionChanged();
    controller.onSelectionChanged();
    controller.onSelectionChanged();
    expect(deps.schedule).toHaveBeenCalledTimes(1);
    deps.flush();
    // 冲刷后允许下一轮调度
    controller.onSelectionChanged();
    expect(deps.schedule).toHaveBeenCalledTimes(2);
  });

  it("调度窗口内编辑器已销毁时同步静默跳过（flush 晚于实例销毁的竞态）", () => {
    const deps = makeDeps();
    const controller = createViewModes(deps);
    controller.toggleFocus();
    deps.getEditor = vi.fn(() => undefined);
    deps.writeConfig.mockClear();
    controller.onSelectionChanged();
    expect(() => deps.flush()).not.toThrow();
    expect(deps.writeConfig).not.toHaveBeenCalled();
  });
});

describe("useViewModes 单例装配（真实接线：订阅/偏好 watch/微任务对账）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetViewModesForTest();
    mocks.selectionCb = undefined;
  });

  afterEach(() => {
    resetViewModesForTest();
  });

  it("多次调用复用同一实例（与 useSourceMode 同形态的模块级单例）", () => {
    expect(useViewModes()).toBe(useViewModes());
    // 装配时向 01 门面登记 selectionUpdated 订阅（对账信号源）
    expect(editorManager.subscribeSelectionUpdated).toHaveBeenCalledOnce();
  });

  it("selectionUpdated 事件经微任务对账补齐活跃实例配置（01 门面接线）", async () => {
    const fakeEditor = { tag: "active-editor" } as unknown as Editor;
    vi.mocked(editorManager.getEditor).mockReturnValue(fakeEditor);
    const controller = useViewModes();
    controller.toggleTypewriter();
    vi.mocked(setFocusTypewriterConfig).mockClear();
    // 触发 01 selectionUpdated（标签切换 adopt 快照广播同通道）
    mocks.selectionCb?.();
    await flushMicrotasks();
    // 新实例无配置（getFocusTypewriterConfig mock undefined）→ 整份期望态补齐
    expect(setFocusTypewriterConfig).toHaveBeenCalledWith(fakeEditor, {
      focusEnabled: false,
      typewriterEnabled: true,
      typewriterClickCenter: true,
    });
  });

  it("偏好 watch 即时生效：设置快照变更驱动期望态（AC-M-12 装配链）", async () => {
    const controller = useViewModes();
    const settings = useSettingsStore();
    // 快照直写（updateGui 的 IPC 链路由 10 域自身测试覆盖；此处验证 watch 消费侧）
    settings.gui = {
      ...DEFAULT_SETTINGS,
      appearance: { showStatusBar: true, readingSpeed: 200, typewriterClickCenter: false },
    };
    await Promise.resolve();
    expect(controller.desiredConfig().typewriterClickCenter).toBe(false);
  });

  it("存量缺键回落默认开（watch 载荷 undefined 走 ?? 兜底）", async () => {
    const controller = useViewModes();
    const settings = useSettingsStore();
    // 模拟旧版本快照缺 typewriterClickCenter 键（直接置 gui 触发 merged 重算）
    settings.gui = {
      ...DEFAULT_SETTINGS,
      appearance: { showStatusBar: true, readingSpeed: 200 },
    };
    await Promise.resolve();
    expect(controller.desiredConfig().typewriterClickCenter).toBe(true);
  });
});
