// 退出聚合确认状态机（12 窗口外壳 W6；AC-M-18~21）
//
// 单一职责：窗口关闭请求的统一决策入口——聚合全部脏标签 → 列表式一次性确认
// （全部保存/全部不保存/取消）→ 逐标签写盘 → 关窗；无脏标签直通关窗。
// 全部能力面注入（04 脏聚合/saveTab、02 自动保存暂停恢复、services 关窗），
// 本层不 import 04/02 内部实现——纯状态编排可核心 100% 单测（12 spec §4）。
//
// 状态机：idle → confirming（列表已冻结）→ saving（逐标签写盘中）→ closing /
// cancelled。closing 为成功关窗的终态（窗口随即销毁）；cancelled 为取消后的
// 静止态（弹窗已关、窗口保持），再次关闭请求从 cancelled 重新聚合新轮次；
// 写盘失败回到 confirming 复显弹窗（见设计决策 3）。
//
// 设计决策（披露）：
// 1. 冻结语义——聚合时点冻结标签 id 列表，写盘序列化惰性发生在 saveTab 时点：
//    冻结标签在弹窗期的新编辑一并写入盘（不丢）；聚合时干净、弹窗期才变脏的
//    标签不进本轮，由关窗前复核兜底（见 2）。
// 2. 关窗前复核聚合——全部保存成功/全部不保存两条关窗路径先复核脏集合：出现
//    本轮之外的新脏标签则开启新一轮确认而非静默关窗，防内容随 destroy 丢失。
//    弹窗期新变脏在生产可达：自动保存暂停只停保存定时器，标脏订阅保持活跃
//    （02 双通道），弹窗期键盘编辑照常置脏。全部不保存复核时排除累计放弃集
//    （本轮及此前各复核轮次已显式放弃的标签不得重复弹窗——否则两轮互相把对方
//    已放弃标签拉回，用户永远无法退出）；复核为空 = 常规路径，行为与 AC 一致。
// 3. 写盘失败策略——单标签失败不阻断其余（顺序尝试完整列表）；任一失败窗口
//    保持（不部分关闭），回到 confirming 复显弹窗并在错误区展示失败原因（02
//    会话错误通知在 04 装配层仅控制台留痕，弹窗错误区是用户可见的唯一反馈），
//    自动保存保持暂停；用户可改选「全部不保存」/「取消」，或排除故障后重试。
// 4. 关窗出口必须 destroy 而非 close——onCloseRequested 监听在册时 Tauri 对
//    close 请求自动阻止并再次回调 JS，close 只会重入确认流程形成死循环。
import { ref } from "vue";
import type { Ref } from "vue";
import type { SaveOutcome } from "../document/document-session";

/** 退出聚合确认阶段（弹窗显隐 = confirming|saving；其余为决策间态与终态） */
export type ExitConfirmPhase = "idle" | "confirming" | "saving" | "closing" | "cancelled";

/** 脏标签条目（列表式确认 UI 展示项；JSON 值对象，宪法 A.7） */
export interface DirtyTabEntry {
  /** 标签 id（逐标签写盘的关联键，来源 04 store） */
  id: string;
  /** 展示标题（文件名；未命名标签为 Untitled N） */
  title: string;
}

/** 退出聚合状态机依赖（04/02/services 能力面注入；装配见 App.vue） */
export interface ExitConfirmDeps {
  /** 聚合当前全部脏标签（04 store filter dirty；调用时点快照） */
  collectDirtyTabs(): DirtyTabEntry[];
  /** 逐标签写盘（04 saveTab → 02 session.save 链路；总函数不抛错——
   *  未知标签等竞态以 saved:false 产物表达） */
  saveTab(tabId: string): Promise<SaveOutcome>;
  /** 暂停自动保存保存通道（confirming+saving 全程不写盘；实现为全实例挂起
   *  保存定时器——标脏订阅保持活跃，弹窗期编辑照常置脏供复核聚合；幂等） */
  suspendAutoSave(): void;
  /** 恢复自动保存（仅激活标签重启保存定时器；取消/关窗失败回退路径消费——
   *  写盘失败不复显弹窗路径保持暂停，confirming 不变量不破） */
  resumeAutoSave(): void;
  /** 关闭窗口（services destroyCurrentWindow——禁 close 防确认死循环） */
  closeWindow(): Promise<void>;
}

