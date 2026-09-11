// AppShell 装配组件测试（12 窗口外壳 W1）：
// AC-M-22（Ctrl+Shift+L 侧栏开合 / Ctrl+Shift+1/2/3 面板切换）/ AC-M-23（宽度拖拽
// 持久化）/ 布局骨架（侧栏容器 v-show 保活语义、中央区标签条、状态栏容器）。
// 组件测试面向用户行为：role 优先（separator 手柄、按钮 tab），结构容器用 testid 兜底；
// 持久化断言 services/settings 层 mock（不绑实现细节）；交互 fireEvent（未引入
// user-event，StatusBar.spec 同口径先例）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/vue";
import { createPinia, setActivePinia } from "pinia";

const h = vi.hoisted(() => ({
  /** editorManager 事件桥桩（StatusBar 装配层/OutlinePanel 消费；不触真实编辑器） */
  docCbs: [] as Array<(doc: unknown) => void>,
  selCbs: [] as Array<(sel: unknown) => void>,
  view: undefined as unknown,
}));

vi.mock("../../features/editor/editor-manager", () => ({
  editorManager: {
    getView: (): unknown => h.view,
    insertMarkdown: vi.fn(),
    subscribeDocUpdated: (cb: (doc: unknown) => void) => {
      h.docCbs.push(cb);
      return () => {
        const i = h.docCbs.indexOf(cb);
        if (i >= 0) h.docCbs.splice(i, 1);
      };
    },
    subscribeSelectionUpdated: (cb: (sel: unknown) => void) => {
      h.selCbs.push(cb);
      return () => {
        const i = h.selCbs.indexOf(cb);
        if (i >= 0) h.selCbs.splice(i, 1);
      };
    },
  },
}));

// 设置 IPC 面 importOriginal 桩化（StatusBar.spec 同款先例）：plugin-store 不进 jsdom，
// DEFAULT_SETTINGS 保留真实值——merged 未装载回落语义（layout.sidebarWidth 260）直接成立
vi.mock("../../services/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/settings")>();
  return {
    ...actual,
    loadSettings: vi.fn(async () => ({ ...actual.DEFAULT_SETTINGS })),
    updateSettings: vi.fn(async () => ({ ...actual.DEFAULT_SETTINGS })),
  };
});

import AppShell from "./AppShell.vue";
import { useSettingsStore } from "../../features/settings/settings-store";
import { useFileTreeStore } from "../../features/file-tree/file-tree-store";
import { updateSettings, DEFAULT_SETTINGS } from "../../services/settings";

/** 渲染外壳：可选注入设置快照（写入 store.gui；未注入即回落 DEFAULT_SETTINGS） */
function renderShell(settings?: Partial<typeof DEFAULT_SETTINGS>) {
  if (settings) {
    useSettingsStore().gui = { ...DEFAULT_SETTINGS, ...settings };
  }
  return render(AppShell);
}

/** 侧栏容器（结构容器非语义 role，testid 兜底——宪法 A.6.4 查询优先级） */
function sidebarContainer(): HTMLElement {
  return document.querySelector<HTMLElement>("[data-testid=sidebar-container]")!;
}

/** 以 Ctrl+Shift 组合派发 window keydown（外壳快捷键注册通道；await 确保 Vue 渲染落地） */
async function fireComboKey(key: string): Promise<void> {
  await fireEvent.keyDown(window, { key, ctrlKey: true, shiftKey: true, cancelable: true });
}

beforeEach(() => {
  setActivePinia(createPinia());
  h.docCbs.length = 0;
  h.selCbs.length = 0;
  h.view = undefined;
  vi.mocked(updateSettings).mockClear();
});

describe("AppShell 布局装配", () => {
  it("默认渲染三区骨架：侧栏容器可见 + 中央区标签条 + 状态栏（P1 布局骨架）", () => {
    renderShell();
    // 侧栏默认可见（03 store.sidebarVisible 默认 true）
    expect(sidebarContainer().style.display).not.toBe("none");
    // 中央区标签条（04 TabBar，role=tablist）与状态栏（11 data-status-bar）就位
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(document.querySelector("[data-status-bar]")).toBeTruthy();
  });

  it("侧栏宽度取设置快照值（AC-M-23 重启恢复的装配呈现）", () => {
    renderShell({ layout: { sidebarWidth: 360 } });
    expect(sidebarContainer().style.width).toBe("360px");
  });
});

