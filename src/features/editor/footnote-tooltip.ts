// 脚注悬停预览：引用处悬停弹出定义内容浮层（E9 AC-E9-2）
//
// 机制：plugin-tooltip 的 tooltipFactory 注册脚注专用浮层插件（$ctx 规格 + $prose 插件），
// 与内置 link-tooltip 同构——config 阶段经 ctx.set 注入 PluginSpec（view + handleDOMEvents），
// 指针事件命中 footnoteReference（sup[data-type=footnote_reference]）时，FootnoteTooltipView
// 用 TooltipProvider 浮层展示文档中同 label 的 footnoteDefinition 内容，移出即隐藏。
// 在 create-editor.ts 工厂（与测试助手同源注入）中 use 该插件并调用 configureFootnoteTooltip。
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { tooltipFactory, TooltipProvider } from "@milkdown/kit/plugin/tooltip";
import type { Node as PMNode } from "@milkdown/kit/prose/model";
import { type EditorState, type PluginView } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

// 内置 GFM 脚注节点名（preset-gfm 稳定契约，即其 toDOM 渲染的 data-type 属性值）。
// 注意：$nodeSchema.id 属性是模块加载期快照（插件 runner 在 create() 阶段才赋值 id，
// 快照恒为 undefined），不可使用，故以节点名常量 + 构建后 schema 比对。
const FOOTNOTE_REFERENCE_NODE_NAME = "footnote_reference";
const FOOTNOTE_DEFINITION_NODE_NAME = "footnote_definition";

/** 脚注引用 DOM 选择器（内置 schema toDOM 形态：sup[data-type=footnote_reference]） */
const FOOTNOTE_REFERENCE_SELECTOR = `sup[data-type="${FOOTNOTE_REFERENCE_NODE_NAME}"]`;

/** 脚注悬停预览浮层工厂（tooltipFactory 形态：[规格 ctx, prose 插件]） */
export const footnoteTooltip = tooltipFactory("FOOTNOTE");

/** 插件平铺形态（editor.use 注册用：$ctx 规格 + $prose 插件） */
export const footnoteTooltipPlugin: MilkdownPlugin[] = [footnoteTooltip[0], footnoteTooltip[1]];

/** 悬停处理器依赖的浮层操作契约（FootnoteTooltipView 实现；测试可用桩替换覆盖防御分支） */
export interface FootnoteTooltipHandle {
  /** 显示同 label 定义内容浮层（无定义时自行隐藏） */
  show(view: EditorView, label: string, refRect: () => DOMRect): void;
  /** 隐藏浮层 */
  hide(): void;
}

/**
 * 从事件目标向上查找脚注引用 DOM
 * @param target 指针事件目标（可为文本节点/null）
 * @returns 命中的 sup 引用元素；非元素目标或未命中返回 null
 */
export function findFootnoteReferenceElement(target: EventTarget | null): Element | null {
  // 文本节点等非元素目标无法 closest，直接视为未命中
  if (!(target instanceof Element)) return null;
  return target.closest(FOOTNOTE_REFERENCE_SELECTOR);
}

/**
 * 创建脚注悬停事件处理器（handleDOMEvents 形态，与 link-tooltip 的指针驱动同模式）
 * @param getView 浮层视图访问器（插件视图创建前返回 null，防御性忽略事件）
 */
export function createFootnoteHoverHandlers(getView: () => FootnoteTooltipHandle | null): {
  mousemove: (view: EditorView, event: Event) => void;
  mouseover: (view: EditorView, event: Event) => void;
  mouseleave: () => void;
} {
  /** 当前悬停引用 label（P1-2 高频路径短路：同 label 连续移动不重复扫描/重建浮层） */
  let hoveredLabel: string | null = null;

  /** 指针在引用上进入/移动：命中即显示定义内容，否则隐藏 */
  const onPointerMove = (view: EditorView, event: Event): void => {
    const tooltipView = getView();
    // 插件视图尚未创建（编辑器 create 早期）：不处理指针事件
    if (!tooltipView) return;
    const sup = findFootnoteReferenceElement(event.target);
    // 指针不在脚注引用上：隐藏浮层
    if (!sup) {
      hoveredLabel = null;
      tooltipView.hide();
      return;
    }
    const label = sup.getAttribute("data-label");
    // 引用元素缺 label（内置 schema 恒渲染，防御非法 DOM）：隐藏浮层
    if (!label) {
      hoveredLabel = null;
      tooltipView.hide();
      return;
    }
    // P1-2：悬停同一引用期间 mousemove 以 60-120Hz 到达，每次都会触发
    // findFootnoteDefinition 全文档扫描 + textContent 重写 + provider.show
    // （内部重建 autoUpdate）——万行级文档（spec C5）会卡顿。同 label 移动
    // 直接短路（定义内容不变，浮层位置由 update/滚动路径维护）
    if (label === hoveredLabel) return;
    hoveredLabel = label;
    // 以引用元素真实矩形定位浮层（jsdom 无布局时为零矩形，仅影响视觉落位）
    tooltipView.show(view, label, () => sup.getBoundingClientRect());
  };

  /** 指针移出编辑器：隐藏浮层 */
  const onPointerLeave = (): void => {
    hoveredLabel = null;
    const tooltipView = getView();
    if (!tooltipView) return;
    tooltipView.hide();
  };

  return { mousemove: onPointerMove, mouseover: onPointerMove, mouseleave: onPointerLeave };
}

