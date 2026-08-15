// legacy 图表语法 → mermaid 语法转换（E21）
//
// Typora 旧版支持两套 legacy 语法：```sequence（js-sequence-diagrams）与
// ```flow（flowchart.js）。mermaid 是其超集：sequence 语法子集可直接复用，
// flow 的 token 语法（st=>start 等）需做一次结构映射。
// 映射仅覆盖常用节点类型（start/end/operation/condition/inputoutput）。
/** legacy sequence 直接可用（mermaid sequenceDiagram 兼容其子集） */
const SEQUENCE_HEADER = "sequenceDiagram";

/**
 * legacy 图表语法转换
 * @param language 代码块语言标识
 * @param content 代码块内容
 * @returns 可直接交给 mermaid 的语法文本（非 legacy 语言原样透传）
 */
export function transformLegacyDiagram(language: string, content: string): string {
  if (content.length === 0) return content;
  const lang = language.toLowerCase();
  if (lang === "sequence") {
    // legacy sequence 语法是 mermaid sequenceDiagram 的子集（A->B: msg / Note left of A）
    return `${SEQUENCE_HEADER}\n${content}`;
  }
  if (lang === "flow") {
    return transformLegacyFlow(content);
  }
  return content; // 其余语言透传（含 mermaid 本身）
}

/** flowchart.js token 语法 → mermaid flowchart */
function transformLegacyFlow(content: string): string {
  const lines = content.split("\n");
  const out: string[] = ["flowchart TD"];
  for (const line of lines) {
    const trimmed = line.trim();
    const m = /^([\w-]+)=>(start|end|operation|condition|inputoutput):\s*(.+)$/.exec(trimmed);
    if (!m) {
      // 非节点声明行（连接线等）原样保留
      out.push(trimmed);
      continue;
    }
    const [, id, kind, label] = m;
    // mermaid 节点形态映射：condition 菱形，其余节点类型（start/end/operation/inputoutput）矩形
    const shape = kind === "condition" ? `{${label}}` : `[${label}]`;
    out.push(`${id}${shape}`);
  }
  return out.join("\n");
}
