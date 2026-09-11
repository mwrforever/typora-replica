// 源码模式切换状态机（12 窗口外壳 W4；spec §2 源码模式 AC-M-6/7/8）
//
// 职责：WYSIWYG ↔ 源码模式（CodeMirror 6）双向切换的决策核心——内容装载、
// 光标映射（01 source-pos 增补接口）、编辑回写（01 editorManager.setContent
// 增补接口）、光标恢复（复用 01 revealRange 锁定接口）。双实例保活：本状态机
// 不创建/销毁任何编辑器实例，只驱动视图层 v-show 显隐（Crepe 实例由 04 TabHost
// 保活、CodeMirror 实例由 SourceModeLayer.vue 保活）。
//
// 形态：createSourceMode 依赖全注入（编辑器侧 SourceModeDeps + 源码层宿主
// SourceModeHost），核心 100% 单测；真实依赖装配于 useSourceMode() 模块级单例
// （AppShell 与 App.vue 各取同实例——菜单 action 与 Ctrl+/ 快捷键共用同一命令
// 函数，AC-M-3 单一执行路径）。
//
// 焦点时序契约（I1）：host.focus()/focusEditor() 由单例装配层在 syncActive()
// （v-show 翻转）后的 nextTick 调用——状态机核心不直接聚焦（同步窗口内目标容器
// display:none 时 focus 是 no-op，键盘输入会丢失）。
//
// MVP 取舍（随 PR 披露）：
// - 内容同步只在切出与关窗入口回写时做（flushPendingWrite，不做逐键双向实时同步）；
// - 源码层为当前活跃标签的单一视图层（不为每标签建 CM 实例）；标签切换时
//   刷新为活跃标签内容，切换瞬间源码层未回写的编辑随刷新丢弃（04 无按标签
//   写回接口，留后续工作包；丢弃时经 discardNotice 给用户可见信号）。
import { nextTick, ref, watch } from "vue";
import type { Ref } from "vue";
import type { Editor } from "@milkdown/kit/core";
import { editorManager } from "../editor/editor-manager";
import { parseFrontMatter } from "../editor/frontmatter/frontmatter";
import { lineColToPmPos, pmPosToLineCol } from "../editor/source-pos";
import type { LineCol } from "../editor/source-pos";
import { revealRange } from "../editor/reveal-range";
import { useTabsController } from "../tabs/tabs-controller";

/** 源码模式状态（wysiwyg = 所见即所得；source = 源码编辑） */
export type SourceModeState = "wysiwyg" | "source";

/**
 * 编辑器侧依赖（01 锁定/增补接口的薄回调；Editor 形参同 revealRange 先例，
 * PM 域对象不越过本接口的回调边界）
 */
export interface SourceModeDeps {
  /** 当前激活编辑器实例（未创建 undefined） */
  getEditor: () => Editor | undefined;
  /** 当前文档全文（完整落盘形态，含 Front Matter 回写） */
  getMarkdown: () => string;
  /** 全文替换回写（单事务保 undo；仅内容变更时由状态机调用） */
  setContent: (markdown: string) => void;
  /** 当前 PM 光标位置（选区 head——反向选区时恢复点为光标点而非选区起点） */
  getPmCursor: () => number;
  /** PM 偏移 → 行列（正文口径，Front Matter 偏移由状态机折算） */
  pmPosToLineCol: (editor: Editor, pmPos: number) => LineCol;
  /** 行列 → PM 偏移（切出光标恢复；回写后以新文档现算） */
  lineColToPmPos: (editor: Editor, pos: LineCol) => number;
  /** 选区定位 + 滚动可视区（切出光标恢复载体；高亮时长由状态机给极短值） */
  revealRange: (editor: Editor, from: number, to: number, durationMs?: number) => void;
}

/** 源码层宿主接口（SourceModeLayer.vue 以 CodeMirror 6 实现；测试以内存 mock 实现） */
export interface SourceModeHost {
  /** CodeMirror 实例是否就绪（未挂载 false——切入前置守卫） */
  isReady(): boolean;
  /** 装载全文并落光标（行列 0 起；越界由实现侧收敛合法位置） */
  load(text: string, cursor: LineCol): void;
  /** 读当前全文（切出回写判定与光标折算基准） */
  getText(): string;
  /** 读当前光标行列（0 起） */
  getCursor(): LineCol;
  /** 聚焦源码层（切入后键盘焦点移交；由装配层在 v-show 翻转渲染后调用） */
  focus(): void;
}