/** 退出聚合确认控制器句柄（App 装配层持有；每窗口独立实例，跨窗口无共享） */
export interface ExitConfirmController {
  /** 当前阶段（弹窗显隐与按钮禁用驱动；Ref 供装配层 computed 解包） */
  phase: Ref<ExitConfirmPhase>;
  /** 本轮冻结的脏标签列表（进入 confirming 时点快照；saving 期间不再变化） */
  dirtyTabs: Ref<DirtyTabEntry[]>;
  /** 最近一次写盘失败的失败消息（confirming 态弹窗错误区展示；开启新一轮
   *  确认或重试写盘时清除，undefined = 无待展示失败） */
  failMessage: Ref<string | undefined>;
  /** 窗口关闭请求统一入口（onCloseRequested 接线调用；可重入安全） */
  handleCloseRequest(): Promise<void>;
  /** 「全部保存」：按冻结列表顺序逐标签写盘，全部成功才关窗 */
  saveAll(): Promise<void>;
  /** 「全部不保存」：不写盘直接关窗（丢弃本轮列表变更，不再逐标签确认） */
  discardAll(): Promise<void>;
  /** 「取消」：中止本轮，窗口保持、内容不变 */
  cancel(): void;
}

/**
 * 创建退出聚合确认状态机（App 装配层调用一次；每窗口独立实例）
 * @param deps 能力面注入（脏聚合/逐标签写盘/自动保存暂停恢复/关窗）
 * @returns 控制器句柄（phase/dirtyTabs/failMessage 为 Ref，三按钮与关闭入口为方法）
 */
