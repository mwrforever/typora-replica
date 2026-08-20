// TOC 目录插件（E12）
//
// 自定义 `toc` 原子块节点 + DOM NodeView：
//   - 输入规则 `[toc]` 整行（] 落字时）替换为 toc 节点
//   - 解析回读：remark 插件把独占整行的 `[toc]` 文本段落转为 mdast toc 块节点，
//     parseMarkdown 按 mdast 类型匹配还原（不能直接匹配 text 节点：内置 text schema
//     注册在前，解析器 #matchTarget 的 find() 先命中内置规则，text 匹配永远轮不到）
//   - 序列化落盘：toMarkdown 输出 mdast toc 节点 + 专属 stringify handler 直出
//     `[toc]` 字面文本（若输出普通 text 节点会被 safe() 转义为 `\[toc]`，回读失配）
//   - 文档更新后由 create-editor.ts 经 listener.updated 统一通知防抖重算（300ms）
//   - 条目点击定位对应标题（选区 + 滚动 + 临时高亮，高亮守卫与 reveal-range 同款）
//
// 接线（create-editor.ts 与测试助手 makeTestEditor 同源调用）：
//   const tocViews = createTocViewRegistry();  // 每编辑器实例独立注册表（04 多标签隔离）
//   crepe.editor.use(tocSchema).use(tocInputRule)
//   crepe.editor.config((ctx) => { configureToc(ctx); setupTocNodeView(ctx, tocViews); })
//   setupTocRebuildListener(crepe, tocViews)
import type { Crepe } from "@milkdown/crepe";
import { nodeViewCtx, remarkPluginsCtx, remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView, NodeViewConstructor } from "@milkdown/kit/prose/view";
import { $inputRule, $nodeSchema } from "@milkdown/kit/utils";

/** toc 节点名 */
export const tocNodeName = "toc";

/** 标题节点名（preset-commonmark 稳定契约；headingSchema.type(ctx) 需要 ctx，NodeView 无 ctx 不可用） */
const HEADING_NODE_NAME = "heading";

/** mdast 节点最小结构（remark 树遍历用，仅取 type/children/value 字段） */
interface MdastNode {
  type: string;
  children?: MdastNode[];
  value?: string;
}

/**
 * remark 树遍历：把内容恰为单个文本节点 `[toc]` 的段落替换为 toc 块节点
 *
 * 仅在解析阶段生效（unified 的 stringify 不执行 run 阶段变换，序列化侧不受影响）。
 * 递归处理嵌套容器（引用块/列表项内的 `[toc]` 段落同样转换），叶子节点直接跳过。
 * @param tree mdast 根节点（原地修改 children）
 */
function remarkTocNode() {
  return (tree: MdastNode): void => {
    /** 递归替换命中段落 */
    const walk = (node: MdastNode): void => {
      if (!node.children) return;
      node.children = node.children.map((child) => {
        // 命中条件：段落且唯一子节点为文本 `[toc]`（行内其余字符均不命中）
        if (
          child.type === "paragraph" &&
          child.children?.length === 1 &&
          child.children[0].type === "text" &&
          child.children[0].value === "[toc]"
        ) {
          return { type: tocNodeName };
        }
        walk(child);
        return child;
      });
    };
    walk(tree);
  };
}

/** remark-stringify 的 toc mdast 节点 handler：直出 `[toc]` 字面文本（不经 safe 转义） */
const tocStringifyHandler = (): string => "[toc]";

