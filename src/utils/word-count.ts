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
