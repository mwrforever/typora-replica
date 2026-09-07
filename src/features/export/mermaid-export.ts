// mermaid 导出渲染封装（09 X1：导出 HTML 中图表内联为 SVG）
//
// 单例语义（宪法 A.5.11）：全局 initialize 一次（startOnLoad:false），后续显式 render；
// 动态 import 惰性加载（首份 mermaid 图表导出才拉取模块，导出非图表文档零开销）。
type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
};

/** 惰性单例 Promise（undefined = 尚未初始化） */
let mermaidPromise: Promise<MermaidApi> | undefined;

/** 导出图表 render id 自增序号（同文档多图表 id 冲突防御） */
let renderSeq = 0;

/** 加载并初始化 mermaid（仅一次；重复调用复用同一 Promise） */
function getMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import("mermaid").then((m) => {
    m.default.initialize({ startOnLoad: false, securityLevel: "strict" });
    return m.default as unknown as MermaidApi;
  });
  return mermaidPromise;
}

/**
 * 渲染 mermaid 源码为内联 SVG
 * @param code mermaid 图表源码（围栏内文）
 * @returns SVG 字符串（原样内嵌导出 HTML）
 * @throws 渲染失败原样抛出（导出流程统一呈现失败，不静默吞错）
 */
export async function renderMermaidToSvg(code: string): Promise<string> {
  const mermaid = await getMermaid();
  renderSeq += 1;
  const { svg } = await mermaid.render(`mw-export-mermaid-${renderSeq}`, code);
  return svg;
}

/** 测试专用：重置单例（用例间隔离，vi.mock 重挂后需重新 initialize） */
export function resetMermaidForTest(): void {
  mermaidPromise = undefined;
  renderSeq = 0;
}
