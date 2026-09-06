// 导出 CSS 内联构建（09 X1 内嵌样式 / X2 PDF @page）
//
// 层合并：主题 CSS 文本（readFile 读取，含用户层）+ KaTeX CSS（?raw 静态内联）+
// 导出专用 CSS（常量）。导出产物为独立单文件，全部样式内嵌 <style>。
// 页眉页脚走 Chrome 131+ @page margin boxes + counter(page/pages)（WebView2 Runtime
// 已 ≥131，调研实证）；${title}/${pageNo}/${pageCount} 变量在前端替换为 CSS content
// 表达式，Rust 侧 ShouldPrintHeaderAndFooter 恒 false。
import katexCss from "katex/dist/katex.min.css?raw";

/** A4 纸张尺寸（英寸；WebView2 PrintSettings 单位为英寸） */
export const A4_SIZE_IN = { widthIn: 8.27, heightIn: 11.69 } as const;

/** PDF 默认页边距（英寸，四边同值；与 Rust 侧常量对齐） */
export const PDF_MARGIN_IN = 0.4;

/** 导出专用基础样式（正文容器 / 代码块 / 表格 / 大纲；明色为基线，不含暗色段） */
export const EXPORT_BASE_CSS = `
body { margin: 0; }
.mw-export-body { max-width: 794px; margin: 0 auto; padding: 2em 1em; box-sizing: border-box; font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; line-height: 1.6; }
.mw-export-body pre { background: #f6f8fa; padding: 12px; border-radius: 6px; overflow: auto; }
.mw-export-body code { font-family: Consolas, monospace; }
.mw-export-body table { border-collapse: collapse; }
.mw-export-body th, .mw-export-body td { border: 1px solid #d0d7de; padding: 6px 12px; }
.mw-export-body blockquote { border-left: 4px solid #d0d7de; margin: 0; padding-left: 1em; color: #57606a; }
.mw-export-body img { max-width: 100%; }
.mw-export-outline { border: 1px solid #d0d7de; border-radius: 6px; padding: 12px 24px; margin-bottom: 2em; background: #f6f8fa; }
`;

/** 暗色段样式（AC-X2-4 暗色导出载体；仅 darkMode 时并入 style 块） */
export const EXPORT_DARK_CSS = `
html.markwell-dark, html.markwell-dark body { background: #1e1e1e; color: #d4d4d4; }
html.markwell-dark .mw-export-body pre { background: #2d2d2d; }
html.markwell-dark .mw-export-outline { background: #2d2d2d; border-color: #444; }
`;

/** style 块构建入参（A.7 参数对象化） */
export interface StyleBlockInput {
  /** 主题层 CSS 文本（主主题 + 用户层拼接产物；undefined = 无主题层） */
  themeCss?: string;
  /** 暗色标记段注入（跟随当前系统色系；AC-X2-4 载体） */
  darkMode?: boolean;
}

/**
 * 构建 <style> 块（导出专用 → KaTeX → 主题 → 暗色标记；后层覆盖前层）
 * @param input 见接口注
 * @returns 完整 style 元素 HTML
 */
export function buildStyleBlock(input: StyleBlockInput): string {
  const parts = [EXPORT_BASE_CSS, katexCss];
  if (input.themeCss !== undefined) parts.push(input.themeCss);
  if (input.darkMode === true) {
    // color-scheme 让表单控件/滚动条随暗色渲染，暗色规则段紧随其后覆盖明色基线
    parts.push("html.markwell-dark { color-scheme: dark; }");
    parts.push(EXPORT_DARK_CSS);
  }
  return `<style>\n${parts.join("\n")}\n</style>`;
}

/** PDF @page 构建入参 */
export interface PdfPageCssInput {
  /** 页眉模板（${title}/${pageNo}/${pageCount}）；undefined/空 = 无页眉 */
  header?: string;
  /** 页脚模板；undefined/空 = 无页脚 */
  footer?: string;
  /** 文档标题（${title} 替换值） */
  title: string;
  /** h1 章节分页开关 */
  breakH1: boolean;
}

/**
 * 构建 PDF @page 样式段
 * @param input 见接口注
 * @returns @page CSS 文本（由调用方并入 style 块）
 */
export function buildPdfPageCss(input: PdfPageCssInput): string {
  const lines: string[] = [];
  if (input.breakH1) {
    lines.push(".mw-export-body h1 { break-before: page; }");
    // 首个 h1 不分页（避免封面式标题前留白页）
    lines.push(".mw-export-body h1:first-child { break-before: auto; }");
  }
  const hasHeader = input.header !== undefined && input.header !== "";
  const hasFooter = input.footer !== undefined && input.footer !== "";
  if (hasHeader || hasFooter) {
    lines.push("@page {");
    if (hasHeader) {
      lines.push(`  @top-center { content: ${toContentExpr(input.header!, input.title)}; }`);
    }
    if (hasFooter) {
      lines.push(`  @bottom-center { content: ${toContentExpr(input.footer!, input.title)}; }`);
    }
    lines.push("}");
  }
  return lines.join("\n");
}

/** 页码变量替换正则（${title}/${pageNo}/${pageCount}；裸词不替换） */
const PAGE_VAR_RE = /\$\{(title|pageNo|pageCount)\}/g;

/** content 表达式 token（字符串字面或 CSS 计数器） */
type ContentToken = { kind: "str"; text: string } | { kind: "counter"; expr: string };

/**
 * 把页眉/页脚模板转成 CSS content 表达式
 *
 * 相邻字符串 token 合并为单字面量（产物形如 `"手册 · 第 " counter(page) " 页"`）。
 * @param template 用户模板
 * @param title 文档标题
 * @returns CSS content 值表达式
 */
function toContentExpr(template: string, title: string): string {
  const tokens: ContentToken[] = [];
  let last = 0;
  for (const match of template.matchAll(PAGE_VAR_RE)) {
    const before = template.slice(last, match.index);
    if (before !== "") pushString(tokens, before);
    switch (match[1]) {
      case "title":
        pushString(tokens, title);
        break;
      case "pageNo":
        tokens.push({ kind: "counter", expr: "counter(page)" });
        break;
      case "pageCount":
        tokens.push({ kind: "counter", expr: "counter(pages)" });
        break;
    }
    last = match.index + match[0].length;
  }
  const tail = template.slice(last);
  if (tail !== "") pushString(tokens, tail);
  if (tokens.length === 0) return '""';
  return tokens.map((t) => (t.kind === "str" ? escapeCssString(t.text) : t.expr)).join(" ");
}

/** 推入字符串 token（上一 token 也是字符串则拼接） */
function pushString(tokens: ContentToken[], text: string): void {
  const prev = tokens[tokens.length - 1];
  if (prev?.kind === "str") prev.text += text;
  else tokens.push({ kind: "str", text });
}

/** CSS 字符串字面转义（引号/反斜杠，防 content 表达式注入） */
function escapeCssString(text: string): string {
  return `"${text.split("\\").join("\\\\").split('"').join('\\"')}"`;
}