export function createExitConfirm(deps: ExitConfirmDeps): ExitConfirmController {
  /** 当前阶段（初始空闲） */
  const phase = ref<ExitConfirmPhase>("idle");
  /** 本轮冻结的脏标签列表（弹窗列表展示与写盘对象） */
  const dirtyTabs = ref<DirtyTabEntry[]>([]);
  /** 最近一次写盘失败的失败消息（弹窗错误区；新一轮确认或重试时清除） */
  const failMessage = ref<string | undefined>(undefined);
  /** 累计放弃集：一次关闭流程内用户已显式放弃（全部不保存）的标签 id——
   *  复核聚合据此排除，防已放弃标签在后续复核轮次反复弹回形成死循环；
   *  新的 handleCloseRequest 开启新决策点时清空（用户重新关闭 = 重新决策） */
  const abandonedIds = new Set<string>();

  /**
   * 关窗共步（全部保存成功/全部不保存两入口共用）：先复核聚合——排除累计放弃
   * 集后仍有新脏（弹窗期键盘编辑等）则开启新一轮确认而非静默关窗（防内容随
   * destroy 丢失）；复核为空才关窗。关窗失败（IPC reject，窗口仍存活）恢复
   * 自动保存并回退 idle——若困死 closing，后续关闭请求会被重入守卫全部忽略。
   * @exception 不抛出——closeWindow 的 IPC reject 已就地捕获并回退交互态
   */
  async function proceedClose(): Promise<void> {
    const fresh = deps.collectDirtyTabs().filter((t) => !abandonedIds.has(t.id));
    if (fresh.length > 0) {
      // 新一轮确认：列表以最新脏集合重建（自动保存已在本流程暂停，幂等再停
      // 一次维持「confirming ⇒ 已暂停」不变量），并清除上一轮失败残留
      deps.suspendAutoSave();
      failMessage.value = undefined;
      dirtyTabs.value = fresh;
      phase.value = "confirming";
      return;
    }
    phase.value = "closing";
    try {
      await deps.closeWindow();
    } catch (error) {
      console.error("[MarkWell] 窗口关闭失败（已回退交互态，可再次关闭）", error);
      deps.resumeAutoSave();
      phase.value = "idle";
    }
  }

  /**
   * 窗口关闭请求统一入口（onCloseRequested 接线调用）。
   * 弹窗期/写盘期/关窗期的重入安全忽略（弹窗已模态展示或写盘进行中，防重复
   * 聚合/重复写盘）；cancelled 为上一轮取消后的静止态，等同 idle 开新轮。
   * 无脏标签直通关窗（AC-M-21，草稿备份由接线层先行完成）；直通关窗失败仅
   * 记录（本路径未暂停任何资源，阶段保持 idle 无需回退）。
   */
  async function handleCloseRequest(): Promise<void> {
    if (phase.value !== "idle" && phase.value !== "cancelled") return;
    // 新决策点：清空上一流程的累计放弃集（用户重新关闭 = 允许重新决策全部标签）
    abandonedIds.clear();
    const entries = deps.collectDirtyTabs();
    if (entries.length === 0) {
      // 无脏直通：不弹窗直接关窗（AC-M-21）
      try {
        await deps.closeWindow();
      } catch (error) {
        console.error("[MarkWell] 窗口关闭失败（未涉及确认流程，可再次关闭）", error);
      }
      return;
    }
    // 有脏：冻结列表 + 暂停自动保存保存通道（弹窗期不写盘、编辑仍置脏），进确认
    deps.suspendAutoSave();
    failMessage.value = undefined;
    dirtyTabs.value = entries;
    phase.value = "confirming";
  }

  /**
   * 「全部保存」：按冻结列表顺序逐标签写盘（序列化惰性在写盘时点执行——弹窗期
   * 对冻结标签的新编辑一并写入）。单标签失败不阻断其余（失败策略见文件头 3）；
   * 全部成功经复核后关窗（AC-M-19）。
   */
  async function saveAll(): Promise<void> {
    // 双击/非确认态守卫：写盘仅能从 confirming 发起一次
    if (phase.value !== "confirming") return;
    failMessage.value = undefined;
    phase.value = "saving";
    let failure: string | undefined;
    for (const entry of dirtyTabs.value) {
      const outcome = await deps.saveTab(entry.id);
      // 单标签失败不阻断其余：记录首条失败原因继续尝试完整列表
      if (!outcome.saved) failure ??= outcome.message;
    }
    if (failure !== undefined) {
      // 失败：窗口保持（失败标签仍脏留窗），回确认态复显弹窗并展示失败原因——
      // 自动保存保持暂停（confirming 不变量未破），用户可改选「全部不保存」/
      // 「取消」或排除故障后重试；不恢复自动保存（resume 仅属取消/关窗失败路径）
      failMessage.value = failure;
      phase.value = "confirming";
      return;
    }
    // 全部成功：复核弹窗期新变脏标签后关窗（已保存标签经 02 markSaved 清除
    // 脏标记自然不进复核；累计放弃集排除历史显式放弃标签）
    await proceedClose();
  }

  /**
   * 「全部不保存」：用户显式一次性决定放弃本轮列表变更——不写盘直接关窗
   * （与 04 单标签关闭的逐标签脏确认语义不同，退出聚合不再二次确认）；
   * 本轮列表并入累计放弃集，弹窗期新变脏且未放弃的其他标签仍获新一轮确认。
   */
  async function discardAll(): Promise<void> {
    if (phase.value !== "confirming") return;
    for (const entry of dirtyTabs.value) abandonedIds.add(entry.id);
    await proceedClose();
  }

  /**
   * 「取消」：中止本轮（AC-M-20）——回 cancelled 静止态：弹窗关、窗口保持、
   * 内容不变（无写盘无关窗），恢复自动保存。再次关闭请求从静止态重新聚合。
   */
  function cancel(): void {
    if (phase.value !== "confirming") return;
    deps.resumeAutoSave();
    phase.value = "cancelled";
  }

  return { phase, dirtyTabs, failMessage, handleCloseRequest, saveAll, discardAll, cancel };
}
