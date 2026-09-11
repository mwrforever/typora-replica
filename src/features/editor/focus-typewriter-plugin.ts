// Focus / Typewriter 模式插件（12 窗口外壳 W5；AC-M-10/11/12 编辑器侧载体）
//
// 职责：单一 PM 插件承载两个视图模式的编辑器侧机制——
// - Focus（F8 专注模式）：按 Typora 官方 DOM 契约类名同名注入（on-focus-mode /
//   md-focus / md-focus-container / md-end-block），淡化强度由主题 CSS 变量
//   --blur-text-color 消费（复用 Typora 主题 CSS，见 styles/crepe-overrides.css）；
//   当前块/容器链由选区即时推导，装饰集经 PM Decoration 声明（attributes class），
//   禁止 classList 逐块打点（PM 重用 DOM 节点会残留脏类名）。
// - Typewriter（F9 打字机模式）：事务后取光标屏幕坐标（coordsAtPos），把滚动容器
//   scrollTop 调整到光标垂直居中；输入（doc 变更）恒滚动，纯光标移动（点击/方向键）
//   仅在点击居中偏好开启时滚动（偏好经 10 设置面板持久化，AC-M-12）。
//
// 装配：随编辑器工厂常驻 use（zoom-render / search-plugin 同款先例）——插件默认全关
// 零渲染开销；模式开关由 12 域控制器（features/window-shell/view-modes）经
// setFocusTypewriterConfig 派发 meta 驱动，多标签下每个实例各自持配置，
// 标签切换由控制器同步（订阅 selectionUpdated 微任务对账）。
//
// 边界说明（on-focus-mode 根类名的 classList 例外）：
//   PM Decoration 无法作用于编辑器根容器（doc 节点没有独立渲染 DOM，node decoration
//   不生效），而 on-focus-mode 是 Typora 主题 CSS 的作用域锚点、必须挂在块级元素的
//   祖先上。该类是视图级视觉开关（非文档内容修改），故插件视图以 classList 直接
//   同步到 view.dom——与 Decoration 无法表达该目标的业务理由绑定，其余块级类名
//   一律走 Decoration。
import { editorViewCtx } from "@milkdown/kit/core";
import type { Editor } from "@milkdown/kit/core";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { Selection } from "@milkdown/kit/prose/state";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

/** 两模式合并配置（插件状态内持有一份；12 控制器以补丁派发更新） */
export interface FocusTypewriterConfig {
  /** Focus 模式开关（F8；true 时注入淡化装饰与根类名） */
  focusEnabled: boolean;
  /** Typewriter 模式开关（F9；true 时事务后保持光标垂直居中） */
  typewriterEnabled: boolean;
  /** 点击居中偏好（纯光标移动是否也居中；官方默认开，AC-M-12） */
  typewriterClickCenter: boolean;
}

/** 插件默认配置：两模式全关（未开启期间零渲染/滚动开销）+ 官方默认点击居中开 */
export const DEFAULT_FOCUS_TYPEWRITER_CONFIG: FocusTypewriterConfig = {
  focusEnabled: false,
  typewriterEnabled: false,
  typewriterClickCenter: true,
};

/** Typora 官方契约类名（与 styles/crepe-overrides.css / 主题 CSS 三方同名对齐） */
const ON_FOCUS_MODE_CLASS = "on-focus-mode";
const FOCUS_BLOCK_CLASS = "md-focus";
const FOCUS_CONTAINER_CLASS = "md-focus-container";
const END_BLOCK_CLASS = "md-end-block";

/** 居中死区（px）：偏移小于该值不写滚动，防亚像素抖动逐键滚动 */
const SCROLL_DEAD_ZONE_PX = 1;

/**
 * 居中偏移纯函数：光标垂直中心与视口中线的差值
 * @param cursorTop 光标顶边屏幕坐标（coordsAtPos.top）
 * @param cursorBottom 光标底边屏幕坐标（coordsAtPos.bottom）
 * @param viewportTop 滚动容器可视区顶部屏幕坐标（文档滚动面恒 0）
 * @param viewportHeight 滚动容器可视区高度
 * @returns 正值 = 光标在中线下方（应下滚），负值 = 上方（应上滚），单位 px
 */
export function cursorCenterDelta(
  cursorTop: number,
  cursorBottom: number,
  viewportTop: number,
  viewportHeight: number,
): number {
  return (cursorTop + cursorBottom) / 2 - (viewportTop + viewportHeight / 2);
}

/** 滚动触发判定入参（事务前后状态摘要，纯数据可测） */
export interface TypewriterScrollTrigger {
  /** 事务前 Typewriter 开关 */
  wasEnabled: boolean;
  /** 事务后 Typewriter 开关 */
  nowEnabled: boolean;
  /** 事务是否变更了文档（输入/删除/粘贴） */
  docChanged: boolean;
  /** 事务是否变更了选区（点击/方向键/输入落点） */
  selectionChanged: boolean;
  /** 点击居中偏好（仅约束纯光标移动路径） */
  clickCenter: boolean;
}

