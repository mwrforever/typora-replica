// 模块级自定义语法转换规则
//
// Crepe 内置规则与 Typora 行为不一致时的补充层。当前收录：
// - E1-3 行尾两空格 + Enter → 硬换行（hardBreak 节点）转换（按键规则，经 keymapCtx 注册）
// - E3-2 引用块内行首实时输入 `>> ` → 嵌套引用块（输入规则，经 inputRulesCtx 注册）
// - E10-3 非空行后输入 `---` → 前置段落转 setext 二级标题（输入规则，优先于内置 hr 规则注册）
// - E2-2 行首 `###Header`（无空格）+ Enter → H3 宽松 ATX 标题（输入规则，内置规则要求 `# ` 带空格）
// 后续扩展（Task 13）：E8 Typora 式建表、E19 Pandoc 行内数学（经 inputRulesCtx 注册）。
//
// 注入方式：Crepe create() 前通过 editor.config 调用 registerEditorInputRules(ctx)，
// 产品侧注入点为 create-editor.ts 工厂，测试侧为 makeTestEditor 助手（二者保持同源）。
import type { Ctx } from "@milkdown/kit/ctx";
import { inputRulesCtx, keymapCtx } from "@milkdown/kit/core";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import { TextSelection, type EditorState, type Transaction } from "@milkdown/kit/prose/state";
import { findWrapping } from "@milkdown/kit/prose/transform";

/** ProseMirror Command 派发函数类型（允许 dry-run 空派发） */
type Dispatch = (tr: Transaction) => void;

/**
 * 行尾两空格 + Enter → 硬换行（Typora 行为）
 *
 * Typora 在行尾键入两个空格后按 Enter，将两个空格转为硬换行且段落不拆分；
 * Crepe 内置（baseKeymap 的 Enter → splitBlock）默认保留空格并拆出新段落，与 Typora 不一致。
 * 本命令仅在光标前紧邻两个字符均为空格时消费 Enter 键：
 * 保留行尾两空格（CommonMark 硬换行落盘载体），在其后插入 hardBreak 节点，光标落在换行之后。
 *
 * 保留空格的原因：Milkdown 7.22.1 序列化器会丢弃段落末尾的 hardBreak 节点，
 * 行尾两空格是「渲染换行 + 序列化可回读（"  \n"）」二者兼得的唯一形态。
 *
 * @param state 编辑器当前状态（命令执行时的 ProseMirror State）
 * @param dispatch 事务派发函数；缺省表示 dry-run（只判断是否命中，不改文档）
 * @returns 是否消费该按键（true 阻止后续 Enter 拆段行为；false 回落内置行为）
 */
export function trailingSpacesHardBreakCommand(state: EditorState, dispatch?: Dispatch): boolean {
  const { selection } = state;
  // 仅处理行内文本光标：非文本选区（跨节点选区）不干预
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const { $from } = selection;
  // 光标父节点必须是文本块（段落/标题/列表项等）；文档级光标不处理
  if (!$from.parent.isTextblock) return false;
  // 行尾检测：光标前紧邻的两个字符均为空格才转换（CommonMark 硬换行语法）
  const textBefore = $from.parent.textBetween(0, $from.parentOffset);
  if (!textBefore.endsWith("  ")) return false;
  if (!dispatch) return true;
  // 在行尾两空格之后插入 hardBreak 节点；光标随插入映射到换行之后
  dispatch(state.tr.insert($from.pos, state.schema.nodes.hardbreak.create()).scrollIntoView());
  return true;
}

/**
 * 嵌套引用输入规则触发正则：行首空白后恰好两个 `>` 加一个空格（`>> `）
 *
 * 与内置引用规则（/^\s*>\s$/）正则互斥——内置规则对 `>> ` 不命中、本规则对 `> ` 不命中，
 * 两条规则共存无冲突；刻意不含 `>>> ` 等多级形态（AC-E3-2 只要求两级嵌套，
 * 需要更深的嵌套可连续多次触发 `>> `）。
 */
export const NESTED_BLOCKQUOTE_INPUT_PATTERN = /^\s*>>\s$/;

/**
 * setext 二级标题触发正则：当前行首到光标处恰为 `---`
 *
 * 与内置 hr 规则（/^(?:---|___\s|\*\*\*\s)$/）的 `---` 分支锚定完全相同的文本片段，
 * 便于在本规则未命中（返回 null）时原样回落内置行为；刻意不含 `----` 等多连字符形态
 * （内置 hr 规则同样不处理，行为一致），也不含 `=== ` 一级标题形态（不在 AC-E10 范围）。
 */
export const SETEXT_H2_INPUT_PATTERN = /^---$/;

