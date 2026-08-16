import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/vue";
import OpenQuicklyPanel from "./OpenQuicklyPanel.vue";
import type { QuickItem } from "./fuzzy";

const items: QuickItem[] = [
  { path: "C:/a.md", label: "a", kind: "file", pinned: false },
  { path: "C:/b.md", label: "b", kind: "file", pinned: false },
];

describe("Open Quickly 面板（F11-1/3/4）", () => {
  it("输入过滤 + Enter 选中首项（AC-F11-2/3）", async () => {
    const onSelect = vi.fn();
    const { container } = render(OpenQuicklyPanel, {
      props: { items, onSelect, onClose: () => undefined },
    });
    const input = container.querySelector("input")!;
    await fireEvent.update(input, "b");
    // 过滤后仅 b 项可见
    expect(screen.queryByText("a")).toBeNull();
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("C:/b.md");
  });

  it("无匹配显示空态提示不崩溃（AC-F11-4）", async () => {
    const { container } = render(OpenQuicklyPanel, { props: { items } });
    const input = container.querySelector("input")!;
    await fireEvent.update(input, "zzz");
    expect(screen.getByText(/无匹配结果/)).toBeTruthy();
  });

  it("Escape 关闭", async () => {
    const onClose = vi.fn();
    const { container } = render(OpenQuicklyPanel, {
      props: { items, onSelect: () => undefined, onClose },
    });
    const input = container.querySelector("input")!;
    await fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
