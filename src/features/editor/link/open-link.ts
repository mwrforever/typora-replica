// E14：Ctrl+点击链接在系统浏览器打开
//
// 普通点击仍由内置 LinkTooltip 处理（悬停预览/编辑），本插件仅在
// Ctrl/Meta+点击时拦截 handleClick 并转交 openExternalUrl。
import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { openExternalUrl } from "../../../services/external-open";

/**
 * Ctrl+点击打开链接插件
 * handleClick 在点击位置命中 link 标记且事件带 Ctrl/Meta 修饰时拦截并打开
 */
export const openLinkPlugin = $prose(() => {
  return new Plugin({
    props: {
      handleClick(view, pos, event) {
        const modPressed = event.ctrlKey || event.metaKey;
        if (!modPressed) return false; // 普通点击放行给内置 LinkTooltip（悬停预览/编辑）
        // 查找点击位置的 link 标记（link 为行内标记，点击落在其内部文本节点时
        // $pos.marks() 按 ProseMirror 语义返回该位置生效的全部标记）
        const $pos = view.state.doc.resolve(pos);
        const linkMark = $pos.marks().find((m) => m.type === view.state.schema.marks.link);
        if (!linkMark) return false; // 非链接位置（普通文本等）
        const href = linkMark.attrs.href as string;
        if (!href) return false; // 空 href（如 [文本]()）无打开目标
        event.preventDefault(); // 阻止默认点击行为（如选区漂移）
        // 转交系统浏览器；打开失败（Tauri command 异常等）不影响编辑状态（E14 契约）。
        // catch 防 unhandled rejection：替换实现可能抛错，此处显式吞掉
        void openExternalUrl(href).catch(() => {});
        return true; // 消费该点击，不再下传其他 handleClick
      },
    },
  });
});