describe("AppShell 侧栏开合与面板切换（AC-M-22）", () => {
  it("Ctrl+Shift+L 切换侧栏显隐且容器保活（v-show 不卸载）", async () => {
    renderShell();
    await fireComboKey("l");
    expect(sidebarContainer().style.display).toBe("none");
    expect(sidebarContainer()).toBeInTheDocument(); // v-show：元素仍在文档
    await fireComboKey("l");
    expect(sidebarContainer().style.display).not.toBe("none");
  });

  it("Ctrl+Shift+1/2/3 依次切换大纲/列表/文件面板（激活 tab 跟随）", async () => {
    renderShell();
    await fireComboKey("1");
    expect(screen.getByRole("button", { name: "大纲" }).classList).toContain(
      "sidebar-panel__tab--active",
    );
    await fireComboKey("2");
    expect(screen.getByRole("button", { name: "列表" }).classList).toContain(
      "sidebar-panel__tab--active",
    );
    await fireComboKey("3");
    expect(screen.getByRole("button", { name: "文件" }).classList).toContain(
      "sidebar-panel__tab--active",
    );
  });

  it("隐藏态按面板切换键强制侧栏可见（面板键语义 = 让用户看到目标面板）", async () => {
    renderShell();
    await fireComboKey("l"); // 先隐藏
    expect(sidebarContainer().style.display).toBe("none");
    await fireComboKey("2"); // 切列表面板
    expect(sidebarContainer().style.display).not.toBe("none");
  });

  it("注销后快捷键不再响应（卸载清理，spy 断言 store 动作真实未触发）", async () => {
    const fileTreeStore = useFileTreeStore();
    const toggleSpy = vi.spyOn(fileTreeStore, "toggleSidebar");
    const { unmount } = renderShell();
    unmount();
    // 卸载后派发 Ctrl+Shift+L：监听若未清理会仍调用 store 动作——
    // 以 spy 断言真实不触发（而非仅「派发不抛错」的弱断言）
    await fireComboKey("l");
    expect(toggleSpy).not.toHaveBeenCalled();
    expect(document.querySelector("[data-testid=sidebar-container]")).toBeNull();
  });
});

describe("AppShell 侧栏宽度拖拽（AC-M-23）", () => {
  /** 开启一次拖拽会话（mousedown 起点 0） */
  async function beginDrag(): Promise<void> {
    await fireEvent.mouseDown(screen.getByRole("separator", { name: "调整侧栏宽度" }), {
      clientX: 0,
    });
  }

  it("拖拽实时更新宽度，松开持久化到设置 layout 组（service 层断言）", async () => {
    renderShell(); // 默认宽度 260
    await beginDrag();
    await fireEvent.mouseMove(document, { clientX: 60 });
    expect(sidebarContainer().style.width).toBe("320px"); // 拖拽实时反馈
    await fireEvent.mouseUp(document, { clientX: 60 });
    // 持久化经 10 设置通道（updateGui → services/settings.updateSettings）
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ layout: { sidebarWidth: 320 } }),
    );
  });

  it("拖拽越界收敛到 480 后持久化收敛值（AC-M-23 边界）", async () => {
    renderShell({ layout: { sidebarWidth: 400 } });
    await beginDrag();
    await fireEvent.mouseMove(document, { clientX: 1000 });
    expect(sidebarContainer().style.width).toBe("480px");
    await fireEvent.mouseUp(document, { clientX: 1000 });
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ layout: { sidebarWidth: 480 } }),
    );
  });

  it("未移动直接松开不触发持久化（防无变化写盘）", async () => {
    renderShell();
    await beginDrag();
    await fireEvent.mouseUp(document, { clientX: 0 });
    expect(updateSettings).not.toHaveBeenCalled();
  });
});

describe("AppShell 业务事件上抛", () => {
  it("侧栏新建文件按钮上抛 create-file（App 层菜单装配消费）", async () => {
    const { emitted } = renderShell();
    // 按钮可访问名 = 内容「＋」（title 仅为悬停提示）
    await fireEvent.click(screen.getByRole("button", { name: "＋" }));
    expect(emitted()["create-file"]).toHaveLength(1);
  });
});
