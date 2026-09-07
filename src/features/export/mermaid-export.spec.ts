// mermaid 导出封装测试（vi.mock 隔离真实渲染，单例 initialize 语义）
import { beforeEach, describe, expect, it, vi } from "vitest";

// mock 签名省略形参：render(id, code) 实参运行时被忽略，用例不断言渲染入参
const renderMock = vi.fn(async () => ({ svg: "<svg>ok</svg>" }));
const initializeMock = vi.fn();

vi.mock("mermaid", () => ({
  default: { initialize: initializeMock, render: renderMock },
}));

import { renderMermaidToSvg, resetMermaidForTest } from "./mermaid-export";

describe("renderMermaidToSvg", () => {
  beforeEach(() => {
    renderMock.mockClear();
    initializeMock.mockClear();
    resetMermaidForTest();
  });

  it("首次调用 initialize 一次并返回 SVG", async () => {
    const svg = await renderMermaidToSvg("graph TD; A-->B");
    expect(svg).toBe("<svg>ok</svg>");
    expect(initializeMock).toHaveBeenCalledTimes(1);
    // A.5.11：startOnLoad false + securityLevel strict
    expect(initializeMock).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, securityLevel: "strict" }),
    );
  });

  it("重复调用不再 initialize（单例）", async () => {
    await renderMermaidToSvg("graph TD; A-->B");
    await renderMermaidToSvg("graph TD; A-->C");
    expect(initializeMock).toHaveBeenCalledTimes(1);
  });

  it("渲染失败抛出原始错误（调用方呈现导出失败）", async () => {
    renderMock.mockRejectedValueOnce(new Error("Diagram error"));
    await expect(renderMermaidToSvg("bad")).rejects.toThrow("Diagram error");
  });
});
