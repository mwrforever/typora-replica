// SourceModeLayer 组件测试（12 W4；AC-M-6：切入显示 markdown 源码 + 语法高亮）
//
// 01 依赖模块整体 mock（与 source-mode.spec 单例装配段同口径）；断言面向用户
// 可见行为：CM 内容区渲染源码全文、高亮 token（CM 生成高亮类，e6-code-fence
// 同款判定）、越界行列收敛、暗色重配不崩溃。
import { nextTick } from "vue";
import { render } from "@testing-library/vue";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../editor/editor-manager", () => ({
  editorManager: {
    getEditor: vi.fn(() => ({})),
    getMarkdown: vi.fn(() => "# 单例文档\n\n正文"),
    setContent: vi.fn(),
    getView: vi.fn(() => undefined),
    adopt: vi.fn(),
    subscribeMarkdownUpdated: vi.fn(() => vi.fn()),
  },
}));
vi.mock("../editor/source-pos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../editor/source-pos")>()),
  pmPosToLineCol: vi.fn(() => ({ line: 0, col: 0 })),
  lineColToPmPos: vi.fn(() => 0),
}));
vi.mock("../editor/reveal-range", () => ({ revealRange: vi.fn() }));

import SourceModeLayer from "./SourceModeLayer.vue";
import { resetSourceModeForTest, useSourceMode } from "./source-mode";
import { useThemeStore } from "../theme/theme-store";
import { pmPosToLineCol } from "../editor/source-pos";

beforeEach(() => {
  setActivePinia(createPinia());
  resetSourceModeForTest();
});

afterEach(() => {
  resetSourceModeForTest();
});

describe("SourceModeLayer（AC-M-6 源码模式视图层）", () => {
  it("挂载创建 CodeMirror 实例并上缴宿主（双实例保活的源码侧）", () => {
    render(SourceModeLayer);
    expect(document.querySelector(".cm-editor")).toBeTruthy();
  });

  it("卸载注销宿主并销毁 CM 实例（不留僵尸视图）", () => {
    const { unmount } = render(SourceModeLayer);
    expect(document.querySelector(".cm-editor")).toBeTruthy();
    unmount();
    expect(document.querySelector(".cm-editor")).toBeNull();
  });

  it("切入后源码层显示当前文档 markdown 全文（CM 内容区渲染）", async () => {
    render(SourceModeLayer);
    const sm = useSourceMode();
    expect(sm.enter()).toBe(true);
    await vi.waitFor(() => {
      // CM 以 .cm-line 块级元素逐行渲染（换行不在 textContent 中）
      const lines = [...document.querySelectorAll(".cm-line")].map((el) => el.textContent);
      expect(lines).toEqual(["# 单例文档", "", "正文"]);
    });
  });

  it("markdown 语法高亮 token 渲染（语言扩展生效）", async () => {
    render(SourceModeLayer);
    const sm = useSourceMode();
    expect(sm.enter()).toBe(true);
    // CM 高亮 token 以生成类名前缀 ͼ 渲染（e6-code-fence.spec 同款判定）
    await vi.waitFor(() => {
      expect(document.querySelector(".cm-content span[class^='ͼ']")).not.toBeNull();
    });
  });

  it("宿主 load 越界行列收敛（近似映射下防 CM dispatch 抛错）", () => {
    vi.mocked(pmPosToLineCol).mockReturnValue({ line: 99, col: 99 });
    render(SourceModeLayer);
    const sm = useSourceMode();
    // 切入装载即走宿主 load：越界行列被收敛到末行，切入不抛错
    expect(() => sm.enter()).not.toThrow();
    const lines = [...document.querySelectorAll(".cm-line")].map((el) => el.textContent);
    expect(lines).toEqual(["# 单例文档", "", "正文"]);
  });

  it("切出经宿主读回全文与光标（AC-M-7/8 组件级接线：真实 CM 读数链）", () => {
    render(SourceModeLayer);
    const sm = useSourceMode();
    expect(sm.enter()).toBe(true);
    // 切出走宿主 getText/getCursor（内容未变更不回写，仅光标恢复）
    expect(sm.exit()).toBe(true);
    expect(sm.active.value).toBe(false);
  });

  it("系统色系切换重配主题 compartment（暗色适配不崩溃）", async () => {
    render(SourceModeLayer);
    const theme = useThemeStore();
    theme.systemDark = true;
    await nextTick();
    expect(document.querySelector(".cm-editor")).toBeTruthy();
  });
});
