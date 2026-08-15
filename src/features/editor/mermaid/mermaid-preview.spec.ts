// mermaid 预览钩子：语言分发 / 懒加载调用 / 错误降级 / 非 mermaid 透传（100% 覆盖）
import { beforeEach, describe, expect, it, vi } from "vitest";

// 隔离懒加载 chunk：mock mermaid 模块（工厂级 mock，动态 import 同样被拦截）
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, code: string) => ({
      svg: `<svg data-source="${code.replace(/"/g, "&quot;")}"></svg>`,
    })),
  },
}));

import { createMermaidRenderPreview } from "./mermaid-preview";
import { transformLegacyDiagram } from "./legacy-transform";

describe("mermaid 预览钩子", () => {
  const prev = vi.fn(() => "");

  beforeEach(() => vi.clearAllMocks());

  it("AC-E21-1 language=mermaid 时返回占位并异步 applyPreview 渲染结果", async () => {
    const hook = createMermaidRenderPreview(prev);
    const applyPreview = vi.fn();
    const out = hook("mermaid", "graph TD; A-->B", applyPreview);
    expect(out).toContain("渲染中");
    await vi.waitFor(() => expect(applyPreview).toHaveBeenCalled());
    expect(applyPreview).toHaveBeenCalledWith(expect.stringContaining("<svg"));
  });

  it("AC-E21-4 legacy sequence 转换后交给 mermaid 渲染", async () => {
    const hook = createMermaidRenderPreview(prev);
    const applyPreview = vi.fn();
    hook("sequence", "A->B: hi", applyPreview);
    await vi.waitFor(() => expect(applyPreview).toHaveBeenCalled());
    const html = applyPreview.mock.calls[0][0] as string;
    expect(html).toContain("sequenceDiagram");
  });

  it("多图表文档：两次渲染的 id 必须不同（固定 id 会被 mermaid render 按 id 互删 SVG）", async () => {
    // mermaid 11.16.1 的 render 内部会 removeExistingElements(document, id)，把文档中
    // 同名旧 SVG 移除——固定 id 时第二个图表渲染会删掉第一个图表的预览；自增唯一 id 隔离。
    // 两次渲染串行触发（vitest 模块运行器对 factory mock 的并发动态 import 会解析到真实
    // 模块——测试环境编排问题，与本次修复无关，真实应用内渲染本就逐次发生）
    const hook = createMermaidRenderPreview(prev);
    const applyFirst = vi.fn();
    hook("mermaid", "graph TD; A-->B", applyFirst);
    await vi.waitFor(() => expect(applyFirst).toHaveBeenCalled());
    const applySecond = vi.fn();
    hook("mermaid", "graph TD; C-->D", applySecond);
    await vi.waitFor(() => expect(applySecond).toHaveBeenCalled());
    const render = vi.mocked((await import("mermaid")).default.render);
    expect(render).toHaveBeenCalledTimes(2);
    const id1 = render.mock.calls[0][0];
    const id2 = render.mock.calls[1][0];
    // 两次渲染 id 不同，且按 markwell-mermaid-N 自增形态生成
    expect(id1).toMatch(/^markwell-mermaid-\d+$/);
    expect(id2).toMatch(/^markwell-mermaid-\d+$/);
    expect(id1).not.toBe(id2);
  });

  it("legacy flow 转换后交给 mermaid 渲染（flowchart 头部注入）", async () => {
    const hook = createMermaidRenderPreview(prev);
    const applyPreview = vi.fn();
    hook("flow", "st=>start: S", applyPreview);
    await vi.waitFor(() => expect(applyPreview).toHaveBeenCalled());
    const html = applyPreview.mock.calls[0][0] as string;
    expect(html).toContain("flowchart TD");
  });

  it("AC-E21-3 mermaid 渲染失败时 applyPreview 错误提示而非崩溃", async () => {
    const mermaidMod = await import("mermaid");
    vi.mocked(mermaidMod.default.render).mockRejectedValueOnce(new Error("parse error"));
    const hook = createMermaidRenderPreview(prev);
    const applyPreview = vi.fn();
    expect(() => hook("mermaid", "invalid syntax", applyPreview)).not.toThrow();
    await vi.waitFor(() => expect(applyPreview).toHaveBeenCalled());
    expect(applyPreview).toHaveBeenCalledWith(expect.stringContaining("解析错误"));
  });

  it("非 mermaid 语言透传给前序 renderPreview", () => {
    const hook = createMermaidRenderPreview(prev);
    hook("latex", "E=mc^2", vi.fn());
    expect(prev).toHaveBeenCalledWith("latex", "E=mc^2", expect.any(Function));
  });

  it("mermaid 语言空内容不渲染", () => {
    const hook = createMermaidRenderPreview(prev);
    expect(hook("mermaid", "", vi.fn())).toBe("");
  });

  it("transformLegacyDiagram 与钩子联动：flow legacy 输入被转换", () => {
    expect(transformLegacyDiagram("flow", "st=>start: S")).toContain("flowchart");
  });
});
