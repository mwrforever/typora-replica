// 行内公式 ESC 退出编辑态（E19 AC-E19-5 严格实现）
//
// Crepe latex feature 的内联编辑浮层（LatexInlineTooltip）内嵌独立 CodeMirror
// EditorView，其 keymap 仅绑定 Enter/Mod-Enter 确认——Escape 无绑定，且浮层
// 挂载于 body，按键不冒泡到主编辑器（主编辑器 keymap/handleKeyDown 收不到）。
// 本模块以 document 级 keydown 接管 Escape：编辑浮层聚焦时取消编辑（不应用
// 修改）并把主编辑器选择从公式节点（NodeSelection）改为普通文本选择——
// latex tooltip 的 shouldShow 在视图 update 时判 false，浮层收起、innerView
// 销毁，公式回到 KaTeX 预览态（AC-E19-5「退出预览态」方向；编辑态由点击
// 公式触发，Enter 确认保存，ESC 取消退出，构成完整双态交互）。
//
// 注册为 PluginView 形态：编辑器销毁时自动移除监听（单实例注册一次）。
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

/** 编辑浮层根选择器（latex feature 内部类名，稳定契约） */
const LATEX_EDIT_SELECTOR = ".milkdown-latex-inline-edit";

/** ESC 接管条件：浮层打开且焦点在浮层内（正在编辑公式源码） */
function isLatexEditing(): boolean {
  const floating = document.querySelector(LATEX_EDIT_SELECTOR);
  return !!floating && floating.contains(document.activeElement);
}

/**
 * 注册 document 级 Escape 处理（latex 编辑态取消）
 * @param getView 主编辑器视图访问器（插件视图销毁后返回 undefined，防御性跳过）
 * @returns 移除监听的清理函数
 */
export function setupLatexEscape(getView: () => EditorView | undefined): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !isLatexEditing()) return;
    const view = getView();
    if (!view) return;
    // 接管按键：取消编辑（不触发 updateValue，innerView 内的修改被丢弃）
    event.preventDefault();
    // 选择从公式节点改为空文本选择：视图更新后 tooltip shouldShow=false →
    // 浮层隐藏且 innerView 销毁（LatexInlineTooltip._onHide 清理路径）
    const tr = view.state.tr;
    tr.setSelection(TextSelection.create(tr.doc, view.state.selection.from));
    view.dispatch(tr);
    view.focus();
  };
  document.addEventListener("keydown", onKeyDown);
  return () => document.removeEventListener("keydown", onKeyDown);
}

/** ESC 处理插件（PluginView 生命周期：编辑器销毁时移除 document 监听） */
export const latexEscapePlugin: MilkdownPlugin = $prose(() => {
  return new Plugin({
    key: new PluginKey("MARKWELL_LATEX_ESCAPE"),
    view: (view) => {
      const cleanup = setupLatexEscape(() => view);
      return {
        update: () => undefined,
        destroy: cleanup,
      };
    },
  });
});
