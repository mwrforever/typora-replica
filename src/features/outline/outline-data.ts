// 大纲数据装配层（05 P2）：订阅门面事件 + 标签切换拉取 + 滚动通道挂载
//
// 门面语义（04）：事件恒来自激活标签；标签切换无编辑事件，watch activeTabId
// 在 nextTick（activateInstance/adopt 完成后）主动从门面拉取重建。
import { nextTick, onMounted, watch } from "vue";
import { collectHeadings } from "../editor/heading-collect";
import { editorManager } from "../editor/editor-manager";
import { activeIdByPos, pickActiveByTop } from "./current-heading";
import { useOutlineStore } from "./outline-store";
import { useTabsStore } from "../tabs/tabs-store";
import { loadSettings } from "../../services/settings";

/** 视口判定阈值系数：视口上部 1/3（业界惯例，spec F19） */
const VIEWPORT_FRACTION = 1 / 3;

/** 自 view.dom 向上找滚动容器（scrollHeight > clientHeight 或 overflow 可滚动的最近祖先） */
function findScrollContainer(start: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = start.parentElement;
  while (el) {
    if (el.scrollHeight > el.clientHeight + 1) return el;
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * 装配大纲数据管道（组件生命周期内使用一次；dispose 与 mount 严格成对）
 *
 * 三条输入通道汇入 outline store：
 * - 编辑通道：selectionUpdated 即时 → activeIdByPos 回写当前标题；
 * - 结构通道：docUpdated 防抖 → collectHeadings 重收集整体替换；
 * - 滚动通道：门面滚动容器 scroll → pickActiveByTop 按「最后一个 top ≤ 视口
 *   上 1/3 基准线」回写（coordsAtPos 度量与具体滚动元素无关）。
 *
 * @returns dispose 解除全部订阅与滚动监听（onUnmounted 消费）
 */
export function useOutlineData(): { dispose(): void } {
  const store = useOutlineStore();
  const tabsStore = useTabsStore();

  // 主动拉取：编辑器未就绪清空大纲（门面空态），否则全量重收集注入
  const pullFromFacade = (): void => {
    const view = editorManager.getView();
    if (!view) {
      store.applyHeadings([]);
      return;
    }
    store.applyHeadings(collectHeadings(view.state.doc));
  };

  // 编辑通道：即时选区 → 当前标题（上溯祖先 + 前置回退）
  const offSelection = editorManager.subscribeSelectionUpdated((selection) => {
    const view = editorManager.getView();
    if (!view) return;
    store.setActive(activeIdByPos(store.headings, view.state.doc, selection.head));
  });

  // 结构通道：防抖 doc → 重收集
  const offDoc = editorManager.subscribeDocUpdated((doc) => {
    store.applyHeadings(collectHeadings(doc));
  });

  // 滚动通道：滚动容器 scroll → 「最后一个 top ≤ 视口阈值」（coordsAtPos 度量与具体滚动元素无关）
  let scroller: HTMLElement | null = null;
  const onScroll = (): void => {
    const view = editorManager.getView();
    if (!view || !scroller || store.headings.length === 0) return;
    const rect = scroller.getBoundingClientRect();
    const thresholdTop = rect.top + rect.height * VIEWPORT_FRACTION;
    const candidates = store.headings.map((h) => ({
      id: h.id,
      top: view.coordsAtPos(h.pos + 1).top,
    }));
    store.setActive(pickActiveByTop(candidates, thresholdTop));
  };

  const attachScroll = (): void => {
    detachScroll();
    const view = editorManager.getView();
    if (!view) return;
    scroller = findScrollContainer(view.dom);
    scroller?.addEventListener("scroll", onScroll, { passive: true });
  };
  const detachScroll = (): void => {
    scroller?.removeEventListener("scroll", onScroll);
    scroller = null;
  };

  // 标签切换/首挂：等 adopt 完成后拉取 + 重挂滚动监听
  const stopTabWatch = watch(
    () => tabsStore.activeTabId,
    async () => {
      await nextTick();
      pullFromFacade();
      attachScroll();
    },
    { immediate: true },
  );

  onMounted(() => {
    // 设置镜像加载（持久化值回落 store 默认 Flat）；reject 兜底不阻塞渲染
    void loadSettings()
      .then((s) => store.setCollapsible(s.outline.collapsible))
      .catch(() => {
        /* 设置加载失败回落 store 默认值（Flat），大纲主功能不受影响 */
      });
  });

  return {
    dispose(): void {
      offSelection();
      offDoc();
      stopTabWatch();
      detachScroll();
    },
  };
}
