// CSS 内联构建测试（AC-X1-1 内嵌样式 / AC-X2 PDF @page）
import { describe, expect, it, vi } from "vitest";
import { A4_SIZE_IN, buildPdfPageCss, buildStyleBlock } from "./css-inline";

// Vitest 默认 stub 掉 CSS 导入（?raw 按扩展名命中空模块，实测返回空串），
// 生产构建经 Vite ?raw 返回真实 katex.min.css——此处以桩内容固定「KaTeX 层
// 参与合并」契约；断言关注层合并行为而非 KaTeX 文件本身内容
vi.mock("katex/dist/katex.min.css?raw", () => ({
  default: ".katex-display { display: block; }",
}));

describe("buildStyleBlock", () => {
  it("拼接导出专用 CSS + KaTeX CSS + 主题文本为单个 style 块", () => {
    const out = buildStyleBlock({ themeCss: ".theme-x { color: red }" });
    expect(out.startsWith("<style>")).toBe(true);
    expect(out.endsWith("</style>")).toBe(true);
    expect(out).toContain(".theme-x");
    expect(out).toContain(".katex"); // KaTeX CSS 内联
    expect(out).toContain("mw-export-body"); // 导出专用段
  });

  it("无主题文本时其余两层照常内联", () => {
    const out = buildStyleBlock({});
    expect(out).toContain(".katex");
    expect(out).toContain("mw-export-body");
  });

  it("暗色标记段随 darkMode 注入（AC-X2-4 前置）", () => {
    const out = buildStyleBlock({ darkMode: true });
    expect(out).toContain(".markwell-dark");
  });

  it("暗色未开启时无 markwell-dark 段", () => {
    expect(buildStyleBlock({})).not.toContain(".markwell-dark");
  });
});

describe("buildPdfPageCss", () => {
  it("页眉页脚变量替换进 @page margin boxes（AC-X2-2；相邻字符串 token 已合并）", () => {
    const out = buildPdfPageCss({
      header: "${title} · 第 ${pageNo} 页",
      footer: "${pageCount}",
      title: "手册",
      breakH1: false,
    });
    expect(out).toContain("@top-center");
    expect(out).toContain('"手册 · 第 " counter(page) " 页"');
    expect(out).toContain("@bottom-center");
    expect(out).toContain("counter(pages)");
  });

  it("h1 分页开关注入 break-before（AC-X2-3）+ 首个 h1 豁免", () => {
    const out = buildPdfPageCss({
      header: undefined,
      footer: undefined,
      title: "t",
      breakH1: true,
    });
    expect(out).toContain("break-before: page");
    expect(out).toContain("h1:first-child");
  });

  it("无页眉页脚时不产出 margin boxes（默认空，用户实测回填）", () => {
    const out = buildPdfPageCss({
      header: undefined,
      footer: undefined,
      title: "t",
      breakH1: false,
    });
    expect(out).not.toContain("@top-center");
    expect(out).not.toContain("@bottom-center");
  });

  it("页眉页脚空串与 undefined 同路径（不产出 margin boxes）", () => {
    const out = buildPdfPageCss({ header: "", footer: "", title: "t", breakH1: false });
    expect(out).not.toContain("@top-center");
    expect(out).not.toContain("@bottom-center");
  });

  it("页眉空串页脚有效时仅产出页脚 margin box（短路组合）", () => {
    const out = buildPdfPageCss({
      header: "",
      footer: "第 ${pageNo} 页",
      title: "t",
      breakH1: false,
    });
    expect(out).not.toContain("@top-center");
    expect(out).toContain("@bottom-center");
    expect(out).toContain("counter(page)");
  });

  it("content 字符串转义控制字符（CSS 字符串中裸换行破坏语法）", () => {
    const out = buildPdfPageCss({
      header: "a\rb\nc",
      footer: undefined,
      title: "t",
      breakH1: false,
    });
    expect(out).toContain('"a\\rb\\nc"');
  });

  it("A4 尺寸常量（英寸，WebView2 PrintSettings 单位）", () => {
    expect(A4_SIZE_IN.widthIn).toBeCloseTo(8.27);
    expect(A4_SIZE_IN.heightIn).toBeCloseTo(11.69);
  });
});
