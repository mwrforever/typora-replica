// 关窗前源码层回写（12 窗口外壳 W6 修补：源码态静默数据丢失路径）
//
// 问题：Ctrl+/ 进源码模式后，CodeMirror 层键入不置脏、不产 markdownUpdated、
// 无草稿覆盖——直接 Alt+F4/点 X 时 collectDirtyTabs 为空 → 无脏直通 destroy，
// 本次源码层编辑静默丢失（无确认、无备份、无提示），与 AC-M-18「退出不丢数据」
// 精神冲突（12 code-review 审计必修项）。
//
// 修复语义（装配层接线于 onCloseRequested 第一步、drafts.backupIfNeeded 之前：
// 回写内容先进 PM 文档并置脏，脏过滤与草稿序列化才能捕获它——备份含源码层编辑）：
// - flushed：回写已进 PM 文档，但置脏链路（markdownUpdated 全链路 500ms 防抖 →
//   02 auto-save markDirty）尚未到达，不即时置脏则本轮聚合看不到该标签、仍会
//   静默 destroy——此处即时置脏使标签进入退出确认列表（AC-M-18 语义覆盖源码层编辑）；
// - failed：源码层编辑无法回写（编辑器丢失/宿主未就绪/回写抛错），按「该标签有
//   未保存内容」语义置脏拦截直通关窗 + console.error 留痕——用户见确认弹窗，
//   取消后重试关窗会再次尝试回写，不静默销毁；
// - clean / inactive：源码层无未回写编辑，不干预常规关窗流程。
import type { SourceFlushOutcome } from "./source-mode";

/** 关窗前源码层回写依赖（装配面注入：源码状态机执行体 + 04 簿记置脏通道） */
export interface SourceCloseFlushDeps {
  /** 源码模式单例的关窗回写执行体（回写决策核心在 source-mode 状态机） */
  flushPendingWrite: () => SourceFlushOutcome;
  /** 当前活跃标签 id（undefined = 无标签可置脏，如实放行——无标签即无内容可丢） */
  activeTabId: () => string | undefined;
  /** 置脏动作（04 store markDirty 透传；flushed/failed 两条路径消费） */
  markDirty: (tabId: string) => void;
}

/**
 * 关窗入口第一步：源码态未回写编辑回写 + 即时置脏（纯同步、无 IPC——不增加
 * 关窗链路时延）。失败路径不静默：置脏保证进确认弹窗，console.error 留痕。
 * @param deps 依赖注入（flushPendingWrite 执行体 / 活跃标签读取 / 置脏通道）
 */
export function flushSourceEditsBeforeClose(deps: SourceCloseFlushDeps): void {
  const outcome = deps.flushPendingWrite();
  if (outcome === "clean" || outcome === "inactive") return;
  // flushed/failed 统一即时置脏：前者让回写后的标签赶上本同步回调内的
  // collectDirtyTabs（500ms 防抖置脏来不及）；后者按「有未保存内容」拦截直通关窗
  const tabId = deps.activeTabId();
  if (tabId !== undefined) deps.markDirty(tabId);
  if (outcome === "failed") {
    console.error("[MarkWell] 关窗前源码层编辑回写失败，已按未保存内容拦截直通关窗");
  }
}