/**
 * 滚动触发判定纯函数（AC-M-11/12 的决策核心）：
 * 关闭恒不滚；刚开启立即居中一次（官方启用即归中）；输入恒滚；
 * 纯光标移动（点击/方向键）仅偏好开启时滚。
 */
export function shouldCenterCursor(trigger: TypewriterScrollTrigger): boolean {
  if (!trigger.nowEnabled) return false;
  if (!trigger.wasEnabled) return true;
  if (trigger.docChanged) return true;
  return trigger.selectionChanged && trigger.clickCenter;
}

/** 滚动面抽象：统一「块级滚动容器」与「文档滚动面」的几何读取与滚动写入 */
interface ScrollSurface {
  /** 可视区顶部屏幕坐标（文档滚动面恒 0） */
  viewportTop(): number;
  /** 可视区高度（px） */
  viewportHeight(): number;
  /** 以增量滚动（正下负上；越界由浏览器滚动钳制天然收敛） */
  scrollBy(delta: number): void;
}

/** 块级滚动容器面：overflow-y auto/scroll 的祖先元素 */
function elementSurface(el: HTMLElement): ScrollSurface {
  return {
    viewportTop: () => el.getBoundingClientRect().top,
    viewportHeight: () => el.clientHeight,
    scrollBy: (delta) => {
      el.scrollTop += delta;
    },
  };
}

/** 文档滚动面：编辑器无 overflow 祖先时整个文档滚动（本应用当前形态，body 滚动） */
function documentSurface(): ScrollSurface {
  return {
    viewportTop: () => 0,
    viewportHeight: () => window.innerHeight,
    // documentElement.scrollTop 即文档滚动偏移（scrollTop 设置越界由浏览器钳制）
    scrollBy: (delta) => {
      document.documentElement.scrollTop += delta;
    },
  };
}

/**
 * 就近解析滚动面：自编辑器 DOM 向上找第一个 overflow-y auto/scroll 祖先，
 * 找不到回落文档滚动面（本应用 .markwell-editor 链路无 overflow 容器，恒走文档面）
 */
export function resolveScrollSurface(dom: HTMLElement): ScrollSurface {
  for (let node: HTMLElement | null = dom.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return elementSurface(node);
  }
  return documentSurface();
}

/** 光标垂直居中：取光标屏幕坐标 → 纯函数算偏移 → 过死区后写滚动面 */
function centerCursorInView(view: EditorView): void {
  const coords = view.coordsAtPos(view.state.selection.head);
  const surface = resolveScrollSurface(view.dom);
  const delta = cursorCenterDelta(
    coords.top,
    coords.bottom,
    surface.viewportTop(),
    surface.viewportHeight(),
  );
  if (Math.abs(delta) < SCROLL_DEAD_ZONE_PX) return;
  surface.scrollBy(delta);
}

/** 叶子块判定：块级节点且无块级子节点（段落/标题/代码围栏/图片块等可淡化终端块） */
function isLeafBlock(node: ProseMirrorNode): boolean {
  if (!node.isBlock) return false;
  let hasBlockChild = false;
  node.forEach((child) => {
    if (child.isBlock) hasBlockChild = true;
  });
  return !hasBlockChild;
}

/**
 * 按选区推导 Focus 装饰集（AC-M-10 类名契约核心）：
 * - 选区祖先链自内向外：最内层叶子块挂 md-focus，外层容器块挂 md-focus-container；
 * - 全部叶子块挂 md-end-block（Typora 结构类，主题 CSS 以 .md-end-block:not(.md-focus)
 *   圈定淡化面），当前块因携带 md-focus 被同一套选择器自然豁免。
 * @param doc 文档（装饰范围来源）
 * @param selection 当前选区（光标所在块推导基准）
 */
function focusDecorations(doc: ProseMirrorNode, selection: Selection): DecorationSet {
  const decos: Decoration[] = [];
  const $from = selection.$from;
  // 全文档叶子块挂 md-end-block：主题契约要求淡化选择器命中一切非当前终端块
  //（含引用/列表内嵌段落）。O(n) 遍历与 markdownUpdated 序列化同量级，
  // 仅在 Focus 开启期间发生（关闭态装饰集恒空，零开销）
  doc.descendants((node, pos) => {
    if (isLeafBlock(node)) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: END_BLOCK_CLASS }));
    }
    return true;
  });
  // 选区祖先链（depth 1 = 文档直接子块）：最内层 md-focus，外层容器 md-focus-container；
  // depth 0 选区（块级 NodeSelection 等边缘）无块级焦点，仅保留 md-end-block 结构类
  for (let depth = $from.depth; depth >= 1; depth--) {
    const cls = depth === $from.depth ? FOCUS_BLOCK_CLASS : FOCUS_CONTAINER_CLASS;
    decos.push(Decoration.node($from.before(depth), $from.after(depth), { class: cls }));
  }
  return DecorationSet.create(doc, decos);
}

