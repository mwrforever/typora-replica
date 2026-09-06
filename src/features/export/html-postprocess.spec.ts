// 序列化产物后处理调度测试（渲染器全部注入桩，AC-X1-5 调度逻辑）
import { describe, expect, it } from "vitest";
import { postProcessExportHtml } from "./html-postprocess";

function el(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

const baseHooks = {
  renderMermaid: async (code: string) => `<svg data-code="${code}"></svg>`,
  renderMathBlock: (code: string) => `<span class="katex-block" data-math="${code}"></span>`,
};

describe("postProcessExportHtml", () => {
  it("mermaid 代码围栏替换为 SVG 注入结果（带 mw-* 包装类）", async () => {
    const root = el('<pre><code data-language="mermaid">graph TD</code></pre>');
    await postProcessExportHtml(root, { ...baseHooks });
    expect(root.querySelector("pre")).toBeNull();
    expect(root.querySelector("div.mw-mermaid svg")).not.toBeNull();
  });

  it("LaTeX 代码围栏替换为 KaTeX 渲染产物", async () => {
    const root = el('<pre><code data-language="LaTeX">E=mc^2</code></pre>');
    await postProcessExportHtml(root, { ...baseHooks });
    expect(root.querySelector("pre")).toBeNull();
    expect(root.querySelector(".katex-block")).not.toBeNull();
  });

  it("language 大小写不敏感（latex/LaTeX 均识别）", async () => {
    const root = el('<pre><code data-language="latex">x</code></pre>');
    await postProcessExportHtml(root, { ...baseHooks });
    expect(root.querySelector("[data-math]")).not.toBeNull();
  });

  it("普通代码围栏保持原样", async () => {
    const root = el('<pre><code data-language="ts">const a = 1</code></pre>');
    await postProcessExportHtml(root, { ...baseHooks });
    expect(root.querySelector("pre")).not.toBeNull();
  });

  it("[toc] div 替换为大纲 HTML 并移除 data-node-type", async () => {
    const root = el('<div data-node-type="toc" class="markwell-toc"></div>');
    await postProcessExportHtml(root, { ...baseHooks, outlineHtml: "<nav>目录</nav>" });
    expect(root.querySelector('[data-node-type="toc"]')).toBeNull();
    expect(root.querySelector(".mw-export-toc nav")?.innerHTML).toBe("目录");
  });

  it("outlineHtml 缺省时 [toc] 替换为空占位注释", async () => {
    const root = el('<div data-node-type="toc"></div>');
    await postProcessExportHtml(root, { ...baseHooks });
    expect(root.querySelector('[data-node-type="toc"]')).toBeNull();
  });

  it("plainMode 下包装 div 不带 mw-* 类（C1：AC-X3-1 无包裹类）", async () => {
    const root = el(
      '<pre><code data-language="mermaid">graph TD</code></pre><div data-node-type="toc"></div>',
    );
    await postProcessExportHtml(root, {
      ...baseHooks,
      outlineHtml: "<nav>n</nav>",
      plainMode: true,
    });
    expect(root.innerHTML).not.toContain('class="mw-');
    expect(root.querySelector("svg")).not.toBeNull();
  });
});
