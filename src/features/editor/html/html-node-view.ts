// html 节点渲染 NodeView（E20 渲染剥离与安全呈现）
//
// preset-commonmark 内置 html 原子节点默认 toDOM 把原始 HTML 源码当作文本渲染
//（仅显示源码、不呈现效果，也无安全清洗），与 Typora 式所见即所得不符。本
// NodeView 接管 html 节点的屏幕渲染：
//   - 渲染前先 sanitizeHtml 白名单清洗（script/on* 事件属性/javascript: 协议禁用，
//     iframe 强制 sandbox，AC-E20-3/4）
//   - 再 stripHtmlAttrsAtRender 剥离 class/id/data-*（AC-E20-2 编辑视图形态）
//   - 节点 attrs.value 保持原文不动：导出（toMarkdown/getMarkdown）与剪贴板
//     序列化（toDOM）均原样保留，落盘不丢装饰属性
//
// 接线（create-editor.ts 与测试助手 makeTestEditor 同源调用）：
//   crepe.editor.config((ctx) => { setupHtmlNodeView(ctx); })
import { nodeViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import type { NodeViewConstructor } from "@milkdown/kit/prose/view";
import { sanitizeHtml, stripHtmlAttrsAtRender } from "./html-sanitize";

/** html 节点名（preset-commonmark 稳定契约） */
export const htmlNodeName = "html";

/**
 * html 节点视图：渲染清洗后的 HTML 呈现
 *
 * 非线程安全（仅编辑器主线程访问）；内容变化由 update 全量重渲，DOM 内部变化
 * （ignoreMutation=true）不影响文档状态。
 */
class HtmlNodeView {
  /** 容器 DOM（内联原子节点，与 schema group: inline 一致用 span） */
  dom: HTMLElement;

  /** 最近一次渲染的原始值（值未变时 update 跳过重渲） */
  private renderedValue = "";

  constructor(node: ProseMirrorNode) {
    this.dom = document.createElement("span");
    // 标记节点类型：与内置 toDOM 的 data-type 契约一致，便于调试与样式定位。
    // 该属性为编辑器注入的节点标记（非用户内容），AC-E20-2 的 data-* 剥离
    // 只针对容器内层内容，不含本标记
    this.dom.setAttribute("data-type", htmlNodeName);
    this.render(node.attrs.value as string);
  }

  /**
   * 重渲容器内容：先白名单清洗（安全），再剥离装饰属性（AC-E20-2 编辑视图形态）
   * @param value 节点原始 HTML（不可信输入，白名单清洗在此强制执行）
   */
  private render(value: string): void {
    this.renderedValue = value;
    // 清洗 → 剥离顺序固定：安全边界先于呈现形态（清洗可能移除整个 script 元素）
    this.dom.innerHTML = stripHtmlAttrsAtRender(sanitizeHtml(value));
  }

  /**
   * ProseMirror 节点更新回调
   *
   * PM 按节点类型分发 nodeViews，本回调仅收到 html 类型节点（无类型守卫分支）；
   * 原文未变时复用现有 DOM（光标/选区等视图状态不被打断）。
   * @param node 更新后的 html 节点
   * @returns true 表示本视图接管后续渲染
   */
  update(node: ProseMirrorNode): boolean {
    if (node.attrs.value !== this.renderedValue) this.render(node.attrs.value as string);
    return true;
  }

  /** 容器内容由本视图全量接管，忽略 PM 对内部 DOM 的变更检测 */
  ignoreMutation(): boolean {
    return true;
  }
}

/** 节点视图工厂（供 nodeViewCtx 注册：ProseMirror NodeViewConstructor 形态） */
export function htmlNodeViewFactory() {
  // view 参数本视图不消费（额外参数被 JS 忽略，不参与签名）
  return (node: ProseMirrorNode) => new HtmlNodeView(node);
}

/**
 * html 节点视图注册配置（create-editor.ts config 阶段调用）
 *
 * nodeViewCtx 条目为二元组 [节点名, 工厂]（与 $view 组合子同构），
 * 消费方 Object.fromEntries 直接展开为 ProseMirror nodeViews 选项。
 * @param ctx milkdown 配置上下文（create() 前 config 回调中调用）
 */
export function setupHtmlNodeView(ctx: Ctx): void {
  // 显式标注二元组类型：展开数组字面量会被 TS 拓宽为联合数组，与 NodeView 元组类型不兼容
  const entry: [string, NodeViewConstructor] = [htmlNodeName, htmlNodeViewFactory()];
  ctx.update(nodeViewCtx, (prev) => [...prev, entry]);
}
