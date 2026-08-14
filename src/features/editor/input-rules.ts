// 模块级自定义语法转换规则
//
// Crepe 内置规则与 Typora 行为不一致时的补充层。当前收录：
// - E1-3 行尾两空格 + Enter → 硬换行（hardBreak 节点）转换（按键规则，经 keymapCtx 注册）
// - E3-2 引用块内行首实时输入 `>> ` → 嵌套引用块（输入规则，经 inputRulesCtx 注册）
// 后续扩展（Task 13）：E8 Typora 式建表、E19 Pandoc 行内数学（经 inputRulesCtx 注册）。
//
// 注入方式：Crepe create() 前通过 editor.config 调用 registerEditorInputRules(ctx)，
// 产品侧注入点为 create-editor.ts 工厂，测试侧为 makeTestEditor 助手（二者保持同源）。
import { inputRulesCtx, keymapCtx, type Ctx } from "@milkdown/kit/core";
import { InputRule, wrappingInputRule } from "@milkdown/kit/prose/inputrules";
import { TextSelection, type EditorState, type Transaction } from "@milkdown/kit/prose/state";

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
 * 构造嵌套引用输入规则（E3-2：引用块内行首实时输入 `>> ` 生成嵌套引用块）
 *
 * 动作与内置 `wrapInBlockquoteCommand` 语义一致（blockRange + findWrapping 包裹当前块，
 * 已核实该导出名存在于 @milkdown/kit/preset/commonmark）：当前段落已在引用块内时，
 * 包裹即在原有层级上嵌套一级；在顶层触发时得到单级引用（可接受）。
 * 委托 prosemirror 的 wrappingInputRule 标准模板：删除触发文本 `>> ` → 包裹当前块 → 相邻同型合并。
 *
 * 节点类型不在注册期经 blockquoteSchema.type(ctx) 解析：registerEditorInputRules 运行于
 * editor.config 回调（ConfigReady 之前，SchemaReady 未就绪），提前解析实测抛
 * 「Cannot read properties of undefined (reading 'blockquote')」；改为 handler 命中时
 * 从 state.schema 取节点类型，时机与内置 $inputRule 插件内部 await SchemaReady 等价。
 *
 * @returns 已解析的 ProseMirror InputRule（含 match 正则与 handler，不依赖 ctx）
 */
export function createNestedBlockquoteInputRule(): InputRule {
  return new InputRule(NESTED_BLOCKQUOTE_INPUT_PATTERN, (state, match, start, end) =>
    wrappingInputRule(NESTED_BLOCKQUOTE_INPUT_PATTERN, state.schema.nodes.blockquote).handler(
      state,
      match,
      start,
      end,
    ),
  );
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
  // E3-2：嵌套引用输入规则（`>> ` 触发）追加进输入规则列表。
  // 输入规则列表无 priority 概念，按列表顺序尝试；本规则与内置 `> ` 规则正则互斥，顺序不影响命中
  ctx.update(inputRulesCtx, (rules) => [...rules, createNestedBlockquoteInputRule()]);
}