/** 切出光标恢复的 revealRange 高亮时长：1ms 近乎无感（复用接口签名的最小副作用取值） */
const REVEAL_BRIEF_MS = 1;

/** 丢弃未回写编辑的用户可见提示自动消隐时长（毫秒） */
const DISCARD_NOTICE_MS = 4000;

/**
 * 关窗前回写产物（装配层 close-flush 据此决定置脏/告警路径）
 */
export type SourceFlushOutcome =
  /** 非源码态：无源码层编辑面，无需处置 */
  | "inactive"
  /** 源码态但源码层与切入基准一致：无未回写编辑 */
  | "clean"
  /** 未回写编辑已回写进编辑器（装配层须即时置脏使标签进入退出聚合） */
  | "flushed"
  /** 疑似存在未回写编辑但无法回写（编辑器丢失/宿主未就绪/回写抛错）——
   *  装配层不得静默放行关窗（按「有未保存内容」语义置脏拦截） */
  | "failed";

/**
 * 折算 Front Matter 行偏移（源码全文行号 ↔ 正文行号）
 * @param text 源码全文（含或不含 FM）
 * @returns 正文起始行号偏移：无 FM 为 0；有 FM 为「内文行数 + 2 条定界行」
 *          （回写形态 = `---\n<内文>\n---\n`，reinsertFrontMatter 契约）
 */
function frontMatterLineOffset(text: string): number {
  const { frontMatter } = parseFrontMatter(text);
  if (frontMatter === null) return 0;
  return frontMatter.split("\n").length + 2;
}

/** 切换状态机（纯决策核心，依赖注入；不持任何编辑器域对象） */
export interface SourceModeController {
  /** 当前模式（读值；视图层响应式显隐由 useSourceMode 的 active 承载） */
  getState(): SourceModeState;
  /** 切入源码模式；编辑器/宿主未就绪或映射异常返回 false 状态不变，已源码态幂等 no-op */
  enter(): boolean;
  /** 切出；非源码态 no-op 返回 false；编辑器丢失/宿主未就绪降级复位（不回写）；
   *  回写失败保持源码态可重试（防内容丢失） */
  exit(): boolean;
  /** 双向切换（Ctrl+/ 与菜单「源码模式」共用入口） */
  toggle(): boolean;
  /** 关窗前回写（不切换状态）：源码态且有未回写编辑时按 exit() 同路径单事务
   *  回写进编辑器，状态保持 source；产物语义见 SourceFlushOutcome */
  flushPendingWrite(): SourceFlushOutcome;
  /** 标签切换时刷新为活跃标签内容（仅源码态有意义；未回写编辑丢弃并告警） */
  syncToActiveTab(): void;
}

/**
 * 创建切换状态机
 * @param deps 编辑器侧依赖（01 接口薄回调）
 * @param host 源码层宿主（CM6 实现）
 */
