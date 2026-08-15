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
