// remark 插件：合并行内 HTML 开闭标签与中间纯文本（E20 WYSIWYG 平价）
//
// CommonMark 解析把 `<span style="color: red">文字</span>` 拆为
// html(开标签) + text(文字) + html(闭标签) 三个相邻节点；内置 html 原子节点
// 各自渲染导致样式标签内为空、文字游离其外，与 Typora 所见即所得不符。
// 本插件仅当开闭标签之间的子节点全为纯文本时，把三者合并为单个 html 节点
// （value = 开标签 + 文本 + 闭标签），由 html NodeView 整体渲染。
// 中间含强调/链接等标记节点、或开闭标签不配对/无文本时保持拆分形态
// （不吞并已解析的 markdown 语义，保守边界）。
import { remarkPluginsCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";

/** mdast 节点最小结构（remark 树遍历用，仅取 type/children/value 字段） */
interface MdastNode {
  type: string;
  children?: MdastNode[];
  value?: string;
}

/** 行内完整开标签（非自闭合、非闭标签/注释/声明） */
const OPEN_TAG_RE = /^<([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*)?>$/;
/** 行内完整闭标签 */
const CLOSE_TAG_RE = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>$/;

/**
 * 文本节点内容转义（P1-3：合并值双重实体解码防护）
 *
 * mdast 的 text 节点值是已解码的实体（`&amp;lt;` → `&lt;`），而 html 节点
 * value 是原始源码片段。把已解码文本直接拼入 html 原始值，渲染/重解析时
 * 实体被二次解码（源文 `<span>a &amp;lt;b</span>` → 显示 `a <b`、落盘被改写）。
 * 拼入前把文本中的 `&`/`<`/`>` 反转义为实体，保证合并值重解析后等价于原文。
 */
function escapeHtmlText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 尝试从 children[i] 处合并「开标签 + 纯文本 + 同名闭标签」三元组
 *
 * 仅当开标签后的首个非文本子节点为同名闭标签、且中间至少有一个文本节点时
 * 合并；中间出现任何标记节点（strong/link 等）或闭标签不配对则放弃。
 * @param children 父节点子节点数组
 * @param i 开标签候选下标
 * @returns 合并后的 html 节点与消耗位置（含闭标签）；无法合并时返回 null
 */
function tryMergeAt(children: MdastNode[], i: number): { node: MdastNode; next: number } | null {
  const open = children[i];
  // 仅行内开标签参与合并（文本/标记/块级节点直接跳过）
  if (open.type !== "html") return null;
  const raw = open.value as string;
  // 自闭合标签（如 `<video ... />`，E20-5 依赖其独立渲染）不是开标签
  if (raw.trimEnd().endsWith("/>")) return null;
  const openMatch = OPEN_TAG_RE.exec(raw);
  if (!openMatch) return null;
  let text = "";
  for (let j = i + 1; j < children.length; j++) {
    const child = children[j];
    // 中间纯文本：累加进合并值
    if (child.type === "text") {
      text += child.value as string;
      continue;
    }
    if (child.type === "html") {
      const closeMatch = CLOSE_TAG_RE.exec(child.value as string);
      // 同名闭标签且中间确有文本才合并；空元素（`<span></span>`）与
      // 不配对（`<b>文字</i>`）保持拆分形态，不吞并
      if (closeMatch && closeMatch[1].toLowerCase() === openMatch[1].toLowerCase() && text !== "") {
        // 已解码文本反转义后拼入 html 原始值（P1-3：防渲染/重解析二次解码）
        return {
          node: { type: "html", value: raw + escapeHtmlText(text) + child.value },
          next: j + 1,
        };
      }
    }
    // 非文本/非 html 节点（已解析的 markdown 标记）或闭标签不配对：阻断合并
    break;
  }
  return null;
}

/** remark 树遍历：对每个父节点尝试合并行内 HTML 开闭标签对（仅解析阶段生效） */
function remarkMergeInlineHtml() {
  return (tree: MdastNode): void => {
    const walk = (node: MdastNode): void => {
      if (!node.children) return;
      const out: MdastNode[] = [];
      for (let i = 0; i < node.children.length;) {
        const merged = tryMergeAt(node.children, i);
        if (merged) {
          // 合并成功：整体消费开闭标签区间
          out.push(merged.node);
          i = merged.next;
        } else {
          out.push(node.children[i]);
          i++;
        }
      }
      node.children = out;
      for (const child of node.children) walk(child);
    };
    walk(tree);
  };
}

/**
 * 行内 HTML 合并接线（create-editor.ts 与测试助手同源 config 阶段调用）
 *
 * remark 插件按注册顺序执行：本插件注册在内置 remarkHtmlTransformer 之后，
 * 仅对段落内的 html+text+html 序列生效，块级 html（根/引用/列表直接子级）
 * 已被内置转换器包进段落，不受影响。
 * @param ctx milkdown 配置上下文（create() 前 config 回调中调用）
 */
export function configureHtmlMerge(ctx: Ctx): void {
  ctx.update(remarkPluginsCtx, (prev) => [...prev, { plugin: remarkMergeInlineHtml, options: {} }]);
}
