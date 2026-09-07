// 导出 HTML 序列化产物后处理（09 X1 管线三类：图表 / 数学块 / [toc]）
//
// 操作对象是 DOMSerializer 产出的**独立 DOM 副本**（非编辑器 DOM，宪法 B.2.5 合规）。
// 渲染器经 hooks 注入：测试用桩，生产由 mermaid-export.ts / katex 封装提供。
// plainMode（AC-X3-1）：包装 div 不携带 mw-* 类——HTML 无样式导出「无包裹类」语义。
// math_inline 无需处理——其 toDOM 序列化时已内联 KaTeX HTML（crepe latex 实证）。
//
// 围栏形态契约（批2 R1 实证）：preset-commonmark fence toDOM 把 data-language 挂在
// **pre** 上（`<pre data-language="mermaid"><code>…</code></pre>`，lib/index.js:811-816），
// 旧形态挂 code（历史产物）——双选择器互斥收集做向后兼容，形态契约回归用例见 spec，
// 防序列化器变更再静默断裂（旧选择器失配即静默空转，无任何报错）。
/** 后处理渲染钩子（渲染能力注入面） */
export interface PostProcessHooks {
  /** mermaid 源码 → SVG 字符串（异步） */
  renderMermaid: (code: string) => Promise<string>;
  /** LaTeX 数学块源码 → KaTeX HTML（throwOnError:false 语义由实现方保证） */
  renderMathBlock: (code: string) => string;
  /** 大纲 HTML（[toc] 替换内容）；undefined = 无大纲（[toc] 替换为空占位） */
  outlineHtml?: string;
  /** 无样式模式：包装 div 不带 mw-* 类（AC-X3-1） */
  plainMode?: boolean;
}

/** 围栏替换候选（双形态收集产物；pre 为待替换围栏元素，language 已小写归一） */
interface FenceCandidate {
  /** 待整体替换的 pre 围栏元素 */
  pre: Element;
  /** 围栏语言（data-language 小写归一） */
  language: string;
  /** 围栏内文（code 子元素文本，缺 code 时整段 textContent 兜底） */
  text: string;
}

/**
 * 对序列化产物根元素执行全部后处理（原地修改副本）
 *
 * 处理项：
 * 1. `pre[data-language=mermaid]` / 旧形态 `pre>code[data-language=mermaid]`（大小写不敏感）
 *    → div（mw-mermaid/plain 无类）内嵌 SVG；
 * 2. latex 同形态 → div（mw-math-block/plain 无类）内嵌 KaTeX HTML；
 * 3. `div[data-node-type=toc]` → 大纲内容替换并剥离自定义属性。
 * @param root 序列化产物根元素（副本）
 * @param hooks 渲染钩子
 */
export async function postProcessExportHtml(
  root: HTMLElement,
  hooks: PostProcessHooks,
): Promise<void> {
  const wrapperClass = hooks.plainMode === true ? undefined : "mw-mermaid";
  const mathClass = hooks.plainMode === true ? undefined : "mw-math-block";
  for (const { pre, language, text } of collectFences(root)) {
    if (language === "mermaid") {
      const svg = await hooks.renderMermaid(text);
      replaceWithWrapper(pre, wrapperClass, svg);
    } else if (language === "latex") {
      replaceWithWrapper(pre, mathClass, hooks.renderMathBlock(text));
    }
  }
  // [toc] 节点替换（大纲内容；无大纲时以注释占位保持文档结构完整）
  for (const toc of Array.from(root.querySelectorAll('div[data-node-type="toc"]'))) {
    const replacement = document.createElement("div");
    if (hooks.plainMode !== true) replacement.className = "mw-export-toc";
    replacement.innerHTML = hooks.outlineHtml ?? "<!-- [toc] 无大纲内容 -->";
    toc.replaceWith(replacement);
  }
}

/** 双形态收集围栏候选（新形态 data-language 在 pre / 旧形态在 code；两选择器互斥不重叠） */
function collectFences(root: HTMLElement): FenceCandidate[] {
  const fences: FenceCandidate[] = [];
  for (const pre of Array.from(root.querySelectorAll("pre[data-language]"))) {
    // 选择器已约束 data-language 必在、textContent 对元素节点运行时恒为 string
    // （DOM lib 将 Node.textContent 宽松标注为可空）——非空断言消除不可达守卫分支
    fences.push({
      pre,
      language: pre.getAttribute("data-language")!.toLowerCase(),
      text: pre.querySelector("code")?.textContent ?? pre.textContent!,
    });
  }
  for (const code of Array.from(root.querySelectorAll("pre > code[data-language]"))) {
    // 旧形态：父节点由选择器约束为 pre，同以非空断言消除不可达守卫
    fences.push({
      pre: code.parentElement!,
      language: code.getAttribute("data-language")!.toLowerCase(),
      text: code.textContent!,
    });
  }
  return fences;
}

/** 用包装 div 替换目标元素（className 为 undefined 时输出无类 div——plain 语义） */
function replaceWithWrapper(
  target: Element,
  className: string | undefined,
  innerHtml: string,
): void {
  const wrapper = document.createElement("div");
  if (className !== undefined) wrapper.className = className;
  wrapper.innerHTML = innerHtml;
  target.replaceWith(wrapper);
}
