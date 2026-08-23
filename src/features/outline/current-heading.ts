// 双通道活动标题判定纯函数层（05 大纲模块）
//
// 编辑通道（AC-F19-2）：光标位置沿 ProseMirror 祖先链上溯，命中标题节点即取其
// 锚点 id；无标题祖先时回退「pos 之前最近的标题条目」。
// 滚动通道（AC-F19-3）：视口滚动时取最后一个 top ≤ 阈值的候选条目。
// 两函数均为纯函数：不依赖编辑器实例与 DOM 布局，jsdom 或纯数据即可测试；
// 调用方（装配层）负责传入 collectHeadings 产物、合法文档坐标与视口测量值。
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import type { HeadingInfo } from "../editor/heading-collect";

/**
 * 编辑通道判定当前活动标题（AC-F19-2）
 *
 * 执行流程：先 doc.resolve(pos) 沿祖先链由内向外找第一个 heading 节点
 * （引用块/表格容器内的标题同样命中）；找不到则回退扫描 headings，
 * 取 pos 之前（含相等）最近的标题条目。
 *
 * @param headings collectHeadings 产物（已按文档序）；允许为空数组
 * @param doc 光标所在 ProseMirror 文档对象
 * @param pos 光标偏移位置（ProseMirror 文档坐标，来源 selection.from 等）
 * @returns 命中的锚点 id；pos 之前无任何标题时 undefined；
 *          命中未编号标题（空文本被 anchor-id 插件跳过）返回空串，调用方按无高亮处理
 */
export function activeIdByPos(
  headings: HeadingInfo[],
  doc: ProseMirrorNode,
  pos: number,
): string | undefined {
  // 祖先链上溯：depth 从最内层节点到根，首个标题节点即光标所属章节
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "heading") {
      // 锚点 id 由 heading schema 默认空串、anchor-id 插件回填，无空值形态；
      // 此处仅对宽松的 attrs 类型面做字符串化收窄（空文本标题的 id 即默认 ""）
      return String(node.attrs.id);
    }
  }
  // 回退通道：正文光标无标题祖先 → 取 pos 之前最近的标题条目
  // （headings 已按文档序；全量扫描取最后一个满足者，对轻微乱序输入同样成立）
  let nearest: string | undefined;
  for (const heading of headings) {
    if (heading.pos <= pos) nearest = heading.id;
  }
  return nearest;
}

/**
 * 滚动通道判定当前活动标题（AC-F19-3）
 *
 * 适用场景：滚动同步——装配层对每个可见标题测 getBoundingClientRect().top 后
 * 调用本函数；「最后一个 top ≤ 阈值」即视口基准线之上最近的一个标题。
 *
 * @param candidates 候选条目（锚点 id + 视口内 top 坐标，按文档序/top 升序）
 * @param thresholdTop 判定阈值（通常取视口顶部附近的一条基准线，单位 px）
 * @returns 最后一个 top ≤ 阈值的条目 id；全部越阈或候选为空数组时 undefined
 */
export function pickActiveByTop(
  candidates: Array<{ id: string; top: number }>,
  thresholdTop: number,
): string | undefined {
  let picked: string | undefined;
  for (const candidate of candidates) {
    // 恒记录最后一个满足者：即便输入存在局部乱序也保持「最近越线」语义
    if (candidate.top <= thresholdTop) picked = candidate.id;
  }
  return picked;
}
