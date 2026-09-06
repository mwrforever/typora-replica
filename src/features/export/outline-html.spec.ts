// 导出大纲 HTML 构建测试（AC-X1-2 形态跟随 Flat/Collapsible）
import { describe, expect, it } from "vitest";
import { buildOutlineHtml } from "./outline-html";
import type { HeadingInfo } from "../editor/heading-collect";

const headings: HeadingInfo[] = [
  { id: "h1-a", level: 1, text: "第一章", pos: 0 },
  { id: "h2-a", level: 2, text: "小节", pos: 10 },
  { id: "h1-b", level: 1, text: "第二章", pos: 20 },
];

describe("buildOutlineHtml", () => {
  it("Flat 形态输出平铺 li 列表（锚点 href=#id）", () => {
    const html = buildOutlineHtml(headings, false);
    expect(html).toContain('<nav class="mw-export-outline"');
    expect(html).toContain('<a href="#h1-a">第一章</a>');
    expect(html).toContain('<a href="#h1-b">第二章</a>');
    expect(html.match(/<ul>/g)).toHaveLength(1);
  });

  it("Collapsible 形态按标题层级嵌套 ul", () => {
    const html = buildOutlineHtml(headings, true);
    expect(html.match(/<ul>/g)!.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('<a href="#h2-a">小节</a>');
  });

  it("空大纲输出空 nav（无 ul）", () => {
    const html = buildOutlineHtml([], false);
    expect(html).toContain('<nav class="mw-export-outline"');
    expect(html).not.toContain("<ul>");
  });

  it("三层嵌套正确闭合（a/ul/li 全配对，M-E 断言）", () => {
    const deep: HeadingInfo[] = [
      { id: "a", level: 1, text: "A", pos: 0 },
      { id: "b", level: 2, text: "B", pos: 1 },
      { id: "c", level: 3, text: "C", pos: 2 },
      { id: "a2", level: 1, text: "A2", pos: 3 },
    ];
    const html = buildOutlineHtml(deep, true);
    // 全元素配对（畸形开标签在此必暴露）
    expect(html.match(/<a /g)!.length).toBe(html.match(/<\/a>/g)!.length);
    expect(html.match(/<ul>/g)!.length).toBe(html.match(/<\/ul>/g)!.length);
    expect(html.match(/<li>/g)!.length).toBe(html.match(/<\/li>/g)!.length);
    expect(html).toContain('<a href="#c">C</a>');
  });
});
