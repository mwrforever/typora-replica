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
// MVP 取舍（随 PR 披露）：
// - 内容同步只在切出时做（不做逐键双向实时同步）；
// - 源码层为当前活跃标签的单一视图层（不为每标签建 CM 实例）；标签切换时
//   刷新为活跃标签内容，切换瞬间源码层未回写的编辑随刷新丢弃（04 无按标签
//   写回接口，留后续工作包）。
import { ref, watch } from "vue";
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
  /** 当前 PM 光标偏移（文档首无光标信息时回落 0） */
  getPmCursor: () => number;
  /** PM 偏移 → 行列（正文口径，Front Matter 偏移由状态机折算） */
  pmPosToLineCol: (editor: Editor, pmPos: number) => LineCol;
  /** 行列 → PM 偏移（切出光标恢复；回写后以新文档现算） */
  lineColToPmPos: (editor: Editor, pos: LineCol) => number;
  /** 选区定位 + 滚动可视区（切出光标恢复载体；高亮时长由状态机给极短值） */
  revealRange: (editor: Editor, from: number, to: number, durationMs?: number) => void;
  /** 焦点归还编辑器（切出后键盘流回 WYSIWYG） */
  focusEditor: () => void;
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
  /** 聚焦源码层（切入后键盘焦点移交） */
  focus(): void;
}

/** 切出光标恢复的 revealRange 高亮时长：1ms 近乎无感（复用接口签名的最小副作用取值） */
const REVEAL_BRIEF_MS = 1;

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
  /** 切入源码模式；编辑器/宿主未就绪返回 false 状态不变，已在源码态幂等 no-op */
  enter(): boolean;
  /** 切出；非源码态 no-op 返回 false；编辑器丢失降级复位（不回写） */
  exit(): boolean;
  /** 双向切换（Ctrl+/ 与菜单「源码模式」共用入口） */
  toggle(): boolean;
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
  /** 切入时装载的全文：切出时变更判定基准（无变化不回写，防空 undo 步） */
  let pendingText = "";

  const enter = (): boolean => {
    if (state === "source") return true;
    const editor = deps.getEditor();
    // 双前置守卫：编辑器未就绪时 getMarkdown 为空串，切入会污染源码层
    if (editor === undefined || !host.isReady()) return false;
    const text = deps.getMarkdown();
    const cursor = deps.pmPosToLineCol(editor, deps.getPmCursor());
    const offset = frontMatterLineOffset(text);
    pendingText = text;
    // 正文行列 + FM 行偏移 = 源码全文行列（源码含 FM 头，正文行号整体下移）
    host.load(text, { line: cursor.line + offset, col: cursor.col });
    host.focus();
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
    const text = host.getText();
    // AC-M-8：仅内容变更时回写（单事务全文替换，undo 一步可回退）
    if (text !== pendingText) deps.setContent(text);
    // 光标恢复：源码行 − FM 偏移 = 正文行；setContent 后映射以新文档现算
    const cursor = host.getCursor();
    const pos = deps.lineColToPmPos(editor, {
      line: Math.max(cursor.line - frontMatterLineOffset(text), 0),
      col: cursor.col,
    });
    deps.revealRange(editor, pos, pos, REVEAL_BRIEF_MS);
    deps.focusEditor();
    state = "wysiwyg";
    return true;
  };

  return {
    getState: () => state,
    enter,
    exit,
    toggle: () => (state === "source" ? exit() : enter()),
    syncToActiveTab: () => {
      if (state !== "source") return;
      const editor = deps.getEditor();
      // 宿主未就绪（层已卸载等）：无可刷新目标，静默跳过
      if (editor === undefined || !host.isReady()) return;
      // 未回写编辑随刷新丢弃（04 无按标签写回接口——MVP 披露项，告警留痕）
      if (host.getText() !== pendingText) {
        console.warn("[MarkWell] 源码模式存在未回写编辑，随标签切换丢弃");
      }
      const text = deps.getMarkdown();
      const cursor = deps.pmPosToLineCol(editor, deps.getPmCursor());
      pendingText = text;
      host.load(text, { line: cursor.line + frontMatterLineOffset(text), col: cursor.col });
    },
  };
}

/** 单例装配句柄（AppShell 绑定显隐、App.vue 绑定命令、SourceModeLayer 上缴宿主） */
export interface UseSourceModeReturn extends SourceModeController {
  /** 源码层显隐（视图层 v-show 绑定；true = 源码模式） */
  readonly active: Ref<boolean>;
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
      // 插入点语义：无光标信息（视图未就绪）回落文档头
      getPmCursor: () => editorManager.getView()?.state.selection.from ?? 0,
      pmPosToLineCol,
      lineColToPmPos,
      revealRange,
      focusEditor: () => editorManager.getView()?.focus(),
    },
    forwardingHost,
  );
  /** 状态机内部态 → 响应式 active 镜像（每次命令后同步） */
  const syncActive = (): void => {
    active.value = controller.getState() === "source";
  };
  singleton = {
    getState: controller.getState,
    enter: () => {
      const result = controller.enter();
      syncActive();
      return result;
    },
    exit: () => {
      const result = controller.exit();
      syncActive();
      return result;
    },
    toggle: () => {
      const result = controller.toggle();
      syncActive();
      return result;
    },
    syncToActiveTab: controller.syncToActiveTab,
    setHost: (host) => {
      hostSlot = host;
    },
    active,
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
}
