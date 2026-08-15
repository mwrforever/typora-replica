// E6 代码围栏：``` 创建 / js→javascript 别名高亮 / Ctrl+Shift+K 插入 / 语言切换落盘 / 未知语言降级
import { fireEvent } from "@testing-library/dom";
import { describe, expect, it } from "vitest";
import { makeTestEditor } from "../../test/editor-test-utils";
import { insertCodeFenceCommand } from "./keymaps";

/** 等待 CodeMirror 懒初始化完成：轮询宏任务直到 CM 编辑器挂载（语言异步加载由用例内 waitFor 兜底） */
async function waitForCodeBlock(te: Awaited<ReturnType<typeof makeTestEditor>>) {
  // IntersectionObserver 已桩化为恒可见（observe 时同步回调），CM 初始化随即触发；
  // 轮询兜底异步时序（懒 chunk 加载 / Vue 挂载渲染）
  for (let i = 0; i < 20; i++) {
    if (te.view.dom.querySelector(".milkdown-code-block .cm-editor")) {
      return te.view.dom.querySelector(".milkdown-code-block");
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  return te.view.dom.querySelector(".milkdown-code-block");
}

/** 轮询等待目标元素出现（CM 语言异步加载 / Vue 渲染时序），超时抛错而非静默失败 */
async function waitForElement(find: () => Element | null): Promise<Element> {
  for (let i = 0; i < 50; i++) {
    const el = find();
    if (el) return el;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error("waitForElement 超时：目标元素未出现");
}

describe("E6 代码围栏", () => {
  it("AC-E6-1 输入 ``` + Enter 创建代码围栏", async () => {
    const te = await makeTestEditor();
    te.insertText("```");
    te.press("Enter");
    expect(te.view.dom.querySelector("pre, .milkdown-code-block")).not.toBeNull();
    expect(te.getMarkdown()).toContain("```");
  });

  it("AC-E6-2 代码围栏语言名 js 按 JavaScript 高亮（别名映射 js→javascript）", async () => {
    const te = await makeTestEditor("```js\nconst a = 1;\n```");
    const block = await waitForCodeBlock(te);
    expect(block).not.toBeNull();
    // CodeMirror 按 JavaScript 语言解析（高亮 token 存在），无未知语言错误。
    // Crepe 默认 oneDark 主题为色值型高亮：token 使用 ͼ 前缀生成类名（而非 cm-keyword
    // 语义类），断言高亮 span 存在即证语言包解析成功；未识别语言块不产生任何 token span。
    // 语言包为异步加载（language-data 的 load() 懒 chunk），轮询等待 token 渲染
    const token = await waitForElement(
      () => block?.querySelector(".cm-content span[class^='ͼ']") ?? null,
    );
    expect(token).not.toBeNull();
  });

  it("AC-E6-3 光标在代码块内按 Ctrl+Shift+K 插入新代码围栏", async () => {
    const te = await makeTestEditor("```js\nconst a = 1;\n```");
    // 光标置于代码块内容中
    te.setSelection(6, 6);
    te.press("k", { ctrl: true, shift: true });

    const md = te.getMarkdown();
    expect(md).toContain("```js\nconst a = 1;\n```");
    // 文档中出现第二个代码围栏
    expect(md.match(/```/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("Ctrl+Shift+K 在普通段落中包裹当前块为代码围栏（非代码块分支）", async () => {
    const te = await makeTestEditor("plain text");
    te.setSelection(3, 3);
    te.press("k", { ctrl: true, shift: true });
    // 段落整体包裹为代码围栏（与内置 CreateCodeBlock 等价语义）
    expect(te.getMarkdown()).toContain("```\nplain text\n```");
  });

  it("AC-E6-4 切换代码块语言后高亮随之切换且落盘语言名正确", async () => {
    const te = await makeTestEditor("```\nbody { color: red; }\n```");
    await waitForCodeBlock(te);
    // 打开语言选择器（代码块右下角语言按钮，内置 DOM 类名为 language-button）
    const trigger = te.view.dom.querySelector(".milkdown-code-block .tools button.language-button");
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger!);
    // 搜索 css 并选中（搜索框绑定 input 事件，change 事件不触发 Vue 的 onInput）
    const searchInput = await waitForElement(() =>
      document.querySelector(".milkdown-code-block .language-picker input.search-input"),
    );
    fireEvent.input(searchInput, { target: { value: "css" } });
    // 语言选项 data-language 为 language-data 规范名（首字母大写 CSS）
    const option = await waitForElement(() =>
      document.querySelector(".milkdown-code-block li.language-list-item[data-language='CSS']"),
    );
    fireEvent.click(option);

    // 高亮随之切换：CSS 语言包异步加载并重配后产生高亮 token
    // （oneDark 色值型高亮，token 使用 ͼ 前缀生成类名；切换前无语言块不存在任何 token span）
    const token = await waitForElement(() =>
      document.querySelector(".milkdown-code-block .cm-content span[class^='ͼ']"),
    );
    expect(token).not.toBeNull();

    // 落盘断言：语言确已从未指定切换为 css，且为 Typora 平价的小写形态
    // （toMarkdown 归一化处理 language-data 规范名，AC 要求精确小写匹配）
    const md = te.getMarkdown();
    expect(md).not.toBe("```\nbody { color: red; }\n```");
    expect(md).toContain("```css");
  });

  it("AC-E6-5 不存在的语言名 foobar 按纯文本渲染不报错", async () => {
    const te = await makeTestEditor("```foobar\nplain text\n```");
    expect(() => te.view.dom.querySelector(".milkdown-code-block")).not.toThrow();
    const block = await waitForCodeBlock(te);
    expect(block).not.toBeNull();
    // 落盘保持原语言名，渲染不抛异常
    expect(te.getMarkdown()).toContain("```foobar");
  });
});

describe("insertCodeFenceCommand dry-run（dispatch 缺省）", () => {
  it("光标在代码块内：返回 true 且文档不变异", async () => {
    const te = await makeTestEditor("```js\nconst a = 1;\n```");
    te.setSelection(6, 6);
    const before = te.getMarkdown();
    // 键位链恒传 dispatch，dry-run 分支仅能经直调显式覆盖
    const command = insertCodeFenceCommand(te.editor.action((ctx) => ctx));
    expect(command(te.view.state, undefined, te.view)).toBe(true);
    expect(te.getMarkdown()).toBe(before);
  });

  it("光标在普通段落：返回 true 且文档不变异", async () => {
    const te = await makeTestEditor("plain text");
    te.setSelection(3, 3);
    const before = te.getMarkdown();
    const command = insertCodeFenceCommand(te.editor.action((ctx) => ctx));
    expect(command(te.view.state, undefined, te.view)).toBe(true);
    expect(te.getMarkdown()).toBe(before);
  });
});
