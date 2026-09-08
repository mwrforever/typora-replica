// 偏好面板组件测试（AC-S1-1 七分区 / AC-S1-2 Ctrl+F 过滤 / AC-S1-3 绑定持久化 /
// AC-S1-4 云上传占位禁用 / AC-S1-5 重启生效徽标）
//
// 交互走 fireEvent（含 v-model 专用 update：select 派发 change / checkbox 置 checked
// 派发 change / 文本派发 input）：@testing-library/user-event 未引入本仓（避免传递性
// 依赖，tabs-shortcuts.spec.ts 同口径先例——宪法 A.6.4 fireEvent 须注释理由）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { createPinia, setActivePinia } from "pinia";

// —— 依赖桩：store 插件 / 高级设置 IPC / 主题列表（IPC 面全部桩化，组件行为面直测）——
const memory = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../../services/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/settings")>();
  return {
    ...actual,
    loadSettings: vi.fn(async () => ({ ...actual.DEFAULT_SETTINGS })),
    updateSettings: vi.fn(async (patch: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(patch)) memory.set(k, v);
      // markdown 组按服务层契约深合并（codeFence 子组必须保留——面板 codeFence 绑定
      // 依赖该形状；真实 updateSettings 的深合并行为已由 services/settings.spec 验证）
      const base = actual.DEFAULT_SETTINGS;
      const markdownPatch = patch.markdown as Partial<typeof base.markdown> | undefined;
      return {
        ...base,
        ...patch,
        markdown: {
          ...base.markdown,
          ...markdownPatch,
          codeFence: { ...base.markdown.codeFence, ...markdownPatch?.codeFence },
        },
      };
    }),
  };
});
vi.mock("../../services/advanced-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/advanced-settings")>();
  return {
    ...actual,
    readAdvancedSettings: vi.fn(async () => ({ ...actual.DEFAULT_ADVANCED_SETTINGS })),
    writeAdvancedSetting: vi.fn(async () => undefined),
    resetAdvancedSettings: vi.fn(async () => undefined),
    openAdvancedSettings: vi.fn(async () => undefined),
  };
});
vi.mock("../../services/theme-io", () => ({
  listThemes: vi.fn(async () => ({
    dir: "D:/themes",
    themes: [
      {
        name: "markwell-light",
        fileName: "markwell-light.css",
        label: "Markwell Light",
        hasUserCss: false,
      },
      {
        name: "markwell-dark",
        fileName: "markwell-dark.css",
        label: "Markwell Dark",
        hasUserCss: false,
      },
    ],
    hasBaseUserCss: false,
  })),
  openThemeFolder: vi.fn(async () => undefined),
}));

import SettingsPanel from "./SettingsPanel.vue";
import { useSettingsStore } from "./settings-store";
import { writeAdvancedSetting } from "../../services/advanced-settings";

/**
 * 装配辅助：预装载 store 后渲染面板，返回 store 供绑定断言。
 * 分区表单仅在 gui 装载完成后渲染（模板 v-else-if="store.gui"），故必须先 load 再 render；
 * await 到 render 返回保证窗口监听（Ctrl+F）与 DOM 就绪。
 */
async function renderPanel() {
  const store = useSettingsStore();
  await store.load();
  store.open();
  return { store, ...render(SettingsPanel) };
}

beforeEach(() => {
  setActivePinia(createPinia());
  memory.clear();
});

describe("面板骨架与导航（AC-S1-1）", () => {
  it("渲染 7 分区导航项，默认激活 General；Save & Recover 锚点仍落在 General 表单", async () => {
    await renderPanel();
    const nav = screen.getByRole("navigation", { name: "设置分区" });
    expect(nav.querySelectorAll("button")).toHaveLength(7);
    expect(screen.getByRole("heading", { name: "General" })).toBeTruthy();
    // Save & Recover 是 General 内部区（锚点按钮切到 General 并滚动定位，非独立分区）
    await fireEvent.click(screen.getByRole("button", { name: "Save & Recover" }));
    expect(screen.getByRole("heading", { name: "General" })).toBeTruthy();
  });
});

describe("面板内 Ctrl+F 搜索（AC-S1-2）", () => {
  it("Ctrl+F 聚焦搜索框，输入关键词后展示匹配结果并隐藏分区表单，点击结果跳转分区", async () => {
    await renderPanel();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true }));
    const input = screen.getByRole("textbox", { name: "搜索设置项" });
    expect(input).toHaveFocus();
    await fireEvent.update(input, "行内数学");
    // 命中结果出现（结果行），分区表单隐藏
    expect(screen.getByText("行内数学公式")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "General" })).toBeNull();
    // 点击结果跳转对应分区（清空搜索恢复表单态）
    await fireEvent.click(screen.getByText("行内数学公式"));
    expect(screen.getByRole("heading", { name: "Markdown" })).toBeTruthy();
  });
});

