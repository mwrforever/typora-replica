// 模块级自定义语法转换规则
//
// Crepe 内置规则与 Typora 行为不一致时的补充层。当前收录：
// - E1-3 行尾两空格 + Enter → 硬换行（hardBreak 节点）转换（按键规则，经 keymapCtx 注册）
// - E3-2 引用块内行首实时输入 `>> ` → 嵌套引用块（输入规则，经 inputRulesCtx 注册）
// - E10-3 非空行后输入 `---` → 前置段落转 setext 二级标题（输入规则，优先于内置 hr 规则注册）
// - E2-2 行首 `###Header`（无空格）+ Enter → H3 宽松 ATX 标题（输入规则，内置规则要求 `# ` 带空格）
// - E8-1 整行 `| 表头 | 表头 |` + Enter → Typora 式建表（表头行含输入文本 + 空数据行，
//   输入规则，经模块级 addEditorInputRule 登记后由 registerEditorInputRules 注入）
// - E19-1~4 Pandoc 行内数学（三条规则 + 转义保护 + 数字回退，输入规则，前置注册压制内置 `$...$` 规则）
//
// 注入方式：Crepe create() 前通过 editor.config 调用 registerEditorInputRules(ctx)，
// 产品侧注入点为 create-editor.ts 工厂，测试侧为 makeTestEditor 助手（二者保持同源）。
import type { Ctx } from "@milkdown/kit/ctx";
import { inputRulesCtx, keymapCtx } from "@milkdown/kit/core";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import type { Node, ResolvedPos, Schema } from "@milkdown/kit/prose/model";
import { TextSelection, type EditorState, type Transaction } from "@milkdown/kit/prose/state";
import { findWrapping } from "@milkdown/kit/prose/transform";

/** ProseMirror Command 派发函数类型（允许 dry-run 空派发） */
type Dispatch = (tr: Transaction) => void;

/** 模块级追加注册的输入规则（create() 前经 addEditorInputRule 登记，随 registerEditorInputRules 注入） */
const moduleInputRules: InputRule[] = [];

/**
 * 追加自定义输入规则（create() 前调用，模块加载期即登记）
 * @param rule ProseMirror 输入规则
 */
export function addEditorInputRule(rule: InputRule): void {
  moduleInputRules.push(rule);
}

/** 查询已注册的模块级规则（测试用） */
export function listEditorInputRules(): readonly InputRule[] {
  return moduleInputRules;
}

/**
 * 输入规则 code 标记守卫：光标是否位于行内代码跨度内
 *
 * milkdown customInputRules 的 run() 缺少 prosemirror-inputrules 原版 inCodeMark 检查，
 * 内置反引号规则在键入 `` ` `` 时即时把内容转为 inlineCode mark（反引号被消费），
 * 其后的规则链对代码跨度文本同样可见——建表/宽松 ATX/嵌套引用规则会误吞代码跨度
 * 内文本（FIX-3/4/8）。本守卫检查光标前后紧邻文本节点的 marks 是否含 code 类标记
 * （preset-commonmark 的 inlineCode mark 声明 spec.code: true）。
 *
 * 不用 $from.marks()：inlineCode mark 声明 inclusive: false，光标位于跨度文本末尾
 * 时 marks() 会将该 mark 从集合移除（返回空），守卫会静默失效（FIX-3/4/8 实测）。
 * @param $from 光标解析位置
 * @returns 光标处于代码跨度内（或其边缘）返回 true
 */
function isInInlineCode($from: ResolvedPos): boolean {
  // 光标在跨度文本内/末尾：nodeBefore 即该文本节点；光标在跨度文本开头：nodeAfter 即该文本节点
  const before = $from.nodeBefore;
  if (before?.isText && before.marks.some((m) => m.type.spec.code)) return true;
  const after = $from.nodeAfter;
  if (after?.isText && after.marks.some((m) => m.type.spec.code)) return true;
  return false;
}

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
  // 行尾判定：仅光标位于文本块内容末尾（行尾）时转换；段中"两空格"后按 Enter
  // 应回落内置拆段行为（Typora 段中两空格不构成硬换行，缺此判定会误插 hardBreak）
  if ($from.parentOffset !== $from.parent.content.size) return false;
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
    // 代码跨度内文本不触发（`` `>>` `` + 空格不被吞为嵌套引用，回落内置行为）
    if (isInInlineCode(state.selection.$from)) return null;
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
    // 代码跨度内文本不触发（`` `###Header` `` + Enter 不转标题，回落内置拆段）
    if (isInInlineCode($from)) return null;
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
 * 构建 Typora 式建表节点：表头行（含输入文本）+ 一行空数据行
 *
 * 与内置 createTable 的区别：表头单元格携带键入文本（内置 `|2x2|` 规则不填充文本）。
 * table schema 内容模型为 table_header_row table_row+（头行后必须至少一个数据行），
 * 只建表头行会因内容模型校验失败而损坏文档——补一行空数据行与 Typora 的
 * `| a | b |` + Enter 产出（表头 + 空数据行）形态一致。
 * 单元格全空白时文本为 ""，text 节点不允许空串，空单元格退化为空段落。
 * 节点类型在 handler 内经 state.schema 取用（注册期 SchemaReady 未就绪，与既有规则同理）。
 *
 * @param schema 编辑器 schema（handler 传入 state.schema）
 * @param cells 单元格文本列表（至少 1 个，由触发正则保证）
 */
