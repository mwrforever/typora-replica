// 多标签编排控制器（04：App.vue 装配入口）
//
// 连接三件套：tabsStore（簿记）+ editor-registry（实例/会话栈）+ TabHost（挂载）。
// 每标签会话栈在此创建（D1：DocumentSession + AutoSaveController per-tab）；
// 脏状态经 session.onDirtyChange 桥接回 store（单一事件源 02 写盘事件驱动）。
//
// 模块级单例：TabHost 与 App.vue 各调一次 useTabsController 必须拿到同一实例
// （createController 顶层创建一次；实例/上下文状态若分属两份会互相丢失）。
import { reactive, ref } from "vue";
import type { Ref } from "vue";
import type { Crepe } from "@milkdown/crepe";
import { AutoSaveController } from "../document/auto-save";
import { DocumentSession } from "../document/document-session";
import type { SaveOutcome } from "../document/document-session";
import { editorManager } from "../editor/editor-manager";
import { saveAsDialog } from "../../services/open-commands";
import { loadSettings } from "../../services/settings";
import {
  activateInstance,
  getActiveSession,
  getInstance,
  recycleLeastRecent,
  registerInstance,
  unregisterInstance,
} from "./editor-registry";
import { MAX_TABS, useTabsStore } from "./tabs-store";

/** TabHost 挂载完成上报的编辑器实例（含工厂剥离出的 FM 内文） */
export interface TabInstanceReady {
  crepe: Crepe;
  frontMatter: string | null;
}

/** 每标签会话栈上下文（含挂载前未就绪的 crepe/FM 引用） */
interface TabContext {
  session: DocumentSession;
  autoSave: AutoSaveController;
  crepeRef: Crepe | undefined;
  frontMatterRef: string | null;
}

/** 控制器对外能力面（App.vue/TabHost 装配消费） */
export interface TabsController {
  store: ReturnType<typeof useTabsStore>;
  /** 挂载用 initialDoc（响应式；成功打开/新建路径写入，TabHost 据此装配） */
  initialDocs: Map<string, string>;
  /** LRU 已回收的标签（TabHost v-if 重建依据） */
  recycledIds: Set<string>;
  /** C2 脏标签关闭挂起（非 undefined 时 App.vue v-if 弹确认窗；Ref 供模板 .value 读取） */
  closeRequest: Ref<{ tabId: string; title: string } | undefined>;
  openFile(path: string, title: string): Promise<boolean>;
  createUntitled(): void;
  activate(id: string): void;
  closeTab(id: string): void;
  /** C2「保存」：走 02 保存链路（未命名转另存为），成功后关闭；失败保持打开 */
  confirmCloseSave(): Promise<void>;
  /** C2「不保存」：丢弃变更直接关闭（重开栈仍存关闭前内容——D4 语义安全网） */
  confirmCloseDiscard(): void;
  /** C2「取消」：中止关闭，标签与内容不变 */
  cancelClose(): void;
  reopenClosed(): void;
  cycle(dir: 1 | -1): void;
  onInstanceReady(tabId: string, inst: TabInstanceReady): void;
  activeSession(): DocumentSession | undefined;
  getContext(tabId: string): { serialize(): string } | undefined;
}

