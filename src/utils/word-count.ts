// 字数统计纯函数层（11 状态栏模块，spec §3「统计纯函数 utils/word-count.ts 与 Vue 组件解耦，口径是核心数据路径」）
//
// 口径权威：docs/specs/research/11-状态栏-research.md §2.1/§4 + spec §2 S3（出处见各函数注释）。
// 域边界（宪法 A.7.4）：本文件不 import 任何 @milkdown/kit/prose/* 类型——以 CountableDoc/
// CountableNode 窄结构接口（鸭子类型）解耦编辑器域；真 ProseMirror 文档与本接口结构兼容，
// 由 11 域层装配 composable 直传（01 门面事件回调携带 doc 为既定锁定接口，05 大纲同模式）。

/** 计数单位（状态栏按钮默认计数单位，面板条目点击切换；默认 words = 调研 §2.1 用户实测） */
export type WordCountUnit = "words" | "characters" | "lines";

/** 可统计节点的最小结构面（与 ProseMirror Node 结构兼容的窄接口，仅供遍历统计消费） */
export interface CountableNode {
  readonly isText: boolean;
  readonly isBlock: boolean;
  readonly type: { readonly name: string };
  /** 文本节点内容；非文本节点为 undefined（ProseMirror text 节点恒有值） */
  readonly text?: string;
}

/** 可统计文档的最小结构面（与 ProseMirror Node 结构兼容；descendants/nodesBetween 同名同义） */
export interface CountableDoc {
  descendants(callback: (node: CountableNode, pos: number) => void): void;
  nodesBetween(
    from: number,
    to: number,
    callback: (node: CountableNode, pos: number) => void,
  ): void;
}

/** 统计结果（全文与选区同形三值；弹面板与「选中 N / 总 N」的唯一数据源） */
export interface WordCountStats {
  /** 词数（CJK 逐字 + 拉丁/数字连续串） */
  words: number;
  /** 字符数（渲染级全部 text 字符，含空格——调研 §3-3 拍板口径） */
  characters: number;
  /** 行数（渲染级逻辑行，自定口径见 countDocument 注释） */
  lines: number;
}

/** 计词分词正则：Han 逐字命中 | 非 Han 的 Unicode 字母/数字连续串（调研 §4 计词规则）。
 *  连续串以负向前瞻排除 Han（Han 亦属 \p{L}，裸 \p{L}+ 会把假名+汉字混排吞成一词），
 *  使假名/西里尔等连续串在汉字边界切断，保证汉字逐字计数 */
const WORD_TOKEN_RE = /\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{N}])+/gu;

/**
 * 单段文本计词（计词规则唯一实现，countDocument/countSelection 共用）
 * @param text 任意文本片段；允许空串
 * @returns 词数；纯标点/空白/空串返回 0
 */
export function countWords(text: string): number {
  // String.match 全局正则一次扫描（O(n)），无命中返回 null → 0
  return text.match(WORD_TOKEN_RE)?.length ?? 0;
}

/** 行内内容容器叶子块（渲染级「一行」的块级来源）+ hardbreak 行内断行同权计行 */
const INLINE_HOST_BLOCKS = new Set(["paragraph", "heading", "code_block"]);

/**
 * 节点是否计为一行（全文与选区共用的行判定，消除两处遍历的重复表达式）
 * @param node 遍历中回调到的节点
 * @returns 行内内容容器块（paragraph/heading/code_block）或 hardbreak 断行返回 true
 */
function countsAsLine(node: CountableNode): boolean {
  return INLINE_HOST_BLOCKS.has(node.type.name) || node.type.name === "hardbreak";
}

/**
 * 全文统计（O(n) 单次 descendants 遍历；spec §3「统计 O(n) 字符遍历毫秒级」）
 *
 * 口径：全部 text 节点同权累计词与字符——代码块文本天然计入（code_block content='text*'，
 * CodeMirror 编辑回写 text 节点，调研 §4 + 用户实测 #2），渲染级无格式标记符（加粗星号/
 * 围栏等是 mark/语法而非 text 节点，「标记符不计」自动成立，AC-S3-5）；
 * 行数 = 行内内容容器叶子块（paragraph/heading/code_block）计数 + hardbreak 断行计数
 * （自定口径，调研未载明，披露 2；空文档 0 行）。
 * @param doc 可统计文档（真 ProseMirror doc 结构兼容直传）
 * @returns 三值统计；空文档返回全零
 */
export function countDocument(doc: CountableDoc): WordCountStats {
  let words = 0;
  let characters = 0;
  let lines = 0;
  doc.descendants((node) => {
    if (node.isText && node.text) {
      words += countWords(node.text);
      characters += node.text.length;
      return;
    }
    if (countsAsLine(node)) {
      lines += 1;
    }
  });
  return { words, characters, lines };
}

/**
 * 选区统计（nodesBetween 区间遍历，不复制子树——spec §3「nodesBetween 区间遍历不复制子树」；
 * 相比 doc.cut 省复制、相比 textBetween 无分隔符误计，调研 §4）
 *
 * 口径：首尾部分选中的文本节点按选区切片（Math.max/min 夹取），杜绝整节点误计；
 * 行 = 选区命中的行内内容容器块计数（被选中即计 1，自定口径，披露 3）。
 * @param doc 可统计文档
 * @param from 选区起点（ProseMirror 文档坐标，来源 selection.from）
 * @param to 选区终点（来源 selection.to）；from === to（光标态）返回全零
 * @returns 三值统计
 */
export function countSelection(doc: CountableDoc, from: number, to: number): WordCountStats {
  // 光标态（from === to）选区为空直接返回全零：nodesBetween 对空区间仍会回调与该位置
  // 相交的容器块（pos < to && end > from 边界条件），不守卫会把「光标所在块」误计为 1 行
  if (from === to) {
    return { words: 0, characters: 0, lines: 0 };
  }
  let words = 0;
  let characters = 0;
  let lines = 0;
  doc.nodesBetween(from, to, (node, pos) => {
    if (countsAsLine(node)) {
      lines += 1;
      return;
    }
    if (!node.isText || !node.text) return;
    // 首尾跨界文本节点切片：[max(pos, from), min(pos + len, to))，空区间跳过
    const start = Math.max(pos, from);
    const end = Math.min(pos + node.text.length, to);
    if (end <= start) return;
    const segment = node.text.slice(start - pos, end - pos);
    words += countWords(segment);
    characters += segment.length;
  });
  return { words, characters, lines };
}

/**
 * 估计阅读时间（分钟）
 * @param words 词数（恒按字数口径折算，不随显示单位切换）
 * @param readingSpeed 阅读速度（词/分钟，来源 settingsStore.merged.appearance.readingSpeed）
 * @returns 向上取整分钟数（words=0 → 0）；readingSpeed ≤ 0 返回 undefined（UI 隐藏行，AC-S3-6）
 */
export function estimateReadingMinutes(words: number, readingSpeed: number): number | undefined {
  if (readingSpeed <= 0) return undefined;
  return Math.ceil(words / readingSpeed);
}