/** 从文档查找指定 label 的脚注定义节点（无定义返回 null） */
function findFootnoteDefinition(state: EditorState, label: string): PMNode | null {
  // 经构建后的 schema 解析定义节点类型（名称不存在时 nodes 取 undefined，比对恒 false 优雅降级）
  const defType = state.schema.nodes[FOOTNOTE_DEFINITION_NODE_NAME];
  let found: PMNode | null = null;
  // 全文档扫描同 label 定义（定义块通常位于文末，文档量级小，线性扫描足够）
  state.doc.descendants((node) => {
    if (node.type === defType && node.attrs.label === label) {
      found = node;
      return false; // 命中即停止遍历
    }
    return true;
  });
  return found;
}

/**
 * 脚注悬停预览浮层视图（ProseMirror PluginView）
 * 创建时挂载浮层 DOM（TooltipProvider 管理显隐与定位），销毁时卸载；
 * 显隐完全由指针事件驱动，provider 自身不自动弹出（shouldShow 恒 false）。
 */
class FootnoteTooltipView implements PluginView {
  private readonly content: HTMLElement;
  private readonly provider: TooltipProvider;

  constructor(view: EditorView) {
    this.content = document.createElement("div");
    this.content.className = "milkdown-footnote-tooltip";
    // 浮层基础样式：绝对定位供 floating-ui 落位，初始隐藏；
    // 表面/阴影沿用 Crepe 主题变量，保证与编辑器主题一致
    Object.assign(this.content.style, {
      position: "absolute",
      zIndex: "10",
      display: "none",
      maxWidth: "360px",
      padding: "4px 10px",
      borderRadius: "8px",
      background: "var(--crepe-color-surface)",
      boxShadow: "var(--crepe-shadow-1)",
      fontSize: "calc(var(--crepe-base-font-size, 16px) * 0.875)",
    });
    this.provider = new TooltipProvider({
      content: this.content,
      debounce: 0,
      shouldShow: () => false, // 显隐由指针事件驱动，provider 不自动弹层
    });
    // 首次 update 将浮层挂载到编辑器容器（root ?? view.dom.parentElement）并保持隐藏
    this.provider.update(view);
    // provider 仅维护 dataset.show 标记，真实显隐经显隐钩子切换（link-preview 同模式）
    this.provider.onShow = () => {
      this.content.style.display = "block";
    };
    this.provider.onHide = () => {
      this.content.style.display = "none";
    };
  }

  /** 悬停命中引用：填充同 label 定义内容并显示浮层（无定义则隐藏） */
  show(view: EditorView, label: string, refRect: () => DOMRect): void {
    const def = findFootnoteDefinition(view.state, label);
    if (!def) {
      this.hide(); // 未解析引用（无对应定义）：不显示预览
      return;
    }
    this.content.textContent = def.textContent;
    this.provider.show({ getBoundingClientRect: refRect }, view);
  }

  /** 隐藏浮层 */
  hide(): void {
    this.provider.hide();
  }

  /** 文档更新：定义内容可能已变化，隐藏浮层待下次悬停重取 */
  update(): void {
    this.hide();
  }

  /** 插件视图销毁：卸载浮层（编辑器销毁时由 ProseMirror 调用） */
  destroy(): void {
    this.provider.destroy();
    this.content.remove();
  }
}

/**
 * 将浮层规格注入 ctx（编辑器 config 阶段调用一次，link-tooltip configure 同模式）
 * @param ctx milkdown 配置上下文（create() 前调用）
 */
export function configureFootnoteTooltip(ctx: Ctx): void {
  let tooltipView: FootnoteTooltipView | null = null;
  const handlers = createFootnoteHoverHandlers(() => tooltipView);
  ctx.set(footnoteTooltip.key, {
    view: (view) => {
      const instance = new FootnoteTooltipView(view);
      tooltipView = instance;
      return instance;
    },
    props: {
      handleDOMEvents: handlers,
    },
  });
}
