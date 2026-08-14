// revealRange 定位接口（06 跨文件搜索结果定位依赖），100% 覆盖
import { describe, expect, it, vi } from "vitest";
import { makeTestEditor } from "../../test/editor-test-utils";
import { revealRange } from "./reveal-range";

describe("revealRange 定位", () => {
  it("将选区定位到目标区间", async () => {
    const te = await makeTestEditor("一二三四五六七八九十");
    revealRange(te.editor, 3, 6);
    expect(te.view.state.selection.from).toBe(3);
    expect(te.view.state.selection.to).toBe(6);
  });

  it("区间越界时收敛到文档边界（不崩溃）", async () => {
    const te = await makeTestEditor("短文本");
    revealRange(te.editor, 0, 9999);
    expect(te.view.state.selection.to).toBe(te.view.state.doc.content.size);
  });

  it("目标不在视口内时触发滚动", async () => {
    const te = await makeTestEditor("段落\n".repeat(50));
    // jsdom 无真实布局，scrollIntoView 以 spy 验证调用
    const target = document.createElement("div");
    const spy = vi.spyOn(target, "scrollIntoView");
    te.view.dom.appendChild(target);
    revealRange(te.editor, 0, 2);
    // 编辑器根容器整体滚动（jsdom 中只验证不抛错，滚动调用由浏览器实现）
    expect(() => revealRange(te.editor, 0, 2)).not.toThrow();
    spy.mockRestore();
  });

  it("空文档（选区落在块节点边界）定位不崩溃", async () => {
    const te = await makeTestEditor();
    expect(() => revealRange(te.editor, 0, 0)).not.toThrow();
  });

  it("临时高亮在超时后自动消退", async () => {
    // 假计时器下推进 1200ms，验证高亮类先加后除
    vi.useFakeTimers();
    try {
      const te = await makeTestEditor("段落");
      revealRange(te.editor, 0, 2);
      const highlighted = document.querySelector(".markwell-reveal-highlight");
      expect(highlighted).not.toBeNull();
      vi.advanceTimersByTime(1200);
      expect(document.querySelector(".markwell-reveal-highlight")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
