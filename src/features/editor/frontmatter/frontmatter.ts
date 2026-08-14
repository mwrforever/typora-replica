// YAML Front Matter 处理（E11）
//
// 策略（已锁定）：加载时剥离存内存、保存/导出回写，不进文档树。
// 与 E10 水平线 `---` 的歧义按「文档第一个块」判定（AC-E11-3）。
// Typora 专有属性白名单（typora-root-url/typora-copy-images-to）供 07 图片模块读取。
//
// 纯函数模块：无状态、无外部依赖，线程安全（每次调用独立计算）。
/** 文首 front matter 定界符 */
const FM_DELIMITER = "---";
/** 首块正则：文档开头即 --- 且后续存在闭合 --- */
const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * 解析文档：剥离文首 front matter
 *
 * 仅在「文档第一个块」位置识别（AC-E11-3）；内文非法时按原文保留并告警（AC-E11-4）。
 * @param md 原始 markdown 文档（可为空；允许 CRLF/LF 换行）
 * @returns frontMatter 为 null 表示无有效 front matter；body 为编辑器正文
 */
export function parseFrontMatter(md: string): { frontMatter: string | null; body: string } {
  const match = FRONT_MATTER_RE.exec(md);
  if (!match) return { frontMatter: null, body: md };
  const inner = match[1];
  if (!isValidFrontMatter(inner)) {
    // 非法 YAML：不剥离、按原文保留并告警（AC-E11-4）
    console.warn("[MarkWell] 文首 front matter YAML 非法，按原文保留：", inner.slice(0, 80));
    return { frontMatter: null, body: md };
  }
  return { frontMatter: inner, body: md.slice(match[0].length) };
}

/**
 * 回写 front matter（原样保留，不做 YAML 重序列化）
 *
 * 用于保存/导出时把内存暂存的 FM 内文拼回正文之前（AC-E11-2）。
 * @param frontMatter 剥离时的 FM 内文（不含定界符）
 * @param body 编辑器正文
 * @returns 完整落盘文档
 */
export function reinsertFrontMatter(frontMatter: string, body: string): string {
  return `${FM_DELIMITER}\n${frontMatter}\n${FM_DELIMITER}\n${body}`;
}

/**
 * 校验 front matter 内文合法性（行级最小校验）
 *
 * 合法行：`key: value` 键值对、注释（#）、空行；非键值行、括号/引号未闭合判为非法。
 * @param fm front matter 内文（不含定界符）
 * @returns 全部行合法返回 true；任一非法行返回 false
 */
export function isValidFrontMatter(fm: string): boolean {
  const lines = fm.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    // 空行与注释行合法
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    // 非键值行非法
    if (!/^[\w-]+\s*:/.test(trimmed)) return false;
    // 括号/引号成对校验（防未闭合结构）
    if (!isBalanced(trimmed)) return false;
  }
  return true;
}

/**
 * 校验单行括号/引号是否成对
 *
 * 括号严格配对（[ 配 ]、{ 配 }）；引号可开启亦可闭合——栈顶为同类引号时视为闭合，
 * 否则视为开启新引号串（兼容 YAML 常见引号值）。
 * @param line 已通过键值行校验的单行文本
 * @returns 全部成对返回 true；未闭合或错配返回 false
 */
function isBalanced(line: string): boolean {
  const stack: string[] = [];
  for (const ch of line) {
    if (ch === '"' || ch === "'") {
      // 引号：与栈顶同类引号配对闭合，否则开启新引号串
      if (stack[stack.length - 1] === ch) stack.pop();
      else stack.push(ch);
    } else if (ch === "[" || ch === "{") {
      stack.push(ch);
    } else if (ch === "]" || ch === "}") {
      // 闭合括号必须与栈顶开启括号严格配对
      const expected = ch === "]" ? "[" : "{";
      if (stack.pop() !== expected) return false;
    }
  }
  return stack.length === 0;
}

/**
 * 读取指定键的值（行级解析，支持无空格 `key:value`）
 *
 * 供 07 图片模块读取 Typora 专有属性（typora-root-url/typora-copy-images-to）。
 * @param fm front matter 内文（不含定界符）
 * @param key 目标键名（非空字符串）
 * @returns 首个命中行的字符串值；不存在返回 undefined
 */
export function readFrontMatterKey(fm: string, key: string): string | undefined {
  for (const rawLine of fm.split(/\r?\n/)) {
    const m = /^([\w-]+)\s*:\s*(.*)$/.exec(rawLine.trim());
    // 非键值行（空行/注释行）跳过
    if (!m) continue;
    // 命中目标键即返回（首个匹配优先）
    if (m[1] === key) return m[2].trim();
  }
  return undefined;
}