/**
 * 构造嵌套引用输入规则（E3-2：引用块内行首实时输入 `>> ` 生成嵌套引用块）
 *
 * 动作与内置 `wrapInBlockquoteCommand` 语义一致：删除触发文本 `>> ` 后，
 * 用 findWrapping 计算包裹方案并 wrap 当前块，再合并相邻同型引用块（等价于
 * prosemirror wrappingInputRule 的 findWrapping + wrap + join 三段流程）。
 * 当前段落已在引用块内时，包裹即在原有层级上嵌套一级；在顶层触发时得到单级引用（可接受）。
 *
 * 节点类型不在注册期经 blockquoteSchema.type(ctx) 解析：registerEditorInputRules 运行于
 * editor.config 回调（ConfigReady 之前，SchemaReady 未就绪），提前解析实测抛
 * 「Cannot read properties of undefined (reading 'blockquote')」；改为 handler 命中时
 * 从 state.schema 取节点类型，时机与内置 $inputRule 插件内部 await SchemaReady 等价。
 *
 * @returns 已解析的 ProseMirror InputRule（含 match 正则与 handler，不依赖 ctx）
 */
export function createNestedBlockquoteInputRule(): InputRule {
  return new InputRule(NESTED_BLOCKQUOTE_INPUT_PATTERN, (state, _match, start, end) => {
    // 先删除触发文本 `>> `，包裹目标为删除后 start 位置所在的块
    const tr = state.tr.delete(start, end);
    const $start = tr.doc.resolve(start);
    // 输入规则触发时光标必在文本块内（空文档也是 doc(paragraph)），blockRange 恒可解析；
    // blockquote 对任意块都是合法包裹节点，findWrapping 恒非空。
    // `!` 仅作类型收窄，运行时不可达 null（与 wrappingInputRule 行为等价）
    const range = $start.blockRange()!;
    const wrapping = findWrapping(range, state.schema.nodes.blockquote)!;
    tr.wrap(range, wrapping);
    // 与紧邻的前置引用块合并（等价 wrappingInputRule 的 join 步骤，避免断开的同级引用）。
    // 前置节点已是 blockquote 时两者必然可合并，无需 canJoin 再判
    const before = tr.doc.resolve(start - 1).nodeBefore;
    if (before && before.type === state.schema.nodes.blockquote) {
      tr.join(start - 1);
    }
    return tr;
  });
}

/**
 * 构造 setext 二级标题输入规则（E10-3：非空行后输入 `---` 不误转水平线）
 *
 * 冲突背景：Crepe 内置 hr 输入规则（preset-commonmark insertHrInputRule）的正则为
 * /^(?:---|___\s|\*\*\*\s)$/，其中 `---` 分支无尾随空白要求——只要当前段落行首
 * 恰好是 `---`（第三个 `-` 落字时）就立即替换为水平线，不区分「文档首个空行」
 * 与「上一行有文字」两种场景；CommonMark 语义下后者应为 setext 二级标题：
 * 上一行文字成为 h2、`---` 作为下划线被消费，不产生水平线。
 *
 * 拦截方案：本规则同样锚定 /^---$/，因输入规则列表无 priority、按序尝试且先命中先消费，
 * 注册时必须排在内置 hr 规则之前（registerEditorInputRules 中前置插入）。
 * 命中后再校验前置块——仅当上一块是非空纯段落（CommonMark setext 对标题/列表项/
 * 空行均不生效，与内置 hr 保持一致）才执行转换，否则返回 null 回落内置规则
 * （空文档/空行后的 `---` 仍生成水平线，即 AC-E10-2 行为不变）。
 *
 * 转换动作：前置段落 setBlockType 为 heading(level=2)（段落内容 inline 可直接承载），
 * 再整体删除触发段落（含 `---` 文本，范围 [start-1, end+1]，nodeSize = 文本长 + 2）。
 * 两步操作基于原始文档坐标，Transform 内部按步映射，顺序不影响正确性；
 * 光标位于被删段落内，由 ProseMirror 选区自动映射落至新标题末侧（与内置 hr 规则
 * 同样不显式设选区，行为已被 E10 回归用例验证）。
 *
 * 节点类型在 handler 内经 state.schema 取用（与 createNestedBlockquoteInputRule 同理：
 * 注册期 SchemaReady 未就绪，不能提前解析）。
 *
 * @returns 已解析的 ProseMirror InputRule（含 match 正则与 handler，不依赖 ctx）
 */
export function createSetextH2InputRule(): InputRule {
  return new InputRule(SETEXT_H2_INPUT_PATTERN, (state, _match, start, end) => {
    // 触发时当前段落恰为 `---`（正则锚定行首到光标），start 即段落内容起点，
    // 段落节点起点为 start - 1；前置块为 doc 层上一个兄弟节点。
    // 当前段落若是 doc 首个子节点（空文档场景）则无前置块——child 越界会抛
    // RangeError（而非返回 undefined），必须先按索引判断
    const $from = state.doc.resolve(start);
    const before = $from.index(-1) > 0 ? $from.node(-1).child($from.index(-1) - 1) : null;
    // CommonMark setext 约束：上一块必须是非空纯段落；
    // 无前置块（空文档）、空行、标题/列表项等场景回落内置 hr 规则
    if (!before || before.type.name !== "paragraph" || !before.textContent.trim()) return null;

    const tr = state.tr;
    // 前置段落整体转为二级标题。setBlockType 的 from/to 必须落在块内部——
    // 块起始位置（如文档首块位置 0）nodesBetween 不会访问任何节点（pos < to 循环条件），
    // 导致转换静默失效；内容起点 = 节点起点 + 1（块开始标签恒宽 1），恒在块内
    const beforePos = start - 1 - before.nodeSize;
    tr.setBlockType(beforePos + 1, beforePos + 1, state.schema.nodes.heading, { level: 2 });
    // 删除触发段落（含 `---` 文本）；end 为光标位置（= 段落内容末尾），
    // 段落节点范围 = [start - 1, end + 1]（nodeSize 比内容长 2）
    tr.delete(start - 1, end + 1);
    return tr;
  });
}

