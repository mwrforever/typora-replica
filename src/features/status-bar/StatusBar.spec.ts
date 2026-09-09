// StatusBar 组件用例（11 P2）：显隐消费（AC-S3-10，D1 组件内自读设置）/ 字数按钮渲染
// （AC-S3-1 组件面）/ 弹面板开合与四项（AC-S3-2）/ 单位切换（AC-S3-3）/ 选中显示
// （AC-S3-4）/ 侧栏按钮转发（AC-S3-9）。
//
// 交互走 fireEvent（宪法 A.6.4 理由注释）：@testing-library/user-event 未引入本仓
// （避免传递性依赖，SettingsPanel.spec.ts 同口径先例）。
// 查询优先 role > text > data-status-bar-* testid 兜底；断言不存在用 queryBy*。
// mock/构造模式沿 OutlinePanel.spec（vi.hoisted 桩容器 + editorManager 事件桥桩）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/vue";
import { flushPromises } from "@vue/test-utils";
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

describe("StatusBar 统计弹面板", () => {
  it("点击字数按钮弹出统计面板并按序渲染四项（AC-S3-2）", async () => {
    renderBar(); // 默认 readingSpeed=200 → ceil(120/200)=1 分钟
    // 先等装配层空门面初始拉取落地（watch immediate → nextTick → 复位全零，AC-S3-7 生产行为；
    // OutlinePanel.spec 同款时序先例），再注入统计——真实链路中文档统计恒来自门面、晚于首拉
    await flushPromises();
    useStatusBarStore().applyDocStats({ words: 120, characters: 456, lines: 7 });
    // 再 flush：等按钮文案按注入值重渲染为「120 词」，方可按可访问名点击
    await flushPromises();
    await fireEvent.click(screen.getByRole("button", { name: "120 词" }));
    const panel = screen.getByRole("dialog", { name: "统计详情" });
    // 四项顺序 = 调研 §2.1 自定：行数/字数/字符数/阅读时间（前三项为单位条目，阅读时间殿后非条目）；
    // 默认单位为字数 → 字数行带 ✓；textContent 原始空白归一后断言
    const unitRows = within(panel)
      .getAllByRole("button")
      .map((b) => b.textContent?.replace(/\s+/g, " ").trim());
    expect(unitRows).toEqual(["行数 7", "✓ 字数 120", "字符数 456"]);
    expect(within(panel).getByText("估计阅读时间 1 分钟")).toBeTruthy();
  });

  it("阅读速度为 0 时不渲染阅读时间行（AC-S3-6 组件面）", async () => {
    useStatusBarStore().applyDocStats({ words: 120, characters: 456, lines: 7 });
    renderBar({ readingSpeed: 0 });
    await fireEvent.click(screen.getByRole("button", { name: "120 词" }));
    const panel = screen.getByRole("dialog", { name: "统计详情" });
    expect(within(panel).queryByText(/估计阅读时间/)).toBeNull();
  });

  it("点击面板外区域关闭面板（click-away，outline 菜单同模式）", async () => {
    renderBar(); // 初始全零：按钮显示「0 词」（AC-S3-8 初始形态的组件呈现）
    await fireEvent.click(screen.getByRole("button", { name: "0 词" }));
    expect(screen.getByRole("dialog", { name: "统计详情" })).toBeTruthy();
    await fireEvent.click(document.body);
    expect(screen.queryByRole("dialog", { name: "统计详情" })).toBeNull();
  });

  it("面板钉住时再点字数按钮关闭面板并解除 click-away 监听（批审 Minor-1：钉面板再点关闭路径）", async () => {
    // 时序沿既有先例：先等装配层空门面初始拉取落地（复位全零），再注入统计
    renderBar();
    await flushPromises();
    useStatusBarStore().applyDocStats({ words: 120, characters: 456, lines: 7 });
    await flushPromises(); // 等按钮文案重渲染为「120 词」方可按可访问名点击
    // 第一次点击：开面板并登记 document 一次性 click-away（togglePanel 开分支）
    await fireEvent.click(screen.getByRole("button", { name: "120 词" }));
    expect(screen.getByRole("dialog", { name: "统计详情" })).toBeTruthy();
    // 第二次点击同一按钮：走 else 分支——closePanel 关面板并解除未消费的 click-away
    // 监听（StatusBar.vue:99 removeEventListener），面板自 @click.stop 不冒泡故不靠 click-away
    await fireEvent.click(screen.getByRole("button", { name: "120 词" }));
    expect(screen.queryByRole("dialog", { name: "统计详情" })).toBeNull();
    // 防误绑：本用例全程未触侧栏按钮，toggleSidebar 桩不应被误触
    expect(h.toggleSidebar).not.toHaveBeenCalled();
  });
});