function buildTyporaTable(schema: Schema, cells: string[]): Node {
  const headerCells = cells.map((text) =>
    // 表头单元格：段落 + 文本；全空白单元格（trim 后为空串）退化为空段落
    text
      ? schema.nodes.table_header.create(
          null,
          schema.nodes.paragraph.create(null, schema.text(text)),
        )
      : schema.nodes.table_header.create(null, schema.nodes.paragraph.create()),
  );
  const headerRow = schema.nodes.table_header_row.create(null, headerCells);
  // 数据行：与表头同列数的空单元格；createAndFill 自动填充必填段落，
  // 单元格内容模型恒可填充，null 仅作类型收窄不可达（与内置 createTable 同一写法）
  const bodyCell = schema.nodes.table_cell.createAndFill()!;
  const bodyRow = schema.nodes.table_row.create(
    null,
    Array.from({ length: cells.length }, () => bodyCell),
  );
  return schema.nodes.table.create(null, [headerRow, bodyRow]);
}

/**
 * Typora 式建表触发正则：整行 1~N 个竖线分隔单元格 + Enter 换行
 *
 * 尾随 `\n` 为触发时机锚点：customInputRules 插件仅在 Enter 按下时以 "\n" 作拟输入
 * 重跑规则链，本正则锚定该形态后规则只在 Enter 时命中（Typora 行为：键入整行后
 * Enter 确认建表），打字途中闭合第二个 `|` 不会提前建表；与内置 `|2x2| ` 规则
 * （单元格为数字、尾随空白）正则互斥，共存无冲突。
 */
export const TYPORA_TABLE_INPUT_PATTERN = /^\|(?:\s*[^|\n]+\s*\|)+\s*\n$/;

/**
 * Typora 式建表输入规则：`| 表头 | 表头 |` + Enter → 创建表头含文本的表格
 *
 * 命中后经三重校验：
 * - 触发文本独占父块整行（行首偏移 0 且光标在父块内容末尾），行中有多余文本或多行
 *   段落窗口时返回 null 回落内置 Enter 拆段；
 * - 表格能替换父块（canReplaceWith，与内置 insertTableInputRule 同款守卫）：
 *   列表项/单元格内的建表语法不转换；
 * 转换动作：整体替换触发段落节点（不残留空段落），光标移入首个数据行单元格
 * （Typora 建表后可直接输入数据）。
 */
const typoraTableRule = new InputRule(TYPORA_TABLE_INPUT_PATTERN, (state, match, start, end) => {
  // 代码跨度内文本不触发（`` `| a | b |` `` + Enter 不建表，回落内置拆段）
  if (isInInlineCode(state.selection.$from)) return null;
  // 触发文本必须从父块内容起点开始（parentOffset 0 = 独占整行起点）
  const $start = state.doc.resolve(start);
  if ($start.parentOffset !== 0) return null;
  // 光标必须在父块内容末尾（行尾无未消费文本才建表）
  const $end = state.doc.resolve(end);
  if ($end.parentOffset !== $end.parent.content.size) return null;
  // 表格必须能替换父块对应子节点区间（doc 可容纳块级表格；列表项/单元格内拒绝转换）
  if (
    !$start
      .node(-1)
      .canReplaceWith($start.index(-1), $start.indexAfter(-1), state.schema.nodes.table)
  ) {
    return null;
  }
  // 解析单元格文本：去掉行首行尾竖线与拟输入换行后按 | 切分并去空白
  const raw = match[0].replace(/\n$/, "");
  const cells = raw
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
  const table = buildTyporaTable(state.schema, cells);
  // 整体替换触发段落节点（范围含开闭标签），不留空段落
  const tr = state.tr.replaceRangeWith(start - 1, end + 1, table);
  // 光标移入首个数据行单元格：表格起点(start-1) + 开标签(1) + 表头行宽 + 行开标签(1)
  // + 格开标签(1) + 段落开标签(1) = start + 表头行宽 + 3
  tr.setSelection(TextSelection.create(tr.doc, start - 1 + 1 + table.child(0).nodeSize + 3));
  return tr;
});

