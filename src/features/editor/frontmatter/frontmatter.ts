// YAML Front Matter 处理（E11）
//
// 策略（已锁定）：加载时剥离存内存、保存/导出回写，不进文档树。
// 与 E10 水平线 `---` 的歧义按「文档第一个块」判定（AC-E11-3）。
// Typora 专有属性白名单（typora-root-url/typora-copy-images-to）供 07 图片模块读取。
//
// 纯函数模块：无状态、无外部依赖，线程安全（每次调用独立计算）。
/** 文首 front matter 定界符 */
const FM_DELIMITER = "---";
/**
 * 首块正则：文档开头即 --- 且后续存在闭合 ---。
 * 两个分支：①「内文 + 换行」+ 闭合定界符（常规形态，捕获组 1 为内文）；
 * ②「空内文」+ 闭合定界符（空 front matter `---\n---\n`，FIX-11，捕获组 2 为空串）。
 * 闭合定界符必须独立成行（前随换行或紧跟开定界符换行），`---\ntitle: a---\n`
 * 这类闭合不独立成行的形态不匹配（分支①要求内文以换行收尾，分支②要求内文为空）。
 * 内文 `[\s\S]*?` 原样保留（CRLF 不归一，回写时按 FIX-9 逻辑统一定界符风格）。
 */
const FRONT_MATTER_RE = /^---\r?\n(?:([\s\S]*?)\r?\n|())---(?:\r?\n|$)/;

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
  // 分支①内文在捕获组 1；分支②（空 front matter）捕获组 1 为 undefined，统一取空串
  const inner = match[1] ?? "";
  if (!isValidFrontMatter(inner)) {
    // 非法 YAML：不剥离、按原文保留并告警（AC-E11-4）。
    // P1-10：告警不输出内文内容——FM 可含 api_key 类敏感键值（AGENTS.md §8.2
    // 日志禁止输出敏感信息）；修复前 inner.slice(0, 80) 把文档内容片段写入日志
    console.warn("[MarkWell] 文首 front matter YAML 非法，按原文保留");
    return { frontMatter: null, body: md };
  }
  return { frontMatter: inner, body: md.slice(match[0].length) };
}

/**
 * 回写 front matter（原样保留，不做 YAML 重序列化）
 *
 * 用于保存/导出时把内存暂存的 FM 内文拼回正文之前（AC-E11-2）。
 * 定界符换行风格随内文归一（FIX-9）：内文为 CRLF 的文档定界符用 CRLF，
 * 避免「定界符 LF + 内文 CRLF」的混行结尾偏离 AC-E11-2「原样回写」。
 * @param frontMatter 剥离时的 FM 内文（不含定界符）
 * @param body 编辑器正文
 * @returns 完整落盘文档
 */
export function reinsertFrontMatter(frontMatter: string, body: string): string {
  // 内文任意位置出现 CRLF 即整体采用 CRLF 定界符（内文保持剥离时的原样）
  const eol = frontMatter.includes("\r\n") ? "\r\n" : "\n";
  return `${FM_DELIMITER}${eol}${frontMatter}${eol}${FM_DELIMITER}${eol}${body}`;
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
