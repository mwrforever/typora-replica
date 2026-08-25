// 查找面板装配层（06 P1）：store ↔ 门面活动实例桥
//
// 职责：①面板输入受控构建查询经 setSearchState 派发到门面当前视图；
// ②切实例（create/adopt 快照广播 docUpdated）向新视图重放当前查询；
// ③selectionUpdated 即时通道做未挂查询的首次交互愈合 + 活动序号回写；
// ④导航/替换命令封装（快捷键与按钮共用入口）。
// 闭包 appliedQuery 记录门面当前已派发的查询，供清除判定/愈合守卫/计数守卫消费
// （不读插件内部 state，版本演进安全）。
import { nextTick, watch } from "vue";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  SearchQuery,
  findNext,
  findPrev,
  replaceAll,
  replaceCurrent,
  replaceNext,
  setSearchState,
} from "prosemirror-search";
import type { SearchResult } from "prosemirror-search";
import { editorManager } from "../editor/editor-manager";
import { useTabsStore } from "../tabs/tabs-store";
import { activeMatchIndex, buildSearchQuery, collectMatches } from "./search-query";
import type { BuiltSearch } from "./search-query";
import { useSearchStore } from "./search-store";

/** 计数防抖窗口（docUpdated 桥内已有 200ms，再合并连续 selection 抖动） */
const RECOUNT_DEBOUNCE_MS = 150;

// —— 模块级单例状态（FindReplacePanel 为 App 级唯一挂载点）——
let appliedQuery: SearchQuery | undefined;
let cachedMatches: SearchResult[] = [];
let recountTimer: ReturnType<typeof setTimeout> | undefined;

function currentView(): EditorView | undefined {
  return editorManager.getView() as EditorView | undefined;
}

/** store 三开关快照 → 受控构建 */
function builtFromStore(): BuiltSearch {
  const s = useSearchStore();
  return buildSearchQuery({
    query: s.query,
    replacement: s.replacement,
    caseSensitive: s.caseSensitive,
    wholeWord: s.wholeWord,
    regexp: s.regexp,
  });
}

/** 清除装饰（关闭/空词/非法态共用）；空查询派发幂等无副作用 */
function clearDecorations(view: EditorView): void {
  view.dispatch(setSearchState(view.state.tr, new SearchQuery({ search: "" })));
  appliedQuery = undefined;
  cachedMatches = [];
}

function recountNow(): void {
  const store = useSearchStore();
  const view = currentView();
  if (!view || !appliedQuery) {
    cachedMatches = [];
    return;
  }
  // 计数回写：匹配集重收集 + 按当前光标头判定活动序号（3/10 的分子来源）
  cachedMatches = collectMatches(view.state, appliedQuery);
  store.applyCounts(
    cachedMatches.length,
    activeMatchIndex(cachedMatches, view.state.selection.head),
  );
}

function scheduleRecount(): void {
  if (recountTimer) clearTimeout(recountTimer);
  recountTimer = setTimeout(() => {
    recountTimer = undefined;
    recountNow();
  }, RECOUNT_DEBOUNCE_MS);
}

/**
 * 把面板当前查询应用到门面活动视图：每次调用都重新评估面板态并按需派发
 * （切实例/输入变化/标签切换等事件源共用；setSearchState 同查询重复派发无害）
 */
function applyToView(): void {
  const store = useSearchStore();
  const view = currentView();
  if (!view) {
    appliedQuery = undefined;
    cachedMatches = [];
    return; // 实例未就绪：订阅方会在后续广播/交互事件中重试
  }
  if (!store.visible || !store.query) {
    if (appliedQuery) clearDecorations(view);
    store.setStatus("idle");
    store.applyCounts(0, 0);
    return;
  }
  const built = builtFromStore();
  if (built.status !== "ok") {
    if (appliedQuery) clearDecorations(view);
    // "empty" 在上方 !store.query 分支已拦截，此处不可达；类型收窄补 idle 映射
    store.setStatus(built.status === "empty" ? "idle" : built.status); // invalid-regex / matches-empty 直呈 UI
    store.applyCounts(0, 0);
    return;
  }
  view.dispatch(setSearchState(view.state.tr, built.query));
  appliedQuery = built.query;
  store.setStatus("ok");
  scheduleRecount();
}

