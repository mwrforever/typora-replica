// Crepe 工厂：统一组装 featureConfigs 与 keymap 注册注入点（10 模块扩展入口）
import { Crepe, type CrepeConfig } from "@milkdown/crepe";
import type { Ctx } from "@milkdown/kit/ctx";
import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import type { Handlers } from "mdast-util-to-markdown";
import type { Options } from "remark-stringify";
// mhchem 副作用导入：KaTeX 化学式扩展（E7），全应用只需一次
import "katex/contrib/mhchem";
import { configureFootnoteTooltip, footnoteTooltipPlugin } from "./footnote-tooltip";
import { registerEditorInputRules } from "./input-rules";
import { applyEditorKeymaps } from "./keymaps";

/** CommonMark Unicode 标点判断（`_` 本身属 Pc 类别，同样命中） */
const UNICODE_PUNCT_RE = /^\p{P}$/u;
/** CommonMark 空白判断 */
const UNICODE_WS_RE = /^\s$/u;

const isUnicodePunct = (ch: string | undefined): boolean =>
  ch !== undefined && UNICODE_PUNCT_RE.test(ch);
const isUnicodeWhitespace = (ch: string | undefined): boolean =>
  ch !== undefined && UNICODE_WS_RE.test(ch);

/** 单词内下划线的临时占位（私有区字符，safe() 的转义表不会命中） */
const UNDERSCORE_SENTINEL = "\uE000";

/**
 * Typora 式 text 序列化处理器：GFM 单词内下划线不转义 + 硬换行尾随空白保护
 *
 * mdast-util-to-markdown 默认对 phrasing 中所有 `_` 一律反斜杠转义
 * （wow_great_stuff → wow\_great\_stuff），而 CommonMark/GFM 规定单词内下划线
 * 不构成强调（Typora 落盘亦不转义）。本处理器仅在 `_` 可能充当强调开/闭标记
 * （满足左/右 flanking 条件）时保留默认转义；可证明惰性的单词内下划线以私有区
 * 字符暂代、safe() 处理后还原，其余文本一律交 safe() 处理，不得绕过转义链
 * （绕过会导致反引号/`&`/方括号等重新解析时改变结构）。
 *
 * 唯一例外：safe() 会把换行前最后一个尾随空格编码为 &#x20;（unsafe 规则
 * {character: ' ', after: '[\r\n]'}），破坏 CommonMark 硬换行语法
 * （行尾两空格 + 换行，AC-E1-3 依赖）。仅当原文以两个及以上空白字符结尾的
 * 窄场景把编码还原为原始空白字符，其余输出与 safe() 完全一致。
 */