addEditorInputRule(typoraTableRule);

/**
 * Pandoc 行内数学触发正则：光标前文本以 `$内容$` 结尾（内容非空、不含 $ 与换行）
 *
 * 匹配范围刻意放宽（不在正则内联 Pandoc 三条约束）：三条约束需在 handler 内结合
 * 文档与匹配内容判定（转义保护要回看匹配起点前一字符、闭 $ 后紧跟数字要跨节点回退），
 * 正则只负责圈定 `$...$` 形态。内置 latex 规则 /(?:\$)([^$]+)(?:\$)$/ 对 `$ x$`、
 * `$x $`、`$x\$` 均会误转（`[^$]+` 不排除空白/反斜杠），本规则命中后由 handler 决定
 * 转换或字面消费，返回非 null 即阻止内置规则继续尝试。
 */
export const PANDOC_INLINE_MATH_PATTERN = /\$([^$\n]+)\$$/;

/**
 * Pandoc 行内数学转换 handler（创建 math_inline 节点或字面消费输入）
 *
 * Pandoc 三条规则（用户实测校准，见 01 调研第 2 节）：
 *   1. 开 `$` 后无空格/制表符（内容首字符非空白）
 *   2. 闭 `$` 前无空格/制表符且前一字符非反斜杠（内容末字符非空白/反斜杠）
 *   3. 闭 `$` 后不紧跟数字（`$x$2` 保持文本）——闭 `$` 落字时后续字符尚不存在，
 *      由 createInlineMathDigitRevertRule 在数字落字时回退兑现（见下）
 * 另含转义保护（AC-E19-4）：开 `$` 前一字符为反斜杠时按字面处理，不进入公式态。
 *
 * 字面分支的消费动作 = 仅插入本次键入字符（match[0] 末尾，即闭 $），
 * 保证输入不丢失、文档保持字面 `$...$` 文本；转换分支将匹配区间整体替换为
 * math_inline 节点（节点类型与 attrs 字段经实测核对安装源码：节点名 `math_inline`、
 * 属性 `value`，见 @milkdown/crepe latex feature inline-latex.ts）。
 *
 * @param state 编辑器当前状态（命中输入规则时的 ProseMirror State）
 * @param match 正则命中结果（match[0] 为光标前匹配文本、match[1] 为 $ 间内容）
 * @param start 匹配区间起点（开 $ 所在文档位置）
 * @param end 光标位置（匹配区间终点，键入字符尚未落入文档）
 * @returns 转换事务；无 math_inline 节点类型时返回 null 回落后续规则
 */
export function pandocInlineMathHandler(
  state: EditorState,
  match: RegExpMatchArray,
  start: number,
  end: number,
): Transaction | null {
  // 转义保护：开 $ 前一字符为反斜杠 → 字面消费（文档位置 start-1 取单字符，
  // 段落边界处 textBetween 返回空串，天然不命中转义）
  const before = state.doc.textBetween(Math.max(0, start - 1), start);
  // 正则 [^$\n]+ 保证捕获组恒为非空内容，! 仅作类型收窄（运行时不可达 null）
  const content = match[1]!;
  if (before === "\\" || /^\s/.test(content) || /[\s\\]$/.test(content)) {
    // 仅插入本次键入的闭 $，既有 `$...` 文本保持字面，阻止内置规则误转
    return state.tr.insertText(match[0].slice(end - start), end);
  }
  const mathInline = state.schema.nodes["math_inline"];
  if (!mathInline) return null;
  // 匹配区间（含开 $ 与内容，不含刚键入的闭 $）整体替换为行内数学节点
  return state.tr.replaceRangeWith(start, end, mathInline.create({ value: content }));
}

/**
 * 构造 Pandoc 行内数学输入规则（E19：`$...$` 渲染 + 三条约束 + 转义保护）
 *
 * 必须注册在内置 latex 规则之前（registerEditorInputRules 中前置插入）：
 * 输入规则列表按序尝试、先命中先消费，本规则命中（含字面消费）即压制内置误转。
 * 节点类型在 handler 内经 state.schema 取用（注册期 SchemaReady 未就绪，与既有规则同理）。
 *
 * @returns 已解析的 ProseMirror InputRule（含 match 正则与 handler，不依赖 ctx）
 */