describe("面板隐藏时的键盘行为（批1 审查 M1：visible 守卫）", () => {
  it("面板隐藏时 Ctrl+F 不被面板拦截（不 preventDefault，让位编辑器搜索）", async () => {
    const store = useSettingsStore();
    await store.load();
    render(SettingsPanel); // 刻意不 open：面板保持隐藏
    const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("面板可见时 Ctrl+F 被面板接管（preventDefault 并聚焦搜索框）", async () => {
    await renderPanel();
    const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole("textbox", { name: "搜索设置项" })).toHaveFocus();
  });
});

describe("禁用占位与徽标（AC-S1-4 / AC-S1-5）", () => {
  it("Image 分区上传器占位禁用并显示原因（AC-S1-4）", async () => {
    await renderPanel();
    await fireEvent.click(screen.getByRole("button", { name: "Image" }));
    const select = await screen.findByRole("combobox", { name: "图片上传器" });
    expect(select).toBeDisabled();
    expect(screen.getByText("云上传首版未开放")).toBeTruthy();
  });

  it("Markdown 分区行内数学行渲染「重启生效」徽标（AC-S1-5）", async () => {
    await renderPanel();
    await fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    const row = await screen.findByTestId("setting-row-markdown.inline-math");
    expect(row.textContent).toContain("重启生效");
  });
});

describe("设置项绑定（AC-S1-3 面板面）", () => {
  it("General 启动行为选择变更即持久化（updateGui 链路）", async () => {
    const { store } = await renderPanel();
    const select = screen.getByRole("combobox", { name: "启动行为" });
    await fireEvent.update(select, "custom-folder");
    await waitFor(() => expect(memory.get("launch")).toMatchObject({ mode: "custom-folder" }));
    expect(store.gui?.launch.mode).toBe("custom-folder");
  });

  it("Markdown 行内数学开关切换即持久化", async () => {
    await renderPanel();
    await fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    const checkbox = screen.getByRole("checkbox", { name: "行内数学公式" });
    // 点击切开关（jsdom 点击激活行为：checked 翻转并派发 change——v-model checkbox 通道）；
    // 默认关 → 开，断言写回持久层的组内增量
    await fireEvent.click(checkbox);
    await waitFor(() => expect(memory.get("markdown")).toMatchObject({ inlineMath: true }));
  });

  it("Export 导出项管理：新增自定义项出现在列表（09 store 实体复用）", async () => {
    await renderPanel();
    await fireEvent.click(screen.getByRole("button", { name: "Export" }));
    const input = screen.getByRole("textbox", { name: "新导出项名称" });
    await fireEvent.update(input, "归档格式");
    await fireEvent.click(screen.getByRole("button", { name: "添加导出项" }));
    expect(screen.getByText("归档格式")).toBeTruthy();
  });
});

describe("数字输入清空收口（批1 审查 M2：空串禁止穿透 number 契约）", () => {
  it("Save & Recover 保存间隔清空后回写默认 5 分钟（conf 双写同收口）", async () => {
    await renderPanel();
    await fireEvent.click(screen.getByRole("button", { name: "Save & Recover" }));
    const input = screen.getByRole("spinbutton", { name: "保存间隔（分钟）" });
    await fireEvent.update(input, "");
    await waitFor(() =>
      expect(vi.mocked(writeAdvancedSetting)).toHaveBeenCalledWith("autoSaveTimer", 5),
    );
    await waitFor(() => expect(memory.get("autoSave")).toMatchObject({ timerMinutes: 5 }));
  });

  it("Appearance 阅读速度清空后回写默认 200 词/分钟", async () => {
    await renderPanel();
    await fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    const input = screen.getByRole("spinbutton", { name: "阅读速度" });
    await fireEvent.update(input, "");
    await waitFor(() => expect(memory.get("appearance")).toMatchObject({ readingSpeed: 200 }));
  });

  it("Markdown 代码块缩进宽度清空后回写默认 4 空格（codeFence 子组保留）", async () => {
    await renderPanel();
    await fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    const input = screen.getByRole("spinbutton", { name: "代码块缩进宽度" });
    await fireEvent.update(input, "");
    await waitFor(() =>
      expect(memory.get("markdown")).toMatchObject({ codeFence: { indentWidth: 4 } }),
    );
  });

  it("Export PDF 页边距清空后回写默认 0.4 英寸", async () => {
    await renderPanel();
    await fireEvent.click(screen.getByRole("button", { name: "Export" }));
    const input = screen.getByRole("spinbutton", { name: "PDF 页边距（英寸）" });
    await fireEvent.update(input, "");
    await waitFor(() => expect(memory.get("export")).toMatchObject({ pdfMarginIn: 0.4 }));
  });
});