/** toc 节点 schema：原子块节点（无内容，渲染由 NodeView 接管） */
const tocSchema = $nodeSchema(tocNodeName, () => ({
  group: "block",
  atom: true,
  parseDOM: [{ tag: `div[data-node-type="${tocNodeName}"]` }],
  toDOM: () => ["div", { "data-node-type": tocNodeName, class: "markwell-toc" }],
  parseMarkdown: {
    match: (node) => node.type === tocNodeName,
    runner: (state, _node, type) => {
      state.addNode(type);
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === tocNodeName,
    runner: (state) => {
      // mdast 输出 toc 节点（不输出 text：safe() 会把 `[toc]` 转义为 `\[toc]`，回读失配）
      state.addNode(tocNodeName, undefined, "[toc]");
    },
  },
}));

/**
 * `[toc]` 输入规则：光标所在段落文本恰为 `[toc]` 且独占整行时转为目录节点
 *
 * 正则锚定行首到光标（`]` 落字时命中）；守卫「光标位于段落文本末尾」保证触发文本
 * 独占整行（行中/行尾还有别的文字不转换，与 E8 建表规则的整行语义一致）。
 * 转换动作：整体替换触发段落节点（范围含开闭标签，不留空段落），
 * 光标由 ProseMirror 选区映射自动落到 toc 节点之后。
 */
const tocInputRule = $inputRule(() => {
  return new InputRule(/^\[toc\]$/, (state, _match, start, end) => {
    // 光标必须位于段落内容末尾（行尾无未消费文本才转换）
    const $end = state.doc.resolve(end);
    if ($end.parentOffset !== $end.parent.content.size) return null;
    // 整段替换为 toc 原子节点（范围含段落开闭标签，与 E8 建表规则同一写法）
    return state.tr.replaceRangeWith(start - 1, end + 1, state.schema.nodes[tocNodeName].create());
  });
});

/**
 * toc 视图注册表（04 多标签：按编辑器实例隔离——一个实例的更新只重建自己的目录）
 *
 * 每个编辑器实例持有一个独立注册表，实例销毁时随编辑器的 NodeView 销毁自动退订，
 * 避免多标签场景下任一实例的更新重建全部实例的目录视图。
 */
export interface TocViewRegistry {
  /** 登记一个存活的 toc 节点视图（NodeView 构造时调用） */
  add(view: TocNodeView): void;
  /** 退订（NodeView destroy 时调用） */
  remove(view: TocNodeView): void;
  /** 通知本注册表内全部视图重算目录（updated 事件防抖后调用） */
  notify(): void;
}

/** 创建独立的 toc 视图注册表（每编辑器实例一个） */
export function createTocViewRegistry(): TocViewRegistry {
  const views = new Set<TocNodeView>();
  return {
    add: (view) => {
      views.add(view);
    },
    remove: (view) => {
      views.delete(view);
    },
    notify: () => {
      for (const view of views) view.rebuild();
    },
  };
}

/**
 * toc 节点视图：渲染目录列表 DOM
 *
 * 目录结构来自文档 heading 节点（含层级缩进），点击条目把选区定位到标题文本并临时高亮。
 * 非线程安全（仅编辑器主线程访问）；rebuild 全量重建，防抖由调用方（updated 事件）负责。
 * 视图从构造到销毁登记在所属实例的 registry 中（04 多标签：各实例独立，互不干扰）。
 */
class TocNodeView {
  /** 容器 DOM */
  dom: HTMLElement;

  constructor(
    private view: EditorView,
    private registry: TocViewRegistry,
  ) {
    this.dom = document.createElement("div");
    this.dom.className = "markwell-toc";
    this.dom.contentEditable = "false";
    // 登记进所属实例的注册表（后续 updated 防抖通知只重建本实例目录）
    this.registry.add(this);
    this.rebuild();
  }

  /** 重建目录 DOM：遍历文档收集 heading 节点（含层级/文本/位置） */
  rebuild(): void {
    this.dom.textContent = "";
    const headings: Array<{ level: number; text: string; pos: number }> = [];
    this.view.state.doc.descendants((node, pos) => {
      if (node.type.name === HEADING_NODE_NAME) {
        headings.push({ level: node.attrs.level as number, text: node.textContent, pos });
      }
    });
    if (headings.length === 0) {
      // AC-E12-4：无标题时显示提示
      const empty = document.createElement("span");
      empty.className = "markwell-toc__empty";
      empty.textContent = "（无标题）";
      this.dom.appendChild(empty);
      return;
    }
    for (const h of headings) {
      const item = document.createElement("div");
      item.className = "markwell-toc__item";
      // 层级缩进：每级 16px
      item.style.paddingLeft = `${(h.level - 1) * 16}px`;
      item.textContent = h.text;
      // AC-E12-3：点击跳转到对应标题（定位到标题文本起点并临时高亮）
      item.addEventListener("click", () => {
        const from = h.pos + 1;
        this.view.dispatch(
          this.view.state.tr
            .setSelection(TextSelection.create(this.view.state.doc, from, from + h.text.length))
            .scrollIntoView(),
        );
        // nodeDOM 在块边界返回元素、文本节点边界可能返回 Text 节点（无 classList），
        // 仅对 Element 操作 classList；Text 节点回退到其父元素（与 reveal-range 同款守卫）
        const node = this.view.nodeDOM(from);
        const dom = (
          node?.nodeType === 1 ? node : (node?.parentElement ?? null)
        ) as HTMLElement | null;
        if (dom) {
          dom.classList.add("markwell-reveal-highlight");
          setTimeout(() => dom.classList.remove("markwell-reveal-highlight"), 1200);
        }
      });
      this.dom.appendChild(item);
    }
  }

  /** 销毁：从所属实例注册表退订 */
  destroy(): void {
    this.registry.remove(this);
  }

  /** 忽略外部 DOM 变更（原子节点，容器内容由 rebuild 全量接管） */
  ignoreMutation(): boolean {
    return true;
  }
}

/** 节点视图工厂（供 nodeViewCtx 注册：ProseMirror NodeViewConstructor 形态，闭包携带实例注册表） */
export function tocNodeViewFactory(registry: TocViewRegistry) {
  // node/getPos 由 PM 调用方传入但本视图不消费（额外参数被 JS 忽略，不参与签名）
  return (_node: ProseMirrorNode, view: EditorView) => new TocNodeView(view, registry);
}

/**
 * 节点视图注册配置（create-editor.ts config 阶段调用）
 *
 * nodeViewCtx 条目为二元组 [节点名, 工厂]（与 $view 组合子同构），
 * 消费方 Object.fromEntries 直接展开为 ProseMirror nodeViews 选项。
 * @param ctx milkdown 配置上下文（create() 前 config 回调中调用）
 * @param registry 本编辑器实例的 toc 视图注册表（04 多标签隔离）
 */
export function setupTocNodeView(ctx: Ctx, registry: TocViewRegistry): void {
  // 显式标注二元组类型：展开数组字面量会被 TS 拓宽为联合数组，与 NodeView 元组类型不兼容
  const entry: [string, NodeViewConstructor] = [tocNodeName, tocNodeViewFactory(registry)];
  ctx.update(nodeViewCtx, (prev) => [...prev, entry]);
}

/**
 * toc 解析/序列化接线（remark 转换插件 + stringify handler，create-editor.ts config 阶段调用）
 * @param ctx milkdown 配置上下文（create() 前 config 回调中调用）
 */
export function configureToc(ctx: Ctx): void {
  // 解析侧：`[toc]` 独占段落 → mdast toc 块节点（parseMarkdown 的还原前提）
  ctx.update(remarkPluginsCtx, (prev) => [...prev, { plugin: remarkTocNode, options: {} }]);
  // 序列化侧：toc mdast 节点直出 `[toc]` 字面文本（不经 safe 转义）
  ctx.update(remarkStringifyOptionsCtx, (prev) => ({
    ...prev,
    handlers: { ...prev.handlers, [tocNodeName]: tocStringifyHandler },
  }));
}

/**
 * 目录防抖重算接线（create-editor.ts 与测试助手同源调用）
 *
 * listener.updated 为 Crepe 原生事件（自身带 200ms 内部防抖），叠加本层 300ms
 * 防抖后总窗口 500ms；计时器按编辑器实例隔离，避免多实例互相清理。
 * @param crepe 目标编辑器实例（create() 前后调用均可，create 前走 config 注册路径）
 * @param registry 本编辑器实例的 toc 视图注册表（notify 只重建本实例目录）
 */
export function setupTocRebuildListener(crepe: Crepe, registry: TocViewRegistry): void {
  let tocTimer: ReturnType<typeof setTimeout> | undefined;
  crepe.on((listener) => {
    listener.updated(() => {
      clearTimeout(tocTimer);
      tocTimer = setTimeout(registry.notify, 300);
    });
  });
}

export { tocSchema, tocInputRule };
// 类型导出：TocNodeView 为模块私有类（值不可导入），仅导出类型供测试侧
// `as unknown as TocNodeView` 断言 fake 视图（04 多标签隔离用例）
export type { TocNodeView };