export function createPandocInlineMathRule(): InputRule {
  return new InputRule(PANDOC_INLINE_MATH_PATTERN, pandocInlineMathHandler);
}

/**
 * 行内数学数字回退触发正则：光标前为叶子节点占位符 + 单个数字
 *
 * `\ufffc` 是 ProseMirror 输入规则链对叶子节点的占位符（textBetween leafText 参数），
 * 即「任意叶子节点之后紧跟着键入数字」；是否为 math_inline 节点由 handler 判定，
 * 其他叶子节点（如脚注引用）后输入数字不受影响。
 */
export const INLINE_MATH_DIGIT_REVERT_PATTERN = /\ufffc(\d)$/;

/**
 * 行内数学数字回退 handler（Pandoc 规则 3：闭 $ 后紧跟数字不成立式）
 *
 * 背景：闭 `$` 落字时规则 3 无法判定（后续字符尚未键入），行内数学已按 `$x$` 实时渲染；
 * 随后键入数字即触发本规则，将 math_inline 节点整体回退为字面 `$内容$` 文本并
 * 接上键入的数字，最终文档为纯文本 `$x$2`（Typora/Pandoc 行为：不渲染公式）。
 *
 * 定位方式不依赖输入规则链传入的 start 坐标（叶子占位符使 start 落入节点内部、
 * 与实际节点起点存在偏移），改由光标 end 前向取 nodeBefore 精确定位前置叶子节点。
 *
 * @param state 编辑器当前状态（命中输入规则时的 ProseMirror State）
 * @param match 正则命中结果（match[1] 为紧随叶子节点键入的数字）
 * @param start 输入规则链计算的匹配起点（叶内坐标，仅占位不使用）
 * @param end 光标位置（键入数字尚未落入文档）
 * @returns 回退事务；前置节点非 math_inline 时返回 null 回落后续规则
 */
export function inlineMathDigitRevertHandler(
  state: EditorState,
  match: RegExpMatchArray,
  _start: number,
  end: number,
): Transaction | null {
  // 光标前紧邻节点必须恰为行内数学节点：文本节点、其他叶子节点（脚注引用等）均不干预
  const nodeBefore = state.doc.resolve(end).nodeBefore;
  if (!nodeBefore || nodeBefore.type.name !== "math_inline") return null;
  // schema 声明 value 默认空串，实际恒为字符串内容
  const value = String(nodeBefore.attrs.value);
  // 数学节点与键入数字整体回退为字面文本（`$x$` + `2` → `$x$2`）
  return state.tr.replaceRangeWith(
    end - nodeBefore.nodeSize,
    end,
    state.schema.text(`$${value}$${match[1]}`),
  );
}

/**
 * 构造行内数学数字回退输入规则（E19：`$x$2` 闭 $ 后紧跟数字保持文本）
 *
 * 与 createPandocInlineMathRule 同处前置注册区：二者正则互斥（$...$ 文本 vs 叶子占位符），
 * 顺序无冲突；回退规则必须同样排在内置规则之前，先于任何可能命中 `\ufffc\d` 的规则。
 *
 * @returns 已解析的 ProseMirror InputRule（含 match 正则与 handler，不依赖 ctx）
 */
export function createInlineMathDigitRevertRule(): InputRule {
  return new InputRule(INLINE_MATH_DIGIT_REVERT_PATTERN, inlineMathDigitRevertHandler);
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
  // - E19 Pandoc 行内数学与数字回退规则同样前置：内置 latex 规则 /(?:\$)([^$]+)(?:\$)$/
  //   对 `$ x$`/`$x $`/`$x\$` 误转，本规则命中（转换或字面消费）即压制内置误转
  // - E3-2 嵌套引用规则与内置 `> ` 规则正则互斥，追加在末尾顺序不影响命中
  // - E8-1 Typora 建表规则同样仅在 Enter 时命中，与内置 `|2x2| ` 规则正则互斥，末尾追加
  ctx.update(inputRulesCtx, (rules: InputRule[]) => [
    createSetextH2InputRule(),
    createLenientAtxHeadingInputRule(),
    createPandocInlineMathRule(),
    createInlineMathDigitRevertRule(),
    ...rules,
    createNestedBlockquoteInputRule(),
    ...moduleInputRules,
  ]);
}
