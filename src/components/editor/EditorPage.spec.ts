// EditorPage 挂载冒烟：MilkdownProvider 集成 + 初始文档渲染
import { render, waitFor } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import EditorPage from "./EditorPage.vue";

describe("EditorPage 编辑器宿主", () => {
  it("挂载后渲染 Milkdown 编辑器并展示初始文档", async () => {
    const { container } = render(EditorPage, { props: { initialDoc: "# 欢迎使用 MarkWell" } });

    // Crepe 的 LinkTooltip 常驻渲染一个隐藏 input（隐式 role=textbox），全局 textbox
    // 查询会命中多个元素；改为定位 ProseMirror 编辑区（milkdown core 生成的 .milkdown .editor）
    await waitFor(() => {
      expect(container.querySelector(".milkdown .editor")).toBeInTheDocument();
    });
    const editor = container.querySelector<HTMLElement>(".milkdown .editor");
    // 初始 markdown 被解析为标题节点
    expect(editor?.querySelector("h1")?.textContent).toBe("欢迎使用 MarkWell");
  });

  it("渲染版式容器（800px 居中纸面）", () => {
    const { container } = render(EditorPage, { props: { initialDoc: "" } });
    expect(container.querySelector(".markwell-editor")).toBeInTheDocument();
  });
});
