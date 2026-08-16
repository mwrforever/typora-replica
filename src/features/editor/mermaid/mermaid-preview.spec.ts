// mermaid 预览钩子：语言分发 / 懒加载调用 / 错误降级 / 非 mermaid 透传（100% 覆盖）
import { beforeEach, describe, expect, it, vi } from "vitest";

// 隔离懒加载 chunk：mock mermaid 模块。
// 关键约束（实测确认）：vitest 4 模块运行器下，对 mock 函数调用
// mockImplementation/mockRejectedValueOnce 等「替换实现」方法后，被测模块内后续
// 动态 import("mermaid") 会解析到真实模块（既有注释已声明的编排问题扩大化）。
// 因此 mock 实现固定为「经 hoisted 闭包分发」，用例经 setRenderBehavior 切换行为，
// 不触碰 mock 函数的实现替换 API；用例内也一律不执行 import("mermaid")。
const { mermaidMock, setRenderBehavior } = vi.hoisted(() => {
  let behavior: (code: string) => Promise<{ svg: string }> = (code) =>
    Promise.resolve({
      svg: `<svg data-source="${code.replace(/"/g, "&quot;")}"></svg>`,
    });
  return {
    mermaidMock: {
      initialize: vi.fn(),
      render: vi.fn((_id: string, code: string) => behavior(code)),
    },
    setRenderBehavior: (fn: (code: string) => Promise<{ svg: string }>): void => {
      behavior = fn;
    },
  };
});
vi.mock("mermaid", () => ({ default: mermaidMock }));

import { createMermaidRenderPreview } from "./mermaid-preview";
import { transformLegacyDiagram } from "./legacy-transform";

