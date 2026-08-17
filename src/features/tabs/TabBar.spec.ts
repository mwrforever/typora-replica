// 标签条组件测试（04：渲染/点击激活/× 关闭/脏标记/可访问性）
//
// 覆盖：全部标签标题渲染 + 激活高亮（aria-selected）+ 脏标记；
// 点击标签 emit activate、点击 × emit close（stop 冒泡不重复 activate）；
// 无激活标签时不高亮任何标签。emit 断言走 @testing-library/vue 的 emitted()。
import { fireEvent, render, screen } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import TabBar from "./TabBar.vue";
import type { TabMeta } from "./tabs-store";

describe("TabBar 标签条", () => {
  const tabs: TabMeta[] = [
    { id: "1", title: "a.md", kind: "file", dirty: false, contentReady: true },
    { id: "2", title: "Untitled 1", kind: "untitled", dirty: true, contentReady: true },
  ];

  it("渲染全部标签标题，激活标签高亮，脏标签带标记", () => {
    const { container } = render(TabBar, { props: { tabs, activeTabId: "1" } });
    expect(screen.getByText("a.md")).toBeInTheDocument();
    expect(screen.getByText("Untitled 1")).toBeInTheDocument();
    const active = container.querySelector(".tab-bar__tab--active") as HTMLElement;
    expect(active.textContent).toContain("a.md");
    // 可访问性：激活标签 aria-selected 恒 true，其余 false
    expect(active).toHaveAttribute("aria-selected", "true");
    expect(container.querySelector(".tab-bar__tab--dirty")).not.toBeNull();
  });

  it("点击标签 emit activate，点击 × emit close 且不重复 activate", async () => {
    const { container, emitted } = render(TabBar, { props: { tabs, activeTabId: "2" } });
    const first = container.querySelector(".tab-bar__tab") as HTMLElement;
    await fireEvent.click(first);
    expect(emitted().activate).toEqual([["1"]]);
    const closeBtn = first.querySelector(".tab-bar__close") as HTMLElement;
    await fireEvent.click(closeBtn);
    // × 的 @click.stop 阻断冒泡：关闭不额外触发 activate
    expect(emitted().close).toEqual([["1"]]);
    expect(emitted().activate).toHaveLength(1);
  });

  it("无激活标签时不高亮任何标签", () => {
    const { container } = render(TabBar, { props: { tabs, activeTabId: undefined } });
    expect(container.querySelector(".tab-bar__tab--active")).toBeNull();
    expect(container.querySelector(".tab-bar__tab")?.getAttribute("aria-selected")).toBe("false");
  });
});
