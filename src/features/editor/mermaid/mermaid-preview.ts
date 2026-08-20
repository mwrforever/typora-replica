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
 * 渲染 id 自增计数器（多图表文档隔离）
 *
 * mermaid 11.16.1 的 render() 内部会 removeExistingElements(document, id)——
 * 按传入 id 把文档中同名旧元素移除，且返回的 SVG 自带该 id 并被嵌入预览面板。
 * 若固定 id 渲染，第二个图表渲染时会把第一个图表的 SVG 从 DOM 移除，
 * 多图表文档任一时刻只保留最后渲染的一个。每次渲染分配自增唯一 id 规避。
 *
 * 保持模块级：removeExistingElements 按 id 扫整个 document——多编辑器实例同
 * document 共存时 id 必须全文档唯一，若移入闭包会让 A/B 实例的 id 冲突、
 * 互相误删对方 SVG（04 多标签）。
 */
let renderSeq = 0;

/**
 * 创建 mermaid 预览钩子（链式包裹前序 renderPreview）
 * @param prev 前序 renderPreview（内置 latex 等）
 */
export function createMermaidRenderPreview(prev: RenderPreviewHandler): RenderPreviewHandler {
  // 预览代次按编辑器实例隔离（04 多标签）：实例 A 的异步渲染不得使实例 B 的
  // 预览结果过期——FIX-7 竞态守卫由模块级改为实例级（旧实现共享计数器，
  // 后触发实例会作废先触发实例的未完成渲染，其预览被永久丢弃）
  let previewGen = 0;
  return (language: string, content: string, applyPreview) => {
    const lang = language.toLowerCase();
    if (lang === "mermaid" || lang === "sequence" || lang === "flow") {
      if (content.length === 0) return "";
      // 登记本次渲染代次：异步完成时仅最新代次允许写入预览面板
      const gen = ++previewGen;
      // 异步渲染：先回占位，渲染完成后 applyPreview 替换（失败降级为错误提示）
      void renderMermaidAsync(content, lang).then(
        (html) => {
          if (gen === previewGen) applyPreview(html);
        },
        () => {
          if (gen === previewGen) applyPreview(errorHtml());
        },
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
  const { svg } = await mermaid.render(`markwell-mermaid-${++renderSeq}`, source);
  return `<div class="markwell-mermaid-svg">${svg}</div>`;
}