describe("mermaid 预览钩子", () => {
  const prev = vi.fn(() => "");

  beforeEach(() => {
    vi.clearAllMocks();
    // 还原默认渲染行为（svg 回显输入源码），避免用例间串扰
    setRenderBehavior((code) =>
      Promise.resolve({
        svg: `<svg data-source="${code.replace(/"/g, "&quot;")}"></svg>`,
      }),
    );
  });

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
    const hook = createMermaidRenderPreview(prev);
    const applyFirst = vi.fn();
    hook("mermaid", "graph TD; A-->B", applyFirst);
    await vi.waitFor(() => expect(applyFirst).toHaveBeenCalled());
    const applySecond = vi.fn();
    hook("mermaid", "graph TD; C-->D", applySecond);
    await vi.waitFor(() => expect(applySecond).toHaveBeenCalled());
    const render = mermaidMock.render;
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
    setRenderBehavior(() => Promise.reject(new Error("parse error")));
    const hook = createMermaidRenderPreview(prev);
    const applyPreview = vi.fn();
    expect(() => hook("mermaid", "invalid syntax", applyPreview)).not.toThrow();
    await vi.waitFor(() => expect(applyPreview).toHaveBeenCalled());
    expect(applyPreview).toHaveBeenCalledWith(expect.stringContaining("解析错误"));
  });

  it("FIX-7 重叠渲染：旧代次（慢）结果不覆盖新代次预览", async () => {
    // 编辑图表内容会立即重触发 renderPreview：第一次渲染挂起（慢），
    // 第二次先完成——无代次守卫时旧 SVG 会永久覆盖新预览。
    // 注意：两次 hook 调用之间须让出事件循环——vitest 4 模块运行器对同一 tick
    // 内连续两个动态 import("mermaid") 存在解析到真实模块的编排问题（既有注释
    // 已声明），renderMermaidAsync 内部的动态 import 需要逐个闭合
    const pendingResolvers: Array<(v: { svg: string }) => void> = [];
    setRenderBehavior((code) => {
      if (code.includes("A-->B")) {
        return new Promise<{ svg: string }>((resolve) => pendingResolvers.push(resolve));
      }
      return Promise.resolve({ svg: "<svg>new</svg>" });
    });
    const hook = createMermaidRenderPreview(prev);
    const applyPreview = vi.fn();
    hook("mermaid", "graph TD; A-->B", applyPreview); // 第一次：挂起（慢）
    await new Promise((r) => setTimeout(r, 10)); // 让动态 import 链闭合后再触发第二次
    hook("mermaid", "graph TD; C-->D", applyPreview); // 第二次：立即完成
    await vi.waitFor(() =>
      expect(applyPreview).toHaveBeenCalledWith(expect.stringContaining("new")),
    );
    // 旧代次完成：结果被代次守卫丢弃，不覆盖新预览
    pendingResolvers[0]?.({ svg: "<svg>old</svg>" });
    await new Promise((r) => setTimeout(r, 0));
    expect(applyPreview).not.toHaveBeenCalledWith(expect.stringContaining("old"));
    expect(applyPreview).toHaveBeenCalledTimes(1);
  });

  it("多实例：各自代次独立，互不使对方预览过期（04 P0）", async () => {
    // 04 多标签：每个编辑器实例独立创建预览处理器。旧实现共享模块级 previewGen——
    // 实例 B 触发渲染后实例 A 的未完成代次即被判过期，A 的结果被永久丢弃；
    // 新实现代次 per 实例，两实例的异步渲染各自落地。
    const pendingResolvers: Array<(v: { svg: string }) => void> = [];
    setRenderBehavior((code) => {
      if (code.includes("graph A")) {
        // 实例 A 的渲染挂起（慢），由用例手动放行
        return new Promise<{ svg: string }>((resolve) => pendingResolvers.push(resolve));
      }
      return Promise.resolve({ svg: "<svg>instance-B</svg>" });
    });
    const mkPrev = () => createMermaidRenderPreview((_l, _c, apply) => apply(null));
    const hookA = mkPrev(); // 编辑器实例 A 的预览处理器
    const hookB = mkPrev(); // 编辑器实例 B 的预览处理器
    const applyA = vi.fn();
    const applyB = vi.fn();
    hookA("mermaid", "graph A", applyA); // 实例 A：渲染挂起（慢）
    await new Promise((r) => setTimeout(r, 10)); // 让动态 import 链闭合后再触发实例 B
    hookB("mermaid", "graph B", applyB); // 实例 B：立即完成
    await vi.waitFor(() => expect(applyB).toHaveBeenCalled());
    // 实例 A 的旧代次此刻才完成——per 实例代次下仍落地（旧共享实现下此处恒被丢弃）
    pendingResolvers[0]?.({ svg: "<svg>instance-A</svg>" });
    await vi.waitFor(() => expect(applyA).toHaveBeenCalled());
    expect(applyA).toHaveBeenCalledWith(expect.stringContaining("instance-A"));
  });

  it("FIX-7 重叠渲染：旧代次失败同样不覆盖新代次（错误提示受代次守卫）", async () => {
    // 旧代次（old）渲染挂起、新代次先完成——旧代次随后失败时，错误提示
    // 同样须被代次守卫丢弃（不得用「解析错误」占位覆盖新预览）
    const pendingRejects: Array<(e: Error) => void> = [];
    setRenderBehavior((code) => {
      if (code.includes("old")) {
        return new Promise<{ svg: string }>((_resolve, reject) => pendingRejects.push(reject));
      }
      return Promise.resolve({ svg: "<svg>new</svg>" });
    });
    const hook = createMermaidRenderPreview(prev);
    const applyPreview = vi.fn();
    hook("mermaid", "old syntax", applyPreview); // 第一次：挂起（待手动失败）
    await new Promise((r) => setTimeout(r, 10)); // 让动态 import 链闭合后再触发第二次
    hook("mermaid", "graph TD; C-->D", applyPreview); // 第二次：立即成功
    await vi.waitFor(() =>
      expect(applyPreview).toHaveBeenCalledWith(expect.stringContaining("new")),
    );
    // 旧代次失败：错误提示被代次守卫丢弃（未覆盖新预览）
    pendingRejects[0]?.(new Error("旧代次解析失败"));
    await new Promise((r) => setTimeout(r, 0));
    expect(applyPreview).not.toHaveBeenCalledWith(expect.stringContaining("解析错误"));
    expect(applyPreview).toHaveBeenCalledTimes(1);
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
