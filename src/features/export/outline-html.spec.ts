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

  it("跳级缺档（h1 直跳 h3）平铺降级两条目均输出且配对完整", () => {
    const gapped: HeadingInfo[] = [
      { id: "h1", level: 1, text: "一级", pos: 0 },
      { id: "h3", level: 3, text: "三级", pos: 1 },
    ];
    const html = buildOutlineHtml(gapped, true);
    expect(html).toContain('<a href="#h1">一级</a>');
    expect(html).toContain('<a href="#h3">三级</a>');
    expect(html.match(/<a /g)!.length).toBe(html.match(/<\/a>/g)!.length);
    expect(html.match(/<ul>/g)!.length).toBe(html.match(/<\/ul>/g)!.length);
    expect(html.match(/<li>/g)!.length).toBe(html.match(/<\/li>/g)!.length);
  });

  it("锚点 id 含引号/尖括号时转义，href 属性不可被逃逸注入（批1 R1 回归）", () => {
    // slugOf 保留引号/尖括号（typora-heading-id.ts），含引号标题的 id 若零转义
    // 拼 href 会提前闭合属性注入事件处理器
    const malicious: HeadingInfo[] = [
      { id: 'a" onclick="alert(1)', level: 1, text: "A", pos: 0 },
      { id: "b>c", level: 2, text: "B", pos: 1 },
    ];
    const html = buildOutlineHtml(malicious, true);
    // id 内引号已转义为 &quot;，属性值无法提前闭合
    expect(html).toContain('href="#a&quot; onclick=&quot;alert(1)"');
    expect(html).not.toContain('onclick="alert(1)"');
    // 尖括号转义为 &gt;，不产生畸形标签
    expect(html).toContain('href="#b&gt;c"');
    expect(html).not.toContain('href="#b>c"');
  });

  it("plainMode=true 时 nav 为裸标签（无 class 属性，AC-X3-1 无包裹类）", () => {
    const html = buildOutlineHtml(headings, false, true);
    expect(html).not.toContain("class=");
    expect(html).toContain("<nav>");
    expect(html).toContain('<a href="#h1-a">第一章</a>'); // 大纲内容语义不变
  });

  it("plainMode=true 空大纲同样输出裸 nav（早退分支同规则）", () => {
    const html = buildOutlineHtml([], false, true);
    expect(html).not.toContain("class=");
    expect(html).toContain("<nav>");
  });

  it("plainMode 缺省（两参调用）保持既有带类形态（向后兼容）", () => {
    expect(buildOutlineHtml(headings, false)).toContain('class="mw-export-outline"');
    expect(buildOutlineHtml([], false)).toContain('class="mw-export-outline"');
  });
});