function createController(): TabsController {
  const store = useTabsStore();
  const contexts = new Map<string, TabContext>();
  const initialDocs = reactive(new Map<string, string>());
  const recycledIds = reactive(new Set<string>());
  const closeRequest = ref<{ tabId: string; title: string } | undefined>(undefined);

  /**
   * 序列化标签内容（finalizeClose 与 getContext 共用同口径，Task 14 收口防漂移）
   * 已挂载：按实例序列化（含 FM 回写）；未挂载：contentSnapshot 兜底（空串）。
   * @param id 标签 id（用于未挂载时从簿记取内容快照）
   * @param ctx 标签会话栈上下文
   */
  function serializeContent(id: string, ctx: TabContext): string {
    if (ctx.crepeRef) return editorManager.getMarkdownFor(ctx.crepeRef, ctx.frontMatterRef);
    return store.tabs.find((t) => t.id === id)?.contentSnapshot ?? "";
  }

  /**
   * 创建每标签会话栈：DocumentSession + AutoSaveController（D1）
   * @param tabId 标签 id（会话栈与簿记关联键）
   * @returns 会话栈上下文（crepeRef 挂载后由 onInstanceReady 填充）
   */
  function createContext(tabId: string): TabContext {
    const ctx: TabContext = {
      session: new DocumentSession(),
      autoSave: undefined as unknown as AutoSaveController,
      crepeRef: undefined,
      frontMatterRef: null,
    };
    // 事件桥接：脏状态回写簿记 + 内容广播捕获（openFile 成败判定依据）+
    // 用户提示（沿用 02 既有通知口径）
    ctx.session.on({
      // 成功打开/新建路径广播文档 → 内容入 initialDocs（TabHost 挂载输入；
      // openFile 失败不广播 → initialDocs 无该 id → 回滚挂起标签）
      onDocumentChange: (doc) => {
        initialDocs.set(tabId, doc.content);
      },
      onDirtyChange: (dirty) => (dirty ? store.markDirty(tabId) : store.markSaved(tabId)),
      onNotice: (notice) => {
        if (notice.level === "error") console.error("[MarkWell]", notice.message);
        else console.info("[MarkWell]", notice.message);
      },
    });
    ctx.autoSave = new AutoSaveController({
      session: ctx.session,
      getSettings: loadSettings,
      subscribeMarkdown: (cb) => editorManager.subscribeMarkdownUpdated(cb),
    });
    contexts.set(tabId, ctx);
    return ctx;
  }

  /**
   * 打开文件标签；同路径去重激活既有标签（created=false）。
   * 去重命中「已回收标签」时解除 recycled 标记：TabHost v-if 据此重挂载，
   * initialDoc 由 contentSnapshot 兜底提供（AC-F29-7 重建收口）。
   * 新标签：创建会话栈 → session.openFile 读入 → 内容就绪判定（监听捕获）；
   * 失败回滚（移除标签 + 丢弃上下文）。
   * @param path 文件完整路径
   * @param title 标签展示标题
   * @returns true=新建并已读入内容；false=去重激活或读取失败
   */
  async function openFile(path: string, title: string): Promise<boolean> {
    const { id, created } = store.openFile(path, title);
    if (!created) {
      // 去重命中「已回收标签」：解除回收标记 → TabHost 重挂载（store 已激活该标签，
      // 重建后 onInstanceReady → registerInstance → activateInstance 链路就绪）
      if (recycledIds.has(id)) recycledIds.delete(id);
      return false;
    }
    createContext(id);
    await contexts.get(id)!.session.openFile(path);
    // 02 会话 openFile 失败不广播 onDocumentChange → 内容未就绪 → 回滚挂起标签
    // （成功路径 onDocumentChange 监听已把内容写入 initialDocs）
    if (!initialDocs.has(id)) {
      store.removeTab(id);
      contexts.delete(id);
      return false;
    }
    store.markContentReady(id);
    maybeRecycle(id);
    return true;
  }

  /** 新建未命名标签（内容恒空串就绪，可直接挂载） */
  function createUntitled(): void {
    const id = store.createUntitled();
    createContext(id);
    initialDocs.set(id, "");
  }

  /**
   * 激活标签：簿记透传 + 回收标记解除（重建触发）
   * 回收标记解除完整联动（TabHost v-if 重新挂载/重建计数）由 Task 12 收口，
   * 本任务先做 store 透传 + 标记清除一行。
   */
  function activate(id: string): void {
    store.activate(id);
    // 回收标记解除：激活被 LRU 回收的标签即允许 TabHost 重建挂载
    if (recycledIds.has(id)) recycledIds.delete(id);
  }

  /**
   * 关闭标签（C2：脏标签挂起三按钮确认——AC-C2-1；干净标签直接关闭）
   * 挂起不关闭：closeRequest 供 App.vue v-if 弹窗，三按钮回调分别走
   * confirmCloseSave/confirmCloseDiscard/cancelClose 分支。
   * 内容序列化：已挂载取实例（含 FM 回写），未挂载取快照（重开未重建场景）。
   * @param id 目标标签 id（不存在或上下文已失则安全忽略）
   */
  function closeTab(id: string): void {
    const tab = store.tabs.find((t) => t.id === id);
    const ctx = contexts.get(id);
    if (!tab || !ctx) return;
    if (tab.dirty) {
      // 脏标签：挂起关闭请求，弹 C2 确认（AC-C2-1）——不直接关，内容不丢
      closeRequest.value = { tabId: id, title: tab.title };
      return;
    }
    finalizeClose(id);
  }

  /**
   * 关闭执行体（C2 干净直关 / 保存成功 / 不保存 三入口共用）：
   * 序列化关闭时内容入重开栈 → store 移除 + 邻位激活（D3 末标签自动新建）
   * → 注销实例 → 丢弃会话上下文。关闭恒存内容（D4：Ctrl+Shift+T 恢复脏快照）。
   * @param id 目标标签 id（上下文或簿记缺失则安全忽略）
   */
  function finalizeClose(id: string): void {
    const ctx = contexts.get(id);
    const tab = store.tabs.find((t) => t.id === id);
    if (!ctx || !tab) return;
    const content = serializeContent(id, ctx);
    store.closeTab(id, content);
    unregisterInstance(id);
    contexts.delete(id);
  }

  /**
   * C2「保存」：走 02 保存链路（未命名标签转另存为），保存成功才关闭（AC-C2-2/5）
   * 保存失败（io-error 等）：02 已广播错误 notice；finalize 不执行，标签保持打开
   * （弹窗已关，内容不丢）。另存为取消：中止，等价取消（无弹窗残留）。
   */
  async function confirmCloseSave(): Promise<void> {
    const req = closeRequest.value;
    if (!req) return;
    const ctx = contexts.get(req.tabId);
    if (!ctx) return;
    // 弹窗先关：后续保存（含另存为对话框）期间不再悬挂确认态
    closeRequest.value = undefined;
    let outcome: SaveOutcome;
    if (!ctx.session.currentPath) {
      // 未命名标签：先经另存为对话框取目标路径；取消（null）中止——标签保持打开
      const target = await saveAsDialog();
      if (!target) return;
      outcome = await ctx.session.saveAs(target);
    } else {
      outcome = await ctx.session.save();
    }
    if (outcome.saved) finalizeClose(req.tabId);
    // 失败：02 已广播错误 notice；标签保持打开（弹窗已关，内容不丢）
  }

  /** C2「不保存」：丢弃变更直接关闭（重开栈仍存关闭前内容——D4，AC-C2-3 语义安全网） */
  function confirmCloseDiscard(): void {
    const req = closeRequest.value;
    if (!req) return;
    closeRequest.value = undefined;
    finalizeClose(req.tabId);
  }

  /** C2「取消」：中止关闭，标签与内容不变（AC-C2-3） */
  function cancelClose(): void {
    closeRequest.value = undefined;
  }

  /** LIFO 重开最近关闭：新 id + 恢复关闭前内容快照（脏标签重开仍脏） */
  function reopenClosed(): void {
    const id = store.reopenClosed();
    if (!id) return;
    createContext(id);
    const tab = store.tabs.find((t) => t.id === id)!;
    // 快照作 initialDoc（重开的标签必是新 id、无存活实例 → 恒走重挂载路径；
    // 内容快照为空串时跳过——initialDocs 无键即空文档）
    if (tab.contentSnapshot) initialDocs.set(id, tab.contentSnapshot);
  }

  /** Ctrl+Tab 轮换（簿记透传） */
  function cycle(dir: 1 | -1): void {
    store.cycle(dir);
  }

  /**
   * TabHost 挂载完成上报：登记实例 + 清除快照 + 激活（打开新标签路径）。
   * 未知 tabId（上下文已回滚/关闭）安全忽略。
   */
  function onInstanceReady(tabId: string, inst: TabInstanceReady): void {
    const ctx = contexts.get(tabId);
    if (!ctx) return;
    ctx.crepeRef = inst.crepe;
    ctx.frontMatterRef = inst.frontMatter;
    registerInstance(tabId, {
      crepe: inst.crepe,
      frontMatter: inst.frontMatter,
      session: ctx.session,
      autoSave: ctx.autoSave,
      lastActivatedAt: Date.now(),
    });
    store.clearSnapshot(tabId);
    // 挂载完成即激活（打开新标签的路径：store 已置 activeTabId）
    if (store.activeTabId === tabId) activateInstance(tabId);
  }

  /**
   * 超限回收：新标签挂载后触发（victim 恒非激活标签——激活标签必为最近激活，
   * 排除新标签后最久未激活者即 victim）
   * 流程：victim 内容快照（getMarkdownFor 含 FM）入 store → 注销实例 → 登记回收
   * 标记（TabHost v-if 据此卸载重建）。
   */
  function maybeRecycle(newTabId: string): void {
    if (store.tabs.length <= MAX_TABS) return;
    const victimId = recycleLeastRecent(newTabId);
    if (!victimId) return;
    const victim = getInstance(victimId);
    if (victim) {
      const content = editorManager.getMarkdownFor(victim.crepe, victim.frontMatter);
      store.setSnapshot(victimId, content);
    }
    unregisterInstance(victimId);
    recycledIds.add(victimId);
  }

  /** 激活标签会话（App.vue 保存/拖入/快速打开消费） */
  function activeSession(): DocumentSession | undefined {
    return getActiveSession();
  }

  /**
   * 取标签序列化上下文（Task 14 草稿聚合消费）
   * 返回 context 的序列化包装（不暴露内部）：挂载取实例（含 FM 回写），
   * 未挂载取 contentSnapshot 兜底——与 finalizeClose 同口径（serializeContent 共用）。
   * 未知 tabId（上下文已失）返回 undefined。
   */
  function getContext(tabId: string): { serialize(): string } | undefined {
    const ctx = contexts.get(tabId);
    if (!ctx) return undefined;
    return {
      serialize(): string {
        return serializeContent(tabId, ctx);
      },
    };
  }

  return {
    store,
    initialDocs,
    recycledIds,
    closeRequest,
    openFile,
    createUntitled,
    activate,
    closeTab,
    confirmCloseSave,
    confirmCloseDiscard,
    cancelClose,
    reopenClosed,
    cycle,
    onInstanceReady,
    activeSession,
    getContext,
  };
}

/**
 * 控制器模块级单例（TabHost 与 App.vue 装配各调一次必须拿到同一实例——
 * 每标签会话栈/回收标记等状态跨调用共享）
 *
 * 惰性初始化：useTabsStore 必须在 Pinia 安装后调用（组件 setup 期），
 * 若在模块加载期（App.vue import 链）直接实例化会因无活跃 Pinia 抛错，
 * 导致整个应用白屏（E2E 首跑暴露）。
 */
let controller: TabsController | undefined;

export function useTabsController(): TabsController {
  controller ??= createController();
  return controller;
}
