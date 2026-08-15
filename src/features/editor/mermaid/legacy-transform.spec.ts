// legacy 图表语法转换（纯函数，100% 覆盖）
//
// Typora 旧版 ```sequence（js-sequence-diagrams）与 ```flow（flowchart.js）语法
// 转换到 mermaid：sequence 是 mermaid sequenceDiagram 的子集直接复用；
// flow 的 token 语法（st=>start 等）做结构映射。非 legacy 语言原样透传。
import { describe, expect, it } from "vitest";
import { transformLegacyDiagram } from "./legacy-transform";

describe("legacy 图表语法转换", () => {
  it("legacy sequence 转换为 sequenceDiagram", () => {
    const out = transformLegacyDiagram("sequence", "A->B: hello\nB-->A: world");
    expect(out).toContain("sequenceDiagram");
    expect(out).toContain("A->B: hello");
  });

  it("legacy flow 的 start/operation/end 转换为基础 flowchart", () => {
    const out = transformLegacyDiagram(
      "flow",
      "st=>start: 开始\nop=>operation: 处理\ne=>end: 结束\nst->op->e",
    );
    expect(out).toContain("flowchart");
    expect(out).toContain("开始");
    expect(out).toContain("处理");
  });

  it("legacy flow 连接线单横线 -> 映射为双横线 -->（真实 mermaid 解析要求，AC-E21-4）", () => {
    const out = transformLegacyDiagram(
      "flow",
      "st=>start: 开始\nop=>operation: 处理\ne=>end: 结束\nst->op->e",
    );
    // 单横线箭头在真实 mermaid 11.16.1 中报 Parse error，必须补成双横线
    expect(out).toContain("st-->op");
    expect(out).toContain("op-->e");
    // 连式转换后不得出现三横线（--->），即映射未把已有 --> 拆开叠加
    expect(out).not.toContain("--->");
  });

  it("legacy flow 中已存在的双横线 --> 原样保留", () => {
    const out = transformLegacyDiagram("flow", "a=>operation: A\nb=>operation: B\na-->b");
    expect(out).toContain("a-->b");
    expect(out).not.toContain("--->");
  });

  it("dashed 虚线保护：a-.->b 保持原样且 st->op->e 仍转双横线", () => {
    const out = transformLegacyDiagram(
      "flow",
      "st=>start: S\nop=>operation: O\ne=>end: E\nst->op->e\nst-.->e\nst==>op",
    );
    // 虚线 -.->（flowchart.js 支持，mermaid 合法语法）不得被补成非法语法 -.-->
    expect(out).toContain("st-.->e");
    expect(out).not.toContain("-.-->");
    // 粗线 ==> 同样保持原样
    expect(out).toContain("st==>op");
    // 单横线 -> 仍按 AC-E21-4 补成双横线 -->（与占位保护互不干扰）
    expect(out).toContain("st-->op-->e");
    expect(out).not.toContain("--->");
  });

  it("legacy flow 的 condition 节点映射为菱形、inputoutput 映射为圆角矩形", () => {
    const out = transformLegacyDiagram("flow", "cond=>condition: 判断\nio=>inputoutput: 输入输出");
    expect(out).toContain("cond{判断}");
    expect(out).toContain("io[输入输出]");
  });

  it("非 legacy 语言透传不改写", () => {
    const content = "graph TD; A-->B";
    expect(transformLegacyDiagram("mermaid", content)).toBe(content);
    expect(transformLegacyDiagram("js", "const a=1")).toBe("const a=1");
  });

  it("语言标识大小写不敏感（FLOW/Sequence 同样命中 legacy 分支）", () => {
    expect(transformLegacyDiagram("FLOW", "st=>start: S")).toContain("flowchart");
    expect(transformLegacyDiagram("Sequence", "A->B: hi")).toContain("sequenceDiagram");
  });

  it("空内容透传", () => {
    expect(transformLegacyDiagram("sequence", "")).toBe("");
  });
});
