// revealRange 定位接口：选中目标区间 → 滚动到可视区 → 临时高亮
// 供 06 搜索替换模块的跨文件结果定位消费
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";

/** 临时高亮 CSS 类名 */
const HIGHLIGHT_CLASS = "markwell-reveal-highlight";
/** 高亮自动消退缺省时长（毫秒）；大纲/toc 等既有调用方维持现状 */
const HIGHLIGHT_DURATION = 1200;

/**
 * 定位并高亮文档区间
 * @param editor 目标编辑器实例
 * @param from 区间起点（文档偏移，可为 0）
 * @param to 区间终点（文档偏移，越界自动收敛）
 * @param durationMs 临时高亮消退时长毫秒；缺省 1200 保持大纲/toc 现状（06 跨文件定位传 3000）
 */
export function revealRange(editor: Editor, from: number, to: number, durationMs?: number): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const docSize = view.state.doc.content.size;
    // 区间越界收敛，保证 ProseMirror 选区合法
    const safeFrom = Math.max(0, Math.min(from, docSize));
    const safeTo = Math.max(safeFrom, Math.min(to, docSize));

    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.create(view.state.doc, safeFrom, safeTo))
        .scrollIntoView(),
    );

    // 临时高亮：nodeDOM 在块边界返回元素、文本节点边界可能返回 Text 节点（无 classList），
    // 仅对 Element 操作 classList；Text 节点回退到其父元素，定时移除
    const { from: selFrom } = view.state.selection;
    const node = view.nodeDOM(selFrom);
    const dom = (node?.nodeType === 1 ? node : (node?.parentElement ?? null)) as HTMLElement | null;
    if (dom) {
      dom.classList.add(HIGHLIGHT_CLASS);
      // 缺省 1200 保持既有消费方观感；06 跨文件定位按 spec 传 3000（AC-F26-2）
      setTimeout(() => dom.classList.remove(HIGHLIGHT_CLASS), durationMs ?? HIGHLIGHT_DURATION);
    }
  });
}
