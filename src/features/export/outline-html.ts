// 导出大纲 HTML 构建（09 X1 Include Outline / [toc] 替换共用）
//
// 锚点 id 直接消费 collectHeadings 的 attrs.id（与编辑器内锚点插件同源），
// 导出 HTML 的页内跳转与编辑器侧跳转目标一致。
// Collapsible 形态 = 按标题层级递归嵌套 ul/li（导出为静态 HTML，无折叠交互）。
import type { HeadingInfo } from "../editor/heading-collect";

/**
 * 构建导出大纲 HTML
 * @param headings 标题条目（文档序，collectHeadings 产物）
 * @param collapsible true = Collapsible 嵌套形态；false = Flat 平铺
 * @returns nav 元素 HTML（调用方原样拼入 body）；空大纲返回不含 ul 的空 nav
 */
export function buildOutlineHtml(headings: HeadingInfo[], collapsible: boolean): string {
  // 空大纲早退：不渲染空 ul（调用方拼接后不产生空列表语义）
  if (headings.length === 0) {
    return `<nav class="mw-export-outline">\n</nav>`;
  }
  const items = collapsible ? buildLevel(headings, 1).html : buildFlat(headings);
  return `<nav class="mw-export-outline">\n<ul>\n${items}</ul>\n</nav>`;
}

/** Flat 平铺：全部标题同级 li */
function buildFlat(headings: HeadingInfo[]): string {
  return headings.map((h) => `<li><a href="#${h.id}">${escapeText(h.text)}</a></li>`).join("\n");
}

/**
 * 递归构建从 level 开始的层级子树
 * @param headings 待消费条目（文档序）
 * @param level 本层对应标题级别
 * @returns html 为本层及子层条目；rest 为不属于本层子树的首个更浅层级起的剩余条目
 */
function buildLevel(headings: HeadingInfo[], level: number): { html: string; rest: HeadingInfo[] } {
  const lines: string[] = [];
  let i = 0;
  while (i < headings.length && headings[i]!.level >= level) {
    const heading = headings[i]!;
    if (heading.level === level) {
      // 同层条目：li 内递归收集更深子树后闭合
      const sub = buildLevel(headings.slice(i + 1), level + 1);
      const subHtml = sub.html === "" ? "" : `<ul>\n${sub.html}</ul>\n`;
      lines.push(`<li><a href="#${heading.id}">${escapeText(heading.text)}</a>\n${subHtml}</li>`);
      // 子树消费数 = slice 长度 - 剩余数；同层下一条目从剩余处继续
      i += 1 + (headings.length - (i + 1) - sub.rest.length);
    } else {
      // 跳级防御（level 缺档）：平铺降级不丢条目
      lines.push(`<li><a href="#${heading.id}">${escapeText(heading.text)}</a></li>`);
      i += 1;
    }
  }
  return { html: lines.join("\n"), rest: headings.slice(i) };
}

/** 大纲文本转义（标题文本含 < > & 时保持字面） */
function escapeText(text: string): string {
  return text.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;");
}
