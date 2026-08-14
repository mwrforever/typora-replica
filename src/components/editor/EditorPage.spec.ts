// EditorPage 挂载冒烟：MilkdownProvider 集成 + 初始文档渲染 + Front Matter 剥离
import { render, waitFor } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import { editorManager } from "../../services/editor-manager";
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

  it("初始文档含 Front Matter 时仅渲染正文，保存经 getMarkdown 原样回写", async () => {
    const md = "---\ntitle: 元数据\n---\n# FM 剥离后的正文";
    const { container } = render(EditorPage, { props: { initialDoc: md } });

    await waitFor(() => {
      expect(container.querySelector(".milkdown .editor")).toBeInTheDocument();
    });
    const editor = container.querySelector<HTMLElement>(".milkdown .editor");
    // FM 不进文档树：编辑区只渲染剥离后的正文
    expect(editor?.querySelector("h1")?.textContent).toBe("FM 剥离后的正文");
    // adopt 路径登记 FM 内文：序列化回写完整文档（往返一致）
    expect(editorManager.getMarkdown()).toBe(md);
  });

  it("渲染版式容器（800px 居中纸面）", () => {
    const { container } = render(EditorPage, { props: { initialDoc: "" } });
    expect(container.querySelector(".markwell-editor")).toBeInTheDocument();
  });
});
