// 退出聚合确认状态机（12 窗口外壳 W6；AC-M-18~21）
//
// 单一职责：窗口关闭请求的统一决策入口——聚合全部脏标签 → 列表式一次性确认
// （全部保存/全部不保存/取消）→ 逐标签写盘 → 关窗；无脏标签直通关窗。
// 全部能力面注入（04 脏聚合/saveTab、02 自动保存暂停恢复、services 关窗），
// 本层不 import 04/02 内部实现——纯状态编排可核心 100% 单测（12 spec §4）。
//
// 状态机：idle → confirming（列表已冻结）→ saving（逐标签写盘中）→ closing /
// cancelled。closing 为成功关窗的终态（窗口随即销毁）；cancelled 为取消/写盘
// 失败后的静止态（弹窗已关、窗口保持），再次关闭请求从 cancelled 重新聚合新轮次。
//
// 设计决策（披露）：
// 1. 冻结语义——聚合时点冻结标签 id 列表，写盘序列化惰性发生在 saveTab 时点：
//    冻结标签在弹窗期的新编辑一并写入盘（不丢）；聚合时干净、弹窗期才变脏的
//    标签不进本轮，由关窗前复核兜底（见 2）。
// 2. 关窗前复核聚合——全部保存成功/全部不保存两条关窗路径先复核脏集合：
//    出现本轮之外的新脏标签（弹窗期键盘编辑等）则开启新一轮确认而非静默关窗，
//    防内容随 destroy 丢失；全部不保存复核时排除本轮冻结列表（已显式放弃，
//    不得重复弹窗）。复核为空 = 常规路径，行为与 AC 一致。
// 3. 写盘失败策略——单标签失败不阻断其余（顺序尝试完整列表）；任一失败窗口
//    保持（不部分关闭），失败标签保持脏态留在窗口（02 已广播错误提示），恢复
//    自动保存后用户可再次关闭重试。
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
  /** 暂停自动保存（confirming+saving 全程不写盘；实现为全实例 stop，幂等） */
  suspendAutoSave(): void;
  /** 恢复自动保存（仅激活标签 start；取消/写盘失败/关窗失败回退路径消费） */
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
 * @returns 控制器句柄（phase/dirtyTabs 为 Ref，三按钮与关闭入口为方法）
 */
export function createExitConfirm(deps: ExitConfirmDeps): ExitConfirmController {
  /** 当前阶段（初始空闲） */
  const phase = ref<ExitConfirmPhase>("idle");
  /** 本轮冻结的脏标签列表（弹窗列表展示与写盘对象） */
  const dirtyTabs = ref<DirtyTabEntry[]>([]);

  /**
   * 关窗共步（全部保存成功/全部不保存两入口共用）：先复核聚合——排除本轮已
   * 决标签后仍有新脏（弹窗期键盘编辑）则开启新一轮确认而非静默关窗（防内容随
   * destroy 丢失）；复核为空才关窗。关窗失败（IPC reject，窗口仍存活）恢复
   * 自动保存并回退 idle——若困死 closing，后续关闭请求会被重入守卫全部忽略。
   * @param exclude 复核时排除的标签 id（全部不保存传本轮冻结列表——已显式放弃；
   *   全部保存传空集：保存成功的标签经 02 markSaved 已清除脏标记，写盘期间
   *   新编辑经纪元守卫保持脏态，应再次进入确认）
   */
  async function proceedClose(exclude: ReadonlySet<string>): Promise<void> {
    const fresh = deps.collectDirtyTabs().filter((t) => !exclude.has(t.id));
    if (fresh.length > 0) {
      // 新一轮确认：列表以最新脏集合重建（自动保存已在本轮暂停，幂等再停一次
      // 以维持「confirming ⇒ 已暂停」不变量——无脏直通路径进入时可能尚未暂停）
      deps.suspendAutoSave();
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
    // 有脏：冻结列表 + 暂停自动保存（弹窗期不写盘），进入确认（AC-M-18）
    deps.suspendAutoSave();
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
    phase.value = "saving";
    let allSaved = true;
    for (const entry of dirtyTabs.value) {
      const outcome = await deps.saveTab(entry.id);
      if (!outcome.saved) allSaved = false;
    }
    if (!allSaved) {
      // 任一失败：窗口保持（失败标签仍脏留窗），恢复自动保存，回静止态
      deps.resumeAutoSave();
      phase.value = "cancelled";
      return;
    }
    // 全部成功：复核弹窗期新变脏标签后关窗（排除空集——已保存标签已清除脏标记）
    await proceedClose(new Set<string>());
  }

  /**
   * 「全部不保存」：用户显式一次性决定放弃本轮列表变更——不写盘直接关窗
   * （与 04 单标签关闭的逐标签脏确认语义不同，退出聚合不再二次确认）；
   * 复核排除本轮冻结列表，弹窗期新变脏的其他标签仍获新一轮确认。
   */
  async function discardAll(): Promise<void> {
    if (phase.value !== "confirming") return;
    const exclude = new Set(dirtyTabs.value.map((t) => t.id));
    await proceedClose(exclude);
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

  return { phase, dirtyTabs, handleCloseRequest, saveAll, discardAll, cancel };
}