const gfmUnderscoreTextHandler: Handlers["text"] = (node, _, state, info) => {
  const value = node.value;
  // 逐字符扫描：仅对可能形成强调的 `_` 保留默认转义，惰性下划线以哨兵暂代
  let protectedValue = "";
  const chars = Array.from<string>(value);
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== "_") {
      protectedValue += chars[i];
      continue;
    }
    // 节点边缘借用序列化上下文（containerPhrasing 传入）还原相邻字符；
    // 上下文缺省按 safe() 的 `|| ""` 语义视为行首/行尾
    const prevChar: string | undefined =
      i > 0 ? chars[i - 1] : info.before ? info.before.slice(-1) : undefined;
    const nextChar: string | undefined =
      i < chars.length - 1 ? chars[i + 1] : info.after ? info.after.charAt(0) : undefined;
    // 左 flanking：可开启强调（前为行首/空白/标点，后为非空白）
    const canOpen =
      (prevChar === undefined || isUnicodeWhitespace(prevChar) || isUnicodePunct(prevChar)) &&
      nextChar !== undefined &&
      !isUnicodeWhitespace(nextChar);
    // 右 flanking：可闭合强调（前为非空白，后为行尾/空白/标点）
    const canClose =
      prevChar !== undefined &&
      !isUnicodeWhitespace(prevChar) &&
      (nextChar === undefined || isUnicodeWhitespace(nextChar) || isUnicodePunct(nextChar));
    protectedValue += canOpen || canClose ? "_" : UNDERSCORE_SENTINEL;
  }
  const out = state.safe(protectedValue, info);
  // 硬换行保护：safe() 的 unsafe 规则 {character: ' ', after: '[\r\n]'}
  // （mdast-util-to-markdown/lib/unsafe.js）会把换行前最后一个尾随空格编码为 &#x20;，
  // 破坏 CommonMark 硬换行语法「行尾两空格 + 换行」（AC-E1-3 落盘断言依赖）。
  // 仅当原文以两个及以上空白字符结尾（硬换行语法载体）、后续序列化上下文以换行开头、
  // 且 safe() 确实把最后一个空白编码为字符引用时，才把该编码还原为原始空白字符。
  // 单个尾随空格不在还原范围（CommonMark 解析会剥离行尾单空格，保留 &#x20; 编码
  // 才能往返不丢字符）；其余字符（反引号/`&`/方括号等）仍完整经过 safe 转义链。
  const after = String(info.after ?? "");
  let hardBreakPreserved = out;
  if (/[ \t]{2}$/.test(protectedValue) && /^[\r\n]/.test(after) && /&(?:#x20|#x9);$/.test(out)) {
    // 还原被编码的最后一个空白为原始空白字符（空格还原空格、制表符还原制表符）
    hardBreakPreserved = out.replace(/&(?:#x20|#x9);$/, protectedValue.slice(-1));
  }
  return hardBreakPreserved.split(UNDERSCORE_SENTINEL).join("_");
};

/** Typora 式序列化 handlers 增量（覆盖内置 text 处理器） */
export const markwellRemarkHandlers: NonNullable<Required<Options>["handlers"]> = {
  text: gfmUnderscoreTextHandler,
};

/**
 * 注入 Typora 式序列化选项（产品工厂与测试助手同源调用，避免两处配置漂移）
 * @param ctx milkdown 配置上下文（create() 前 config 阶段调用）
 */
export function applyMarkwellStringifyOptions(ctx: Ctx): void {
  ctx.update(remarkStringifyOptionsCtx, (prev) => ({
    ...prev,
    // Typora 落盘形态：无序列表序列化为 `- `（Crepe 默认 `*`，与 Typora 文档不兼容）
    bullet: "-" as const,
    // 覆盖内置 text 处理器：GFM 单词内下划线不转义（Typora 落盘形态）
    handlers: { ...prev.handlers, ...markwellRemarkHandlers },
  }));
}

/**
 * 代码围栏语言落盘小写归一化（Typora 平价，E6-4）
 *
 * 内置语言选择器把 language-data 规范名（首字母大写，如 CSS/JavaScript）写入节点
 * language 属性，落盘形态 ```CSS 与 Typora 的小写 ```css 不一致。以 extendSchema 扩展
 * codeBlockSchema 的 toMarkdown（与 Crepe latex feature 的 blockLatexSchema 同模式），
 * 仅序列化时把 language 小写输出；解析/高亮不受影响——parseMarkdown 保持原样，
 * LanguageLoader 对语言名小写不敏感（审查已核实 loader 按小写别名建映射）。
 */
export const lowerLanguageCodeBlockSchema = codeBlockSchema.extendSchema((prev) => {
  return (ctx) => {
    const baseSchema = prev(ctx);
    return {
      ...baseSchema,
      toMarkdown: {
        match: baseSchema.toMarkdown.match,
        runner: (state, node) => {
          // language 属性小写后落盘。attrs.language 恒为字符串（ProseMirror computeAttrs
          // 对缺省值填充 schema 默认值 ""，parseDOM 的 undefined 同样被归一），无需空值兜底
          const language = String(node.attrs.language).toLowerCase();
          // latex 数学块：保持 $$...$$ 落盘形态（复刻 latex feature 的 blockLatexSchema
          // runner 语义）。注意：extendSchema 的 prev 恒为原始 schema 而非 latex 扩展
          // （实测委托 baseSchema.runner 输出 ```LaTeX 围栏而非 $$）——本扩展与 latex 扩展
          // 同 id（code_block）经 upsertById 原地替换，本扩展最后注册成为生效 schema，
          // latex 的 toMarkdown 分支必须在此直接实现，否则数学块重载后解析回普通代码块
          if (language === "latex") {
            state.addNode("math", void 0, node.content.firstChild?.text || "");
            return;
          }
          // 其余语言：复刻 base 默认 addNode 行为 + language 小写归一化（Typora 平价）
          state.addNode("code", void 0, node.content.firstChild?.text || "", {
            lang: language,
          });
        },
      },
    };
  };
});

/** 编辑器工厂可选配置 */
export interface MarkwellEditorOptions {
  /** 图片上传回调（07 图片模块注入实现；缺省时 Crepe 自动回落 blob URL） */
  onUpload?: (file: File) => Promise<string>;
  /** 附加 Crepe 配置（keymap/插件注入点，10 设置快捷键模块使用） */
  crepeConfig?: CrepeConfig;
}

/**
 * 创建 MarkWell 编辑器实例（Crepe 7.22.1）
 * 注意：仅构造，调用方需自行 create()（@milkdown/vue 集成层会自动 create）
 * @param root 编辑器挂载根元素（由 @milkdown/vue 集成层传入）
 * @param defaultValue 初始文档内容
 * @param options 可选配置
 */
export function createMarkwellEditor(
  root: HTMLElement,
  defaultValue: string,
  options: MarkwellEditorOptions = {},
): Crepe {
  const crepe = new Crepe({
    root,
    defaultValue,
    // 默认 features 除 TopBar/AI 外全开（与 Typora 无菜单栏编辑器形态一致）
    ...options.crepeConfig,
    featureConfigs: {
      ...(options.crepeConfig?.featureConfigs ?? {}),
      ...(options.onUpload ? { [Crepe.Feature.ImageBlock]: { onUpload: options.onUpload } } : {}),
    },
  });
  // 代码围栏语言落盘小写归一化：以 extendSchema 扩展 codeBlockSchema（E6-4 Typora 平价）
  crepe.editor.use(lowerLanguageCodeBlockSchema);
  // 脚注悬停预览浮层（E9 AC-E9-2）：tooltipFactory 形态插件 + config 阶段注入规格
  crepe.editor.use(footnoteTooltipPlugin);
  // 自定义语法规则注入：config 回调在 create() 时执行，与内置规则统一编排
  crepe.editor.config((ctx) => {
    registerEditorInputRules(ctx);
    // Typora 式 keymap 注入（Ctrl+[ 缩进 / Ctrl+] 反向配对，10 设置快捷键模块扩展入口）
    applyEditorKeymaps(ctx);
    // 脚注悬停预览浮层规格（handleDOMEvents + PluginView）注入
    configureFootnoteTooltip(ctx);
    // Typora 式落盘序列化选项（列表 `- ` 前缀、GFM 单词内下划线不转义）
    applyMarkwellStringifyOptions(ctx);
  });
  return crepe;
}