describe("StatusBar 单位切换与选中显示", () => {
  it("点击面板字符数条目切换默认计数单位且按钮即时跟随（AC-S3-3）", async () => {
    // 先等装配层空门面初始拉取落地（复位全零，T6 时序先例），再注入统计
    renderBar();
    await flushPromises();
    useStatusBarStore().applyDocStats({ words: 120, characters: 456, lines: 7 });
    await flushPromises(); // 等按钮文案按注入值重渲染为「120 词」方可按可访问名点击
    await fireEvent.click(screen.getByRole("button", { name: "120 词" }));
    await fireEvent.click(screen.getByRole("button", { name: "字符数 456" }));
    // 按钮切换为字符数口径；面板保持打开且 ✓ 勾选标记迁移到新单位条目
    expect(screen.getByRole("button", { name: "456 字符" })).toBeTruthy();
    const panel = screen.getByRole("dialog", { name: "统计详情" });
    expect(within(panel).getByRole("button", { name: "✓ 字符数 456" })).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "✓ 字数 120" })).toBeNull();
  });

  it("选中文字时按钮显示选中与总量并排且随单位换算（AC-S3-4，调研自定并排形态）", async () => {
    const store = useStatusBarStore();
    renderBar();
    await flushPromises(); // 首拉落地后再注入统计（T6 时序先例）
    store.applyDocStats({ words: 120, characters: 456, lines: 7 });
    store.applySelectionStats({ words: 2, characters: 4, lines: 1 });
    await flushPromises(); // 等按钮文案重渲染为选中形态
    // 默认字数单位：两个 N 均为词口径（N 单位 = 当前默认计数单位，本计划口径定稿）
    expect(screen.getByRole("button", { name: "选中 2 / 总 120" })).toBeTruthy();
    // 经面板切到字符数单位后两个 N 同步换算为字符口径
    await fireEvent.click(screen.getByRole("button", { name: "选中 2 / 总 120" }));
    await fireEvent.click(screen.getByRole("button", { name: "字符数 456" }));
    expect(screen.getByRole("button", { name: "选中 4 / 总 456" })).toBeTruthy();
  });

  it("清除选区恢复全量计数显示", async () => {
    const store = useStatusBarStore();
    renderBar();
    await flushPromises(); // 首拉落地后再注入统计（T6 时序先例）
    store.applyDocStats({ words: 120, characters: 456, lines: 7 });
    store.applySelectionStats({ words: 2, characters: 4, lines: 1 });
    await flushPromises();
    expect(screen.getByRole("button", { name: "选中 2 / 总 120" })).toBeTruthy();
    store.applySelectionStats(undefined); // 光标/取消选中（装配层清除通道）
    await flushPromises(); // 等按钮文案回落全量口径后断言
    expect(screen.getByRole("button", { name: "120 词" })).toBeTruthy();
  });
});

describe("StatusBar 侧栏开关转发", () => {
  it("点击侧栏开关按钮转发 fileTree.toggleSidebar（AC-S3-9，渲染归 11 逻辑转发 03/12）", async () => {
    renderBar();
    await fireEvent.click(screen.getByRole("button", { name: "切换侧栏" }));
    expect(h.toggleSidebar).toHaveBeenCalledTimes(1);
  });
});
