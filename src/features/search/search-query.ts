// 搜索查询构建与匹配集纯函数（06 核心，100% 覆盖组）
//
// 职责：三开关 → 官方 SearchQuery 的受控构建（非法正则/可空匹配正则前置拒绝）、
// 匹配集迭代（零长匹配步进守卫——官方 buildMatchDeco/replaceAll 对可空正则会
// pos=next.to 原地打转，本层统一拦截）、按序号定位与活动序号判定。
// 全部为纯函数：jsdom + makeTestEditor 即可完整测试。
import { SearchQuery } from "prosemirror-search";
import type { SearchResult } from "prosemirror-search";
import type { EditorState } from "@milkdown/kit/prose/state";

/** 查询输入形态（面板 store 与全局搜索共用） */
export interface SearchInput {
  /** 查找词（正则模式下为表达式原文） */
  query: string;
  /** 替换串（$n/$& 占位由官方 getReplacements 解析） */
  replacement?: string;
  /** 大小写敏感（缺省 false） */
  caseSensitive?: boolean;
  /** 全词匹配（官方 Unicode \p{L} 词界，中文语义正确） */
  wholeWord?: boolean;
  /** 正则模式（缺省 false） */
  regexp?: boolean;
}

/** 构建结果：ok 携带可用查询；其余状态调用方按各自 UI 语义呈现 */
export type BuiltSearch =
  | { status: "ok"; query: SearchQuery }
  | { status: "empty" }
  | { status: "invalid-regex" }
  | { status: "matches-empty" };

/** 匹配迭代上限（异常超大文档防御） */
export const MATCH_ITER_LIMIT = 10000;

/**
 * 受控构建官方查询对象
 * @param input 三开关 + 查找/替换串（query 允许空串 → empty 状态）
 * @returns ok/empty/invalid-regex/matches-empty 四态之一
 */
export function buildSearchQuery(input: SearchInput): BuiltSearch {
  if (!input.query) return { status: "empty" };
  if (input.regexp) {
    try {
      // 构造探测即官方 validRegExp 同款校验；可空匹配另行拒绝（replaceAll 死循环防线）
      new RegExp(input.query);
    } catch {
      return { status: "invalid-regex" };
    }
    if (new RegExp(input.query).test("")) return { status: "matches-empty" };
  }
  const query = new SearchQuery({
    search: input.query,
    replace: input.replacement ?? "",
    caseSensitive: input.caseSensitive ?? false,
    wholeWord: input.wholeWord ?? false,
    regexp: input.regexp ?? false,
  });
  // 双保险：官方对非正则空串等场景同样判 invalid
  return query.valid ? { status: "ok", query } : { status: "invalid-regex" };
}

/**
 * 收集匹配集（文档序，含零长步进守卫与总量上限）
 * @param state 编辑器状态（doc + selection 供官方词界检查）
 * @param query 已构建查询（invalid 时恒返回 []）
 * @param max 收集上限（全局计数截断消费；缺省无限，另有 MATCH_ITER_LIMIT 硬顶）
 */
export function collectMatches(
  state: EditorState,
  query: SearchQuery,
  max = Infinity,
): SearchResult[] {
  if (!query.valid) return [];
  const out: SearchResult[] = [];
  const end = Math.min(state.doc.content.size, Number.MAX_SAFE_INTEGER);
  let pos = 0;
  while (out.length < max && out.length < MATCH_ITER_LIMIT) {
    const next = query.findNext(state, pos, end);
    if (!next) break;
    if (next.to <= next.from) {
      // 零长匹配（如 z* 类正则）：pos=next.to 会原地打转（官方 buildMatchDeco/replaceAll
      // 存在同款隐患），此处丢弃该命中并 +1 强制前进
      pos = next.to + 1;
      continue;
    }
    out.push(next);
    pos = next.to;
  }
  return out;
}

/**
 * 取第 ordinal 个匹配区间（0 起，文档序）
 *
 * 跨文件结果与文档内命中的对齐底座：外部扫描产出的结果序号直接对齐
 * 本函数取位，不做行号换算（PM 文档模型丢弃空行，行号映射会系统性漂移）。
 * @param state 编辑器状态
 * @param query 已构建查询
 * @param ordinal 匹配序号（0 起；来源为跨文件扫描等外部输入，不可信）
 * @returns 匹配区间；序号非法（非整数/负数/达迭代上限）或越界返回 undefined
 */
export function nthMatch(
  state: EditorState,
  query: SearchQuery,
  ordinal: number,
): { from: number; to: number } | undefined {
  // 非法序号防御：非整数（含 NaN/Infinity）/负数/超出迭代上限一律拒绝，
  // 防御异常外部输入把 collectMatches 拖成超限扫描
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= MATCH_ITER_LIMIT) return undefined;
  // 只收集到目标序号为止：避免为取单项而全量迭代大文档
  return collectMatches(state, query, ordinal + 1)[ordinal];
}

/**
 * 活动序号判定（计数 3/10 的分子来源）
 * @param matches collectMatches 结果（文档序）
 * @param head 当前光标头位置
 * @returns 第一个 to > head 的下标；全部越过回落末项；空集 0
 */
export function activeMatchIndex(matches: SearchResult[], head: number): number {
  for (let i = 0; i < matches.length; i += 1) {
    // 循环边界 i < matches.length 保证元素存在（! 仅作类型收窄）
    if (matches[i]!.to > head) return i;
  }
  return Math.max(0, matches.length - 1);
}
