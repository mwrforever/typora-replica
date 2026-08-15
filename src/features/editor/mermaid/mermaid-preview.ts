// Mermaid 图表渲染（E21）
//
// 复用 CodeMirror Feature 的 renderPreview 钩子（latex feature 同款模式）：
// language === 'mermaid'（含 legacy sequence/flow）时懒加载 mermaid chunk 渲染，
// 其余语言回落到前序 renderPreview（latex 等内置渲染不受影响）。
// 懒加载：mermaid 体积大，首次渲染时动态 import（独立 chunk）。
import { transformLegacyDiagram } from "./legacy-transform";

/**
 * renderPreview 处理器类型（与 @milkdown/kit CodeBlockConfig.renderPreview 签名一致）
 *
 * 注意：applyPreview 的入参为 `null | string | HTMLElement`（代码块预览面板的
 * 统一载体），而非窄化的 string——收紧为 string 会与真实 API 在 strictFunctionTypes
 * 下不兼容，故保持与安装版 API 一致的类型宽度。
 */
export type RenderPreviewHandler = (
  language: string,
  content: string,
  applyPreview: (value: null | string | HTMLElement) => void,
) => void | null | string | HTMLElement;

/** 渲染中占位 HTML（applyPreview 完成前） */
const LOADING_HTML = '<div class="markwell-mermaid-loading">图表渲染中…</div>';

/**
 * 创建 mermaid 预览钩子（链式包裹前序 renderPreview）
 * @param prev 前序 renderPreview（内置 latex 等）
 */
export function createMermaidRenderPreview(prev: RenderPreviewHandler): RenderPreviewHandler {
  return (language: string, content: string, applyPreview) => {
    const lang = language.toLowerCase();
    if (lang === "mermaid" || lang === "sequence" || lang === "flow") {
      if (content.length === 0) return "";
      // 异步渲染：先回占位，渲染完成后 applyPreview 替换（失败降级为错误提示）
      void renderMermaidAsync(content, lang).then(
        (html) => applyPreview(html),
        () => applyPreview(errorHtml()),
      );
      return LOADING_HTML;
    }
    return prev(language, content, applyPreview);
  };
}

/** 错误提示 HTML（AC-E21-3：非法语法显示解析错误而非崩溃） */
function errorHtml(): string {
  return '<div class="markwell-mermaid-error">Mermaid 解析错误：请检查图表语法</div>';
}

/**
 * 异步渲染 mermaid（懒加载 chunk）
 * @param content 图表语法（legacy 已转换）
 * @param lang 原始语言标识
 */
async function renderMermaidAsync(content: string, lang: string): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
  const source = transformLegacyDiagram(lang, content);
  const { svg } = await mermaid.render("markwell-mermaid", source);
  return `<div class="markwell-mermaid-svg">${svg}</div>`;
}