/**
 * 宽松 ATX 标题触发正则：行首 # 号串（1-6 个）+ 首个非空白字符 + 行余文 + Enter 换行
 *
 * 内置 wrapInHeadingInputRule（/^(#+)\s$/）要求 # 后跟空白才会在输入空格时即时转换；
 * Typora 非严格模式下 `###Header`（无空格）按 Enter 同样渲染为 H3（AC-E2-2）。
 * Milkdown 的 customInputRules 插件在 Enter 按下时以 "\n" 作为拟输入文本重跑规则链，
 * 本正则即锚定该形态（行余文 + 换行），与内置严格规则互斥（后者要求 # 后立即空白）：
 * `# ` 场景在空格落字时已被内置规则即时消费，本规则仅在无空格形态的 Enter 时命中。
 */
export const LENIENT_ATX_HEADING_INPUT_PATTERN = /^(#{1,6})\S.*\n$/;

/**
 * 构造宽松 ATX 标题输入规则（E2-2：`###Header` 无空格按 Enter 转 H3）
 *
 * 转换动作：光标所在段落整段 setBlockType 为 heading（级别 = # 号数），
 * 再删除行首 # 标记（`###Header` → `Header`），光标落至转换后的行尾。
 * 仅在父块为普通段落时生效：标题块内（内置严格规则已升级/已转换场景）
 * 返回 null 回落内置 Enter 拆段行为。
 *
 * 节点类型在 handler 内经 state.schema 取用（与 createSetextH2InputRule 同理：
 * 注册期 SchemaReady 未就绪，不能提前解析）。
 *
 * @returns 已解析的 ProseMirror InputRule（含 match 正则与 handler，不依赖 ctx）
 */
export function createLenientAtxHeadingInputRule(): InputRule {
  return new InputRule(LENIENT_ATX_HEADING_INPUT_PATTERN, (state, match) => {
    // 仅转换普通段落行：父块非段落（如标题内继续输入、行中光标）回落内置 Enter 行为
    const { $from } = state.selection;
    if ($from.parent.type.name !== "paragraph") return null;
    // # 号串长度即标题级别（正则 {1,6} 已钳制上限，match[1] 恒为命中的 # 串）
    const level = match[1].length;
    // 内容起点：$from.start() = 父块（段落）内容起点（= 段落节点起点 + 1，开标签恒宽 1）；
    // 文本宽度取 textContent 长度——text 节点 nodeSize 含闭标签宽度，不能直接用于坐标换算
    const contentStart = $from.start();
    const textLength = $from.parent.textContent.length;
    const tr = state.tr;
    // 整段转标题：from/to 取内容起点（节点起点位置 nodesBetween 不访问任何节点，
    // 转换会静默失效——与 setext 规则的既有结论一致）
    tr.setBlockType(contentStart, contentStart, state.schema.nodes.heading, { level });
    // 删除行首 # 标记，仅保留标题文本（`###Header` → `Header`）
    tr.delete(contentStart, contentStart + match[1].length);
    // 光标落至转换后的行尾（标题内容末尾，位于标题节点内部）
    tr.setSelection(TextSelection.create(tr.doc, contentStart + textLength - match[1].length));
    return tr;
  });
}

/**
 * 将模块级自定义规则写入编辑器上下文（create() 前调用一次）
 * @param ctx milkdown 编辑器配置上下文（由 editor.config 回调注入）
 */
export function registerEditorInputRules(ctx: Ctx): void {
  // E1-3：Enter 键位优先消费（priority 200 > 内置默认 50），仅在行尾两空格场景返回 true
  ctx.get(keymapCtx).add({
    key: "Enter",
    priority: 200,
    onRun: () => trailingSpacesHardBreakCommand,
  });
  // 输入规则列表无 priority 概念，按列表顺序尝试、先命中先消费：
  // - E10-3 setext 规则必须排在最前，抢在内置 hr 规则（`---` 直接替换为水平线）之前拦截；
  //   其正则与前置块校验限定场景，未命中即返回 null 回落内置，空行 `---` 生成 hr 不受影响
  // - E2-2 宽松 ATX 规则仅在 Enter 时命中（正则锚定行尾换行），与内置严格规则
  //   （空格落字即消费）触发时机互斥，位置不影响正确性
  // - E3-2 嵌套引用规则与内置 `> ` 规则正则互斥，追加在末尾顺序不影响命中
  ctx.update(inputRulesCtx, (rules: InputRule[]) => [
    createSetextH2InputRule(),
    createLenientAtxHeadingInputRule(),
    ...rules,
    createNestedBlockquoteInputRule(),
  ]);
}
