// EditorPage 挂载冒烟：MilkdownProvider 集成 + 初始文档渲染 + Front Matter 剥离
import { render, waitFor } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import { editorManager } from "../../features/editor/editor-manager";
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

  it("passive 模式：不 adopt 进门面，实例经 onInstanceReady 上缴（04 多标签）", async () => {
    // 用例间清态：editorManager 为模块级单例，前一用例已 adopt——destroy 幂等
    editorManager.destroy();
    const ready: Array<{ crepe: unknown; frontMatter: string | null }> = [];
    render(EditorPage, {
      props: {
        initialDoc: "---\ntitle: 元数据\n---\n# FM 剥离后的正文",
        adopt: false,
        onInstanceReady: (inst) => ready.push(inst),
      },
    });
    await waitFor(() => {
      expect(ready).toHaveLength(1);
    });
    // 上缴载荷携带工厂解析出的 FM 内文（不含定界符，与 adopt/getMarkdownFor 约定一致：
    // 注册表保存时经 getMarkdownFor 原样回写定界符）
    expect(ready[0].frontMatter).toBe("title: 元数据");
    // 门面未被 adopt：实例归回调方（tabs 注册表）管理，门面为空态
    expect(editorManager.getCrepe()).toBeUndefined();
  });

  it("渲染版式容器（800px 居中纸面）", () => {
    const { container } = render(EditorPage, { props: { initialDoc: "" } });
    expect(container.querySelector(".markwell-editor")).toBeInTheDocument();
  });
});
