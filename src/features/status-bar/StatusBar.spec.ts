// StatusBar 组件用例（11 P2）：显隐消费（AC-S3-10，D1 组件内自读设置）/ 字数按钮渲染
// （AC-S3-1 组件面）/ 弹面板开合与四项（AC-S3-2）/ 单位切换（AC-S3-3）/ 选中显示
// （AC-S3-4）/ 侧栏按钮转发（AC-S3-9）。
//
// 交互走 fireEvent（宪法 A.6.4 理由注释）：@testing-library/user-event 未引入本仓
// （避免传递性依赖，SettingsPanel.spec.ts 同口径先例）。
// 查询优先 role > text > data-status-bar-* testid 兜底；断言不存在用 queryBy*。
// mock/构造模式沿 OutlinePanel.spec（vi.hoisted 桩容器 + editorManager 事件桥桩）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/vue";
import { createPinia, setActivePinia } from "pinia";

const h = vi.hoisted(() => ({
  /** fileTree.toggleSidebar 桩（AC-S3-9 转发断言） */
  toggleSidebar: vi.fn(),
  /** editorManager 事件桥桩（useStatusBarData 消费；组件测试不触真实编辑器） */
  docCbs: [] as Array<(doc: unknown) => void>,
  selCbs: [] as Array<(sel: unknown) => void>,
  view: undefined as unknown,
}));

vi.mock("../editor/editor-manager", () => ({
  editorManager: {
    getView: (): unknown => h.view,
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

vi.mock("../file-tree/file-tree-store", () => ({
  // 组件只消费 toggleSidebar（AC-S3-9 转发面）；桩化避免拉入 services/file-io IPC 链
  useFileTreeStore: (): { toggleSidebar: () => void } => ({ toggleSidebar: h.toggleSidebar }),
}));

// 设置 IPC 面 importOriginal 桩化（SettingsPanel.spec 先例）：plugin-store 不进 jsdom，
// DEFAULT_SETTINGS 保留真实值——组件 merged 未装载回落语义（showStatusBar true /
// readingSpeed 200）在测试中直接成立（store.gui 不装载即回落 DEFAULT_SETTINGS）
vi.mock("../../services/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/settings")>();
  return {
    ...actual,
    loadSettings: vi.fn(async () => ({ ...actual.DEFAULT_SETTINGS })),
    updateSettings: vi.fn(async (patch: Record<string, unknown>) => ({
      ...actual.DEFAULT_SETTINGS,
      ...patch,
    })),
  };
});

import StatusBar from "./StatusBar.vue";
import { useStatusBarStore } from "./status-bar-store";
import { useSettingsStore } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../../services/settings";

/**
 * 挂载状态栏：可选注入 appearance 覆盖（写入 store.gui 快照；
 * 未注入即 merged 回落 DEFAULT_SETTINGS：showStatusBar=true、readingSpeed=200）
 */
function renderBar(appearance?: Partial<typeof DEFAULT_SETTINGS.appearance>) {
  if (appearance) {
    const settings = useSettingsStore();
    settings.gui = {
      ...DEFAULT_SETTINGS,
      appearance: { ...DEFAULT_SETTINGS.appearance, ...appearance },
    };
  }
  return render(StatusBar);
}

// 文件级 beforeEach：全部 describe（含 Task 6/7/8 追加）共享桩复位
beforeEach(() => {
  setActivePinia(createPinia());
  h.toggleSidebar.mockClear();
  h.docCbs.length = 0;
  h.selCbs.length = 0;
  h.view = undefined;
});

describe("StatusBar 显隐与字数按钮", () => {
  it("默认设置渲染状态栏且按钮按字数单位显示词数（AC-S3-1 组件面）", () => {
    // 设置未装载（gui undefined）→ merged 回落 DEFAULT_SETTINGS：状态栏默认开（D1 消费点）
    useStatusBarStore().applyDocStats({ words: 3, characters: 8, lines: 1 });
    renderBar();
    expect(screen.getByRole("button", { name: "3 词" })).toBeTruthy();
  });

  it("showStatusBar 关闭时不渲染状态栏（AC-S3-10）", () => {
    renderBar({ showStatusBar: false });
    expect(screen.queryByTestId("status-bar")).toBeNull();
    expect(screen.queryByRole("button", { name: "切换侧栏" })).toBeNull();
  });
});
