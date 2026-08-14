// 编辑器事件桥
//
// 把 Crepe 底层 listener 事件（markdownUpdated/updated/selectionUpdated）转换为
// 带防抖语义的对外回调。防抖口径（已锁定，勿改）：
//   markdownUpdated → 300ms（供 02 自动保存，全量序列化 O(n) 必须防抖）
//   updated(doc)   → 200ms（供 05 大纲收集、11 字数统计）
//   selectionUpdated → 即时（供 05 当前标题高亮、11 选中统计）
import type { Crepe } from "@milkdown/crepe";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import type { Selection } from "@milkdown/kit/prose/state";

/** 事件回调集合 */
export interface EditorEventCallbacks {
  /** 防抖 300ms 后的 markdown 全文变更 */
  onMarkdownUpdated?: (markdown: string) => void;
  /** 防抖 200ms 后的文档对象变更 */
  onDocUpdated?: (doc: ProseMirrorNode) => void;
  /** 即时选区变更 */
  onSelectionUpdated?: (selection: Selection) => void;
}

/** 当前挂载的取消函数（防抖计时器清理，内容可变但引用不变） */
const detachFns: Array<() => void> = [];

/** 防抖包装：返回带取消能力的包装函数 */
function debounce<T extends unknown[]>(fn: (...args: T) => void, wait: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const wrapped = ((...args: T) => {
    // 已解绑后不再调度（底层 listener 无移除接口，事件可能继续到达）
    if (cancelled) return;
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  }) as ((...args: T) => void) & { cancel: () => void };
  wrapped.cancel = () => {
    // 置取消标记：既清理未决计时器，也阻断解绑后的事件再次触发回调
    cancelled = true;
    clearTimeout(timer);
  };
  return wrapped;
}

/**
 * 将 Crepe listener 事件桥接到业务回调
 * @param crepe 目标 Crepe 实例
 * @param callbacks 回调集合
 */
export function attachEditorEvents(crepe: Crepe, callbacks: EditorEventCallbacks): void {
  // 先行取出回调引用，避免防抖回调内二次空值检查（回调在 attach 时点确定）
  const { onMarkdownUpdated, onDocUpdated, onSelectionUpdated } = callbacks;
  crepe.on((listener) => {
    if (onMarkdownUpdated) {
      const debounced = debounce((md: string) => onMarkdownUpdated(md), 300);
      listener.markdownUpdated((_ctx, md) => debounced(md));
      detachFns.push(() => debounced.cancel());
    }
    if (onDocUpdated) {
      const debounced = debounce((doc: ProseMirrorNode) => onDocUpdated(doc), 200);
      listener.updated((_ctx, doc) => debounced(doc));
      detachFns.push(() => debounced.cancel());
    }
    if (onSelectionUpdated) {
      listener.selectionUpdated((_ctx, selection) => onSelectionUpdated(selection));
    }
  });
}

/** 解绑事件桥（编辑器销毁时调用） */
export function detachEditorEvents(): void {
  for (const fn of detachFns.splice(0)) fn();
}

/** 编辑器实例生命周期内的事件桥入口（editor-manager 调用） */
export function setupEditorEvents(crepe: Crepe): void {
  // 01 阶段无固定消费者，仅暴露挂载入口；02/05/11 接入后在此订阅
  void crepe;
}

/** 编辑器实例销毁时的清理入口（editor-manager 调用） */
export function destroyEditorEvents(): void {
  detachEditorEvents();
}