/** 导航共用（F3/Enter 与按钮同源）；选区变化经即时通道回写序号 */
function navigate(dir: 1 | -1): void {
  const store = useSearchStore();
  const view = currentView();
  if (!view || !store.visible || !store.query) return;
  const built = builtFromStore();
  if (built.status !== "ok") return;
  const command = dir > 0 ? findNext : findPrev;
  command(view.state, (tr) => view.dispatch(tr));
}

/** 面板装配（组件 setup 内调用一次；返回句柄供 onUnmounted 成对释放） */
export function useFindController(): { dispose(): void } {
  const store = useSearchStore();
  const tabs = useTabsStore();

  // 结构通道：编辑（防抖）/ 切实例（adopt 广播）→ 重放 + 重计数
  const offDoc = editorManager.subscribeDocUpdated(() => {
    applyToView();
  });
  // 即时通道：活动序号回写 + 未挂查询时的首次交互愈合（残余①首挂窗口期兜底）。
  // 愈合派发必须延后到原生微任务：selectionUpdated 会在事务的插件 apply 阶段同步触发
  // （milkdown listener 的 prevSelection 待回调全部返回后才回填，实例首个事务必触发一次），
  // 此刻再 dispatch 会嵌套重入并再次命中空 prevSelection → 无限递归栈溢出（实测复现）
  const offSel = editorManager.subscribeSelectionUpdated((selection) => {
    if (!appliedQuery && store.visible && store.query) {
      // 原生 Promise 微任务不受假计时器影响；届时已挂查询则跳过（避免与常规派发重复）
      void Promise.resolve().then(() => {
        if (!appliedQuery) applyToView();
      });
      return;
    }
    if (appliedQuery) {
      store.setActiveIndex(activeMatchIndex(cachedMatches, selection.head));
    }
  });
  // 面板输入五元组变化 → 重放
  const stopInputs = watch(
    () =>
      [
        store.visible,
        store.query,
        store.replacement,
        store.caseSensitive,
        store.wholeWord,
        store.regexp,
      ] as const,
    () => applyToView(),
    { immediate: true },
  );
  // 标签切换：nextTick 等 activateInstance/adopt 完成后重放到新视图
  const stopTabWatch = watch(
    () => tabs.activeTabId,
    async () => {
      await nextTick();
      applyToView();
    },
  );

  return {
    dispose(): void {
      offDoc();
      offSel();
      stopInputs();
      stopTabWatch();
      if (recountTimer) clearTimeout(recountTimer);
      recountTimer = undefined;
    },
  };
}

/** F3 / Enter：下一个匹配（含尾回绕）；面板关闭或查询不可用时 no-op */
export function navigateNext(): void {
  navigate(1);
}

/** Shift+F3 / Shift+Enter：上一个匹配 */
export function navigatePrev(): void {
  navigate(-1);
}

/**
 * 替换当前项（「替换」按钮）
 *
 * 光标恰在匹配上 → 官方 replaceCurrent 原位替换 + findNext 前进到下一处
 * （AC-F25-4）；光标不在匹配上 → 官方 replaceNext 两段式先选中下一处
 * （再次点击才替换，与主流编辑器一致）。
 * @returns 是否执行了替换动作
 */
export function replaceOneInView(): boolean {
  const store = useSearchStore();
  const view = currentView();
  if (!view || !store.visible || !store.query) return false;
  const built = builtFromStore();
  if (built.status !== "ok") return false;
  const sel = view.state.selection;
  const onMatch = cachedMatches.some((m) => m.from === sel.from && m.to === sel.to);
  if (!onMatch) {
    return replaceNext(view.state, (tr) => view.dispatch(tr));
  }
  const ok = replaceCurrent(view.state, (tr) => view.dispatch(tr));
  if (ok) findNext(view.state, (tr) => view.dispatch(tr));
  scheduleRecount();
  return ok;
}

/**
 * 全部替换（「全部」按钮）：官方单事务合并全部替换步（一次 Ctrl+Z 全撤，
 * AC-F25-3），零长匹配死循环风险已在 buildSearchQuery 入口前置拒绝
 * @returns 是否发生替换
 */
export function replaceAllInView(): boolean {
  const store = useSearchStore();
  const view = currentView();
  if (!view || !store.visible || !store.query) return false;
  const built = builtFromStore();
  if (built.status !== "ok") return false;
  const ok = replaceAll(view.state, (tr) => view.dispatch(tr));
  if (ok) scheduleRecount(); // dispatch 会走 docUpdated 防抖，此处立即补计数更稳
  return ok;
}