export function createSourceMode(deps: SourceModeDeps, host: SourceModeHost): SourceModeController {
  let state: SourceModeState = "wysiwyg";
  /**
   * 切入时装载的全文：切出/关窗回写的变更判定基准（无变化不回写，防空 undo 步）；
   * 关窗回写成功后同步为已回写文本（源码层与编辑器已一致，后续 exit 判定不再
   * 重复回写产生冗余 undo 步）
   */
  let pendingText = "";

  const enter = (): boolean => {
    if (state === "source") return true;
    const editor = deps.getEditor();
    // 双前置守卫：编辑器未就绪时 getMarkdown 为空串，切入会污染源码层
    if (editor === undefined || !host.isReady()) return false;
    try {
      const text = deps.getMarkdown();
      const cursor = deps.pmPosToLineCol(editor, deps.getPmCursor());
      const offset = frontMatterLineOffset(text);
      pendingText = text;
      // 正文行列 + FM 行偏移 = 源码全文行列（源码含 FM 头，正文行号整体下移）
      host.load(text, { line: cursor.line + offset, col: cursor.col });
    } catch (error) {
      // 竞态窗口（adopt 早于 create 完成）内 editor.action 可能抛错（01 已记载）——
      // 降级不切入，避免半初始化状态；焦点/显隐均未翻转，无副作用残留
      console.warn("[MarkWell] 源码模式切入失败（编辑器未就绪或映射异常），已忽略", error);
      return false;
    }
    state = "source";
    return true;
  };

  const exit = (): boolean => {
    if (state !== "source") return false;
    const editor = deps.getEditor();
    if (editor === undefined || !host.isReady()) {
      // 编辑器丢失（标签关闭等边缘）：降级复位，不回写不崩溃
      state = "wysiwyg";
      return false;
    }
    try {
      const text = host.getText();
      // AC-M-8：仅内容变更时回写（单事务全文替换，undo 一步可回退）
      if (text !== pendingText) deps.setContent(text);
    } catch (error) {
      // 回写失败：保持源码态让用户可重试切出（防编辑内容丢失）
      console.warn("[MarkWell] 源码模式回写失败，已保持源码模式可重试", error);
      return false;
    }
    try {
      // 光标恢复：源码行 − FM 偏移 = 正文行；setContent 后映射以新文档现算。
      // 恢复失败不阻断切出（光标降级为编辑器当前位），内容已安全回写
      const cursor = host.getCursor();
      const pos = deps.lineColToPmPos(editor, {
        line: Math.max(cursor.line - frontMatterLineOffset(host.getText()), 0),
        col: cursor.col,
      });
      deps.revealRange(editor, pos, pos, REVEAL_BRIEF_MS);
    } catch (error) {
      console.warn("[MarkWell] 源码模式光标恢复失败（已切出，光标降级）", error);
    }
    state = "wysiwyg";
    return true;
  };

  /**
   * 关窗前回写（不切换状态）：源码态下读源码层全文与切入基准比对，有差异则
   * 单事务回写进编辑器（与 exit() 同一 setContent 路径），状态保持 source。
   * 与 exit() 的差异：不恢复光标/不翻转状态——关窗链路只要内容进编辑器并置脏，
   * 后续聚合确认与写盘由 12 W6 退出状态机统一处置。
   */
  const flushPendingWrite = (): SourceFlushOutcome => {
    if (state !== "source") return "inactive";
    const editor = deps.getEditor();
    // 编辑器丢失/宿主未就绪：源码层文本不可读不可写，无法排除未回写编辑——
    // 按「有未保存内容」语义上报失败（装配层据此拦截直通关窗），状态保持可重试
    if (editor === undefined || !host.isReady()) return "failed";
    try {
      const text = host.getText();
      // 与 exit() 同一变更判定基准：无差异不回写（防空 undo 步）
      if (text === pendingText) return "clean";
      deps.setContent(text);
      // 基准随回写前移：后续 exit() 判定已一致，不再重复回写
      pendingText = text;
    } catch (error) {
      console.warn("[MarkWell] 关窗前源码层回写失败，已按未保存内容拦截关窗", error);
      return "failed";
    }
    return "flushed";
  };

  return {
    getState: () => state,
    enter,
    exit,
    toggle: () => (state === "source" ? exit() : enter()),
    flushPendingWrite,
    syncToActiveTab: () => {
      if (state !== "source") return;
      const editor = deps.getEditor();
      // 宿主未就绪（层已卸载等）：无可刷新目标，静默跳过
      if (editor === undefined || !host.isReady()) return;
      // 未回写编辑随刷新丢弃（04 无按标签写回接口——中期维持 TASK.md 12#2 登记）。
      // console 留痕之外经 discardNotice 给用户可见信号（丢弃是数据有损操作，
      // 静默不可接受；呈现通道见 UseSourceModeReturn.discardNotice）
      if (host.getText() !== pendingText) {
        console.warn("[MarkWell] 源码模式存在未回写编辑，随标签切换丢弃");
        onDiscardEdits?.();
      }
      const text = deps.getMarkdown();
      const cursor = deps.pmPosToLineCol(editor, deps.getPmCursor());
      pendingText = text;
      host.load(text, { line: cursor.line + frontMatterLineOffset(text), col: cursor.col });
    },
  };
}

/** 丢弃编辑的可见信号回调（单例装配层注入；核心层不持 UI 状态） */
let onDiscardEdits: (() => void) | undefined;

/** 单例装配句柄（AppShell 绑定显隐、App.vue 绑定命令、SourceModeLayer 上缴宿主） */
export interface UseSourceModeReturn extends SourceModeController {
  /** 源码层显隐（视图层 v-show 绑定；true = 源码模式） */
  readonly active: Ref<boolean>;
  /** 丢弃未回写编辑的用户可见提示（空串 = 无提示；数秒后自动消隐） */
  readonly discardNotice: Ref<string>;
  /** 注册/注销源码层宿主（SourceModeLayer 挂载上缴、卸载传 undefined） */
  setHost(host: SourceModeHost | undefined): void;
}

