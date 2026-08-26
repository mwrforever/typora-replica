// 缩放渲染 PluginView（07 spec P11：ratio attr → img 内联 zoom 样式）
//
// Typora 的缩放原生形态是 HTML img 内联样式（style="zoom:50%"），经 E20 html 节点
// 渲染天然兼容、零干预保留；markdown 图片侧由 Task 9 schema 定制把比例解析进
// attrs.ratio（落盘 title="zoom:N"）。T1 PIN-2 实证 ratio 不落 nodeView DOM 属性，
// 故以 $prose 插件的 PluginView 在事务后按 doc.descendants 遍历 image-block 节点，
// 经 view.nodeDOM(pos) 反查对应 DOM img，把 ratio 精确写入 img.style.zoom——
// 只动呈现层内联样式，不触碰文档模型与序列化链路。
//
// 边界约定：
//   - html 节点内的外来 img 不在 image-block 子树内，遍历恒不命中，其内联 zoom
//     （含 zoom 以外的其他 style 属性）原样保留（AC-P11-2 html 分支）；
//   - ratio=1 属无缩放语义，同步时清空样式（防外部改 attr 后残留旧值）；
//   - attrs.ratio 防御性收窄与 image-schema 的 normalizeRatio 同口径
//     （非法值回落 1），纵深防御外部 setAttr 写入脏值导致 zoom:NaN；
//   - 无 destroy 清理钩子：本视图不挂载任何自有 DOM，编辑器销毁时节点 DOM
//     随之拆除，无需回滚内联样式。
import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

/** image-block 节点名（T1 钉桩：schema id 即 "image-block"） */
const IMAGE_BLOCK_NODE_NAME = "image-block";

/**
 * 把单个 image-block 节点的 ratio 同步到其渲染 DOM 的 img 内联样式
 * @param view 编辑器视图（nodeDOM 反查入口）
 * @param pos 节点在文档中的位置（descendants 回调提供）
 * @param node image-block 文档节点（ratio 来源）
 */
function syncImageBlockZoom(view: EditorView, pos: number, node: ProseMirrorNode): void {
  // nodeDOM 可能返回 null（节点未渲染等边缘）：非 HTMLElement 一律跳过
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return;
  const img = dom.querySelector("img");
  if (!img) return;
  // ratio 收窄：缺省/非法值回落 1（与 schema 层 normalizeRatio 同口径）
  const raw = Number(node.attrs.ratio ?? 1);
  const ratio = Number.isFinite(raw) && raw > 0 ? raw : 1;
  // 缩放态写比例字符串（如 "0.5"），无缩放态清空——jsdom 与 Chromium 均支持该属性
  img.style.zoom = ratio !== 1 ? String(ratio) : "";
}

/** 全量同步：遍历文档内全部 image-block 节点并映射 DOM 缩放样式 */
function syncAllZoom(view: EditorView): void {
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== IMAGE_BLOCK_NODE_NAME) return true;
    syncImageBlockZoom(view, pos, node);
    return true;
  });
}

/**
 * 缩放渲染插件（create-editor.ts 工厂 use；测试助手同源装配）
 *
 * PluginView 构造期先做一次全量同步（打开含缩放图的文档首屏即生效——
 * ProseMirror 不会对初始文档主动调 update），此后每次文档事务后重扫全文档；
 * 每事务 O(n) 遍历与 markdownUpdated 序列化同量级，纯文本段开销可忽略，
 * 满足 01 性能预算（事件链路 500ms 内的呈现层附加操作）。
 */
export const zoomRenderPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey("markwell-zoom-render"),
      view(editorView: EditorView) {
        syncAllZoom(editorView);
        return {
          update(view: EditorView, prevState: EditorState) {
            // docChanged 早退（审查 Minor）：纯选区事务（移动光标/输入法组合）不改变
            // 文档——ProseMirror 对无步骤事务复用原文档对象，引用相等即零成本判定，
            // 免去选区高频路径上的全文档重扫
            if (view.state.doc === prevState.doc) return;
            syncAllZoom(view);
          },
        };
      },
    }),
);
