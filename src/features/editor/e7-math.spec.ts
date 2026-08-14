// E7 数学块：$$ 创建 / Ctrl+Enter 退出编辑态 / mhchem 化学式 / \def 自定义命令 / 非法 TeX 降级
//
// 预期全部内置（无产品代码改动）：Crepe latex feature 的 $$ 输入规则创建
// language=LaTeX 的代码块（编辑容器为 .milkdown-code-block，复用 CodeMirror 组件），
// 预览面板经 codeBlockConfig.renderPreview 调用 KaTeX 实时渲染（throwOnError:false），
// mhchem 由 create-editor.ts 副作用导入（测试助手同源引用，测试环境已加载）。
import { describe, expect, it } from "vitest";
import { makeTestEditor } from "../../test/editor-test-utils";

/** 轮询等待目标元素出现（CodeMirror 懒初始化 / Vue 异步渲染时序），超时抛错而非静默失败 */
async function waitForElement(find: () => Element | null): Promise<Element> {
  for (let i = 0; i < 100; i++) {
    const el = find();
    if (el) return el;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error("waitForElement 超时：目标元素未出现");
}

/**
 * 输入 $$ + Enter 创建数学块并等待编辑容器就绪，返回块容器元素
 *
 * 数学块 = language 为 LaTeX 的代码块（Crepe latex feature 内置 $$ 输入规则），
 * 编辑容器为 .milkdown-code-block（E6 同款组件），CodeMirror 编辑区挂载后 .cm-editor 出现
 * @param te 测试编辑器实例
 */
async function createMathBlock(te: Awaited<ReturnType<typeof makeTestEditor>>) {
  te.insertText("$$");
  te.press("Enter");
  await waitForElement(() => te.view.dom.querySelector(".milkdown-code-block .cm-editor"));
  return te.view.dom.querySelector(".milkdown-code-block");
}

/**
 * 在数学块内输入内容并按 Ctrl+Enter 退出编辑态，返回预览面板容器
 *
 * 预览面板（.preview-panel .preview）由 KaTeX 实时渲染：
 * 有效 TeX 产生 .katex-display，非法 TeX 降级为 .katex-error（throwOnError:false 不抛异常）。
 * 返回共同的 .preview 容器，各 AC 在其内断言具体结构。
 * @param te 测试编辑器实例
 * @param content 数学块内容（TeX 源码，可含反斜杠转义序列）
 */
async function renderMath(
  te: Awaited<ReturnType<typeof makeTestEditor>>,
  content: string,
): Promise<Element | null> {
  te.insertText(content);
  // Ctrl+Enter 对应内置 Mod-Enter（baseKeymap → exitCode）：选区退出代码块落至后继段落
  te.press("Enter", { ctrl: true });
  await waitForElement(() => te.view.dom.querySelector(".katex-display, .katex-error"));
  return te.view.dom.querySelector(".milkdown-code-block .preview");
}

describe("E7 数学块", () => {
  it("AC-E7-1 输入 $$ + Enter 创建数学块进入编辑态", async () => {
    const te = await makeTestEditor();
    const block = await createMathBlock(te);
    // 编辑容器出现（CodeMirror 编辑 UI 已挂载）
    expect(block).not.toBeNull();
    // 语言选择按钮显示 LaTeX：证明是数学块而非普通代码块
    expect(block?.querySelector(".tools .language-button")?.textContent).toContain("LaTeX");
    // 落盘形态为 $$ 围栏而非 ``` 代码围栏（latex 扩展序列化，E6 复审结论；
    // 内置 trailing 插件在块后补空段落，断言不绑定段落尾缀）
    expect(te.getMarkdown()).toContain("$$");
    expect(te.getMarkdown()).not.toContain("```");
  });

  it("AC-E7-2 数学块内输入 E=mc^2 按 Ctrl+Enter 退出编辑态并渲染公式", async () => {
    const te = await makeTestEditor();
    await createMathBlock(te);
    const rendered = await renderMath(te, "E=mc^2");
    expect(rendered).not.toBeNull();
    // 渲染出公式内容（KaTeX 输出 mord 结构，无 sup 标签也命中 .mord）
    expect(rendered?.textContent).toContain("E");
    expect(rendered?.querySelector("sup, .mord")).not.toBeNull();
    // Ctrl+Enter 退出编辑态：选区离开代码块落入后继段落（内置 baseKeymap Mod-Enter → exitCode）
    expect(te.view.state.selection.$from.parent.type.name).toBe("paragraph");
  });

  it("AC-E7-3 含 \\ce{H2O} 的内容正确渲染化学式（mhchem 已加载）", async () => {
    const te = await makeTestEditor();
    await createMathBlock(te);
    const rendered = await renderMath(te, "\\ce{H2O}");
    expect(rendered).not.toBeNull();
    // mhchem 渲染的化学式：KaTeX 输出 msub 结构（MathML 部分），且无解析错误
    expect(rendered?.querySelector("msub")).not.toBeNull();
    expect(rendered?.textContent).not.toContain("ParseError");
  });

  it("AC-E7-4 使用 \\def\\R 后输入 \\R 正确渲染自定义命令", async () => {
    const te = await makeTestEditor();
    await createMathBlock(te);
    const rendered = await renderMath(te, "\\def\\R{\\mathbb{R}}\\R");
    expect(rendered).not.toBeNull();
    // mathbb 渲染存在（KaTeX 原生支持 \def 宏定义）
    expect(rendered?.querySelector(".mathbb")).not.toBeNull();
  });

  it("AC-E7-5 非法 TeX 输入不崩溃、显示错误提示而非空白", async () => {
    const te = await makeTestEditor();
    await createMathBlock(te);
    const rendered = await renderMath(te, "\\frac{1}{");
    expect(rendered).not.toBeNull();
    // KaTeX throwOnError: false → 渲染错误标注而非抛异常（Crepe latex 已配置）
    expect(rendered?.querySelector(".katex-error")).not.toBeNull();
  });
});