/** 插件状态：配置 + 派生装饰集（装饰集仅 Focus 开启时非空） */
interface FocusTypewriterState {
  config: FocusTypewriterConfig;
  deco: DecorationSet;
}

/** 插件键（12 控制器经 meta 补丁驱动；读取走 getFocusTypewriterConfig 门面） */
export const focusTypewriterKey = new PluginKey<FocusTypewriterState>("markwell-focus-typewriter");

/** 构造插件状态（配置补丁/开启/文档或选区变化时全量重算装饰集） */
function createState(
  config: FocusTypewriterConfig,
  doc: ProseMirrorNode,
  selection: Selection,
): FocusTypewriterState {
  return {
    config,
    deco: config.focusEnabled ? focusDecorations(doc, selection) : DecorationSet.empty,
  };
}

/**
 * 创建 Focus/Typewriter 插件（$prose 包装前核；测试与工厂经 focusTypewriterPlugin 消费）
 */
function createFocusTypewriterPlugin(): Plugin<FocusTypewriterState> {
  return new Plugin<FocusTypewriterState>({
    key: focusTypewriterKey,
    state: {
      init: (_, state) => createState(DEFAULT_FOCUS_TYPEWRITER_CONFIG, state.doc, state.selection),
      apply(tr, prev) {
        // 配置补丁（12 控制器派发；内部可信来源，形状异常静默忽略不崩编辑器）
        const patch = tr.getMeta(focusTypewriterKey) as Partial<FocusTypewriterConfig> | undefined;
        const config = patch ? { ...prev.config, ...patch } : prev.config;
        if (!config.focusEnabled) return { config, deco: DecorationSet.empty };
        // 开关/文档/选区变化 → 全量重算（当前块跟随选区）；纯 meta 事务仅重映射已有点位
        if (patch !== undefined || tr.docChanged || tr.selectionSet) {
          return createState(config, tr.doc, tr.selection);
        }
        return { config, deco: prev.deco.map(tr.mapping, tr.doc) };
      },
    },
    props: {
      // 本插件的 props 只会被装配了本插件的视图读取：键状态恒存在，
      // 断言收窄非空（同下方 view 构造先例）
      decorations: (state) => focusTypewriterKey.getState(state)!.deco,
    },
    view(editorView) {
      // 根类名同步（Decoration 无法作用于根容器，见文件头边界说明）
      const syncRootClass = (view: EditorView, enabled: boolean): void => {
        view.dom.classList.toggle(ON_FOCUS_MODE_CLASS, enabled);
      };
      // 实例创建即对齐根类：Focus 开启期间新建/切换标签，首帧即生效。
      // 插件键状态在自身 view 构造时点必已存在（PM 保证 init 先于 view 构造），
      // 断言收窄非空同 source-mode 转发宿主先例
      syncRootClass(editorView, focusTypewriterKey.getState(editorView.state)!.config.focusEnabled);
      return {
        update(view, prevState) {
          const now = focusTypewriterKey.getState(view.state)!;
          const before = focusTypewriterKey.getState(prevState)!;
          syncRootClass(view, now.config.focusEnabled);
          if (
            shouldCenterCursor({
              wasEnabled: before.config.typewriterEnabled,
              nowEnabled: now.config.typewriterEnabled,
              docChanged: prevState.doc !== view.state.doc,
              selectionChanged: !view.state.selection.eq(prevState.selection),
              clickCenter: now.config.typewriterClickCenter,
            })
          ) {
            centerCursorInView(view);
          }
        },
        // 无自有 DOM：装饰随视图拆除，无需清理钩子
      };
    },
  });
}

/** Focus/Typewriter 插件（编辑器工厂 use；默认全关零开销） */
export const focusTypewriterPlugin = $prose(createFocusTypewriterPlugin);

/**
 * 读取当前实例的两模式配置（12 控制器标签切换对账用）
 * @param editor 目标编辑器实例
 * @returns 当前配置；实例未就绪（create 未完成，ctx 不可用）返回 undefined
 */
export function getFocusTypewriterConfig(editor: Editor): FocusTypewriterConfig | undefined {
  try {
    return editor.action(
      (ctx) => focusTypewriterKey.getState(ctx.get(editorViewCtx).state)?.config,
    );
  } catch {
    // 与 EditorPage adopt 竞态先例同口径：action 抛错即实例未就绪，静默降级
    return undefined;
  }
}

/**
 * 以补丁派发两模式配置（开启/关闭/偏好切换统一入口；触发装饰重算与滚动语义）
 * @param editor 目标编辑器实例
 * @param patch 配置增量（未提及键保持现值）
 */
export function setFocusTypewriterConfig(
  editor: Editor,
  patch: Partial<FocusTypewriterConfig>,
): void {
  try {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta(focusTypewriterKey, patch));
    });
  } catch {
    // 实例未就绪/销毁竞态：静默降级（12 控制器经微任务对账最终一致）
  }
}
