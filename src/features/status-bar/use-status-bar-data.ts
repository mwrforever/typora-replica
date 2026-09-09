// 状态栏数据装配层（11 P1）：订阅门面事件 + 标签切换主动拉取
//
// 门面语义（已核实，见计划多标签结论）：editorManager 单例事件桥随 adopt 重绑，
// 事件恒来自激活标签；标签切换边界双通道兜底——adopt 的晚挂号快照广播（editor-manager
// :110-123）+ 本层 watch activeTabId 在 nextTick（activate/adopt 完成后）从门面视图
// 拉取重算（useOutlineData 同模式，AC-S3-7）。
// 事件预算（宪法 B.3）：docUpdated 200ms 防抖事件直消费（全链路 400ms，不叠加防抖）；
// selectionUpdated 即时；禁订阅 markdownUpdated（常驻重监听禁止，B.3.5）。
import { nextTick, watch } from "vue";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import type { Selection } from "@milkdown/kit/prose/state";
import { editorManager } from "../editor/editor-manager";
import { useTabsStore } from "../tabs/tabs-store";
import { useStatusBarStore } from "./status-bar-store";
import { countDocument, countSelection } from "../../utils/word-count";

/**
 * 装配状态栏统计管道（组件生命周期内使用一次；dispose 与 mount 严格成对）
 *
 * 两条输入通道汇入 status-bar store：
 * - 结构通道：docUpdated（200ms 防抖）→ countDocument 全文重算；
 * - 即时通道：selectionUpdated → 空选区清除选区统计，非空选区 countSelection 区间统计
 *   （doc 取自门面当前视图而非缓存——禁止跨事件持有旧 state 引用，宪法 B.3.3）。
 *
 * @returns dispose 解除全部订阅与标签 watch（组件 onUnmounted 消费）
 */
export function useStatusBarData(): { dispose(): void } {
  const store = useStatusBarStore();
  const tabsStore = useTabsStore();

  /** 选区统计归一：光标态（from === to）→ undefined，否则按当前文档区间统计 */
  const selectionStatsOf = (doc: ProseMirrorNode, selection: Selection) =>
    selection.from === selection.to ? undefined : countSelection(doc, selection.from, selection.to);

  // 主动拉取（挂载/标签切换）：门面空态复位全零与无选中，否则按当前视图重算双统计
  const pullFromFacade = (): void => {
    const view = editorManager.getView();
    if (!view) {
      store.applyDocStats({ words: 0, characters: 0, lines: 0 });
      store.applySelectionStats(undefined);
      return;
    }
    store.applyDocStats(countDocument(view.state.doc));
    store.applySelectionStats(selectionStatsOf(view.state.doc, view.state.selection));
  };

  // 结构通道：防抖 doc → 全文重算
  const offDoc = editorManager.subscribeDocUpdated((doc) => {
    store.applyDocStats(countDocument(doc));
  });

  // 即时通道：选区变更 → 区间统计（doc 从门面取当前值，不缓存旧引用）
  const offSelection = editorManager.subscribeSelectionUpdated((selection) => {
    const view = editorManager.getView();
    // create 中期事件静默忽略：Editor.create() 过程中 listener 插件会同步触发本桥，
    // 此时 view 已存在但 state 尚未构造完，读 view.state.doc 会沿同步栈上抛 TypeError
    // 炸断 create 整链（E2E 实证：编辑器停留 OnCreate、事件流全死）。create 完成后
    // adopt 的晚挂号快照广播会补发当前 doc/selection，此处忽略不丢统计。
    if (!view || !view.state) return;
    store.applySelectionStats(selectionStatsOf(view.state.doc, selection));
  });

  // 卸载竞态防护（useOutlineData 同口径）：nextTick 挂起期间组件可能已卸载，
  // 续延恢复后放弃拉取，防幽灵写共享 store
  let disposed = false;

  // 标签切换/首挂：等 adopt 完成后从门面拉取重算（AC-S3-7 兜底通道）
  const stopTabWatch = watch(
    () => tabsStore.activeTabId,
    async () => {
      await nextTick();
      if (disposed) return;
      pullFromFacade();
    },
    { immediate: true },
  );

  return {
    dispose(): void {
      // 先置位再解绑：封堵已挂起的 nextTick 续延（useOutlineData 同款防护）
      disposed = true;
      offDoc();
      offSelection();
      stopTabWatch();
    },
  };
}
