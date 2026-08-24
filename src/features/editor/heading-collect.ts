// heading 收集函数（01 工具层，spec §5 锁定位置）
//
// 唯一数据源消费者：E12 [toc] NodeView（本模块内）、05 大纲面板、09 导出（未来接入）。
// 输出与锚点 id 解耦：attrs.id 由 anchor-id 插件负责写入，本函数只读取。
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";

/** 大纲/TOC 条目形态 */
export interface HeadingInfo {
  /** 锚点 id（Typora 规则；由 anchor-id 插件写入 attrs.id） */
  id: string;
  /** 标题级别 1-6 */
  level: number;
  /** 纯文本内容（textContent，行内标记不带样式） */
  text: string;
  /** 文档偏移位置（节点起点，点击定位/revealRange 消费） */
  pos: number;
}

/**
 * 收集文档全部标题（文档序）
 * @param doc ProseMirror 文档对象
 * @returns 条目数组；空文档/无标题返回 []；空文本标题跳过（与锚点插件语义一致）
 */
export function collectHeadings(doc: ProseMirrorNode): HeadingInfo[] {
  const items: HeadingInfo[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return;
    if (node.textContent.trim().length === 0) return;
    items.push({
      // attrs.id 运行时恒为字符串（heading schema 的 id 属性 default ""，锚点插件恒写入字符串），
      // String 仅做宽类型收窄，无需空值兜底分支
      id: String(node.attrs.id),
      level: node.attrs.level as number,
      text: node.textContent,
      pos,
    });
  });
  return items;
}