/** 模块级单例（与 useTabsController 同形态：多处调用同一实例） */
let singleton: UseSourceModeReturn | undefined;

/**
 * 源码模式单例装配（真实依赖接线；首调创建，后续复用）
 *
 * 标签切换联动：watch 04 tabs store 的 activeTabId，源码态下刷新源码层为
 * 新活跃标签内容（watcher 晚于 04 激活 watcher 创建，门面已指向新标签）。
 */
export function useSourceMode(): UseSourceModeReturn {
  if (singleton) return singleton;
  const active = ref(false);
  /** 丢弃未回写编辑的用户可见提示（SourceModeLayer 浮层渲染源） */
  const discardNotice = ref("");
  /** 提示消隐定时器（重入重置；undefined = 无待触发定时器） */
  let discardNoticeTimer: ReturnType<typeof setTimeout> | undefined;
  /** 核心层丢弃回调 → 可见信号置位 + 定时消隐 */
  onDiscardEdits = () => {
    discardNotice.value = "源码模式存在未回写编辑，切换标签后已丢弃";
    if (discardNoticeTimer !== undefined) clearTimeout(discardNoticeTimer);
    discardNoticeTimer = setTimeout(() => {
      discardNoticeTimer = undefined;
      discardNotice.value = "";
    }, DISCARD_NOTICE_MS);
  };
  /** 宿主槽位（SourceModeLayer 挂载上缴；转发宿主解耦生命周期时序） */
  let hostSlot: SourceModeHost | undefined;
  const forwardingHost: SourceModeHost = {
    isReady: () => hostSlot?.isReady() ?? false,
    load: (text, cursor) => hostSlot?.load(text, cursor),
    // 不变量：getText/getCursor 仅在状态机 isReady 守卫通过后调用（单线程同步
    // 窗口内 hostSlot 不会变化），断言收窄非空
    getText: () => hostSlot!.getText(),
    getCursor: () => hostSlot!.getCursor(),
    focus: () => hostSlot?.focus(),
  };
  const controller = createSourceMode(
    {
      getEditor: () => editorManager.getEditor(),
      getMarkdown: () => editorManager.getMarkdown(),
      setContent: (markdown) => editorManager.setContent(markdown),
      // 选区 head：反向选区时恢复点为光标点（M4）；无光标信息回落文档头
      getPmCursor: () => editorManager.getView()?.state.selection.head ?? 0,
      pmPosToLineCol,
      lineColToPmPos,
      revealRange,
    },
    forwardingHost,
  );
  /** 状态机内部态 → 响应式 active 镜像（每次命令后同步） */
  const syncActive = (): void => {
    active.value = controller.getState() === "source";
  };
  /**
   * 命令统一包装：翻转 active 镜像后按目标侧移交焦点（I1）——焦点必须在
   * v-show 翻转渲染之后（nextTick），同步窗口内目标容器 display:none 时
   * focus 是 no-op，键盘输入会丢失
   */
  const runCommand = (command: () => boolean): boolean => {
    const result = command();
    syncActive();
    if (result) {
      const toSource = controller.getState() === "source";
      void nextTick(() => {
        if (toSource) forwardingHost.focus();
        else editorManager.getView()?.focus();
      });
    }
    return result;
  };
  singleton = {
    getState: controller.getState,
    enter: () => runCommand(controller.enter),
    exit: () => runCommand(controller.exit),
    toggle: () => runCommand(controller.toggle),
    // 关窗回写不改状态不动焦点，直通即可（runCommand 的镜像同步/焦点移交均不需要）
    flushPendingWrite: controller.flushPendingWrite,
    syncToActiveTab: controller.syncToActiveTab,
    setHost: (host) => {
      hostSlot = host;
    },
    active,
    discardNotice,
  };
  // 标签切换联动（应用生命周期单例，随首调组件作用域自动收口；04 激活链路
  // 同源 watch 先行——本 watcher 执行时门面已 adopt 新标签，取到新标签内容）
  const tabs = useTabsController();
  watch(
    () => tabs.store.activeTabId,
    () => singleton?.syncToActiveTab(),
  );
  return singleton;
}

/** 测试专用：重置单例（模块级状态，用例间必须隔离） */
export function resetSourceModeForTest(): void {
  singleton = undefined;
  onDiscardEdits = undefined;
}
