// E19 行内数学：$...$ 渲染 / Pandoc 三条规则 / 转义保护 / ESC 不破坏公式
//
// 与 Typora 的行为差异（PR 说明需注明）：Crepe 行内数学为 WYSIWYG 实时渲染，
// 不存在 Typora 的「源码 ↔ 预览」双态，ESC 无独立预览态可切换；AC-E19-5 的
// 验收意图落为「ESC 不破坏公式、文档内容不变」。若需完整复刻 Typora 双态交互，
// 另立任务（超首版范围）。
import { describe, expect, it } from "vitest";
import { makeTestEditor } from "../../test/editor-test-utils";

describe("E19 行内数学", () => {
  it("AC-E19-1 输入 $x^2$ 渲染为行内公式", async () => {
    const te = await makeTestEditor();
    te.insertText("$x^2$");
    expect(te.view.dom.querySelector(".katex")).not.toBeNull();
  });

  it("AC-E19-2 $x$2（闭 $ 后紧跟数字）不渲染为公式", async () => {
    const te = await makeTestEditor();
    te.insertText("$x$2");
    expect(te.view.dom.querySelector(".katex")).toBeNull();
    // 文档内保持字面文本 $x$2（AC 意图：闭 $ 后紧跟数字不成立式、内容不变）
    expect(te.view.state.doc.textContent).toBe("$x$2");
    // 实测口径（brief 允许以实测为准）：mdast-util-math 把 phrasing 中的字面 `$`
    // 一律转义为 \$ 落盘——remark-math 解析侧无 Pandoc 数字规则，若不转义，
    // 重新打开时 `$x$2` 会解析回公式再次渲染，转义是往返（保存→重开）一致性的唯一形态
    expect(te.getMarkdown()).toBe("\\$x\\$2");
  });

  it("AC-E19-3 $ x$（开 $ 后带空格）不渲染为公式", async () => {
    const te = await makeTestEditor();
    te.insertText("$ x$");
    expect(te.view.dom.querySelector(".katex")).toBeNull();
  });

  it("AC-E19-4 \\$ 转义符保持字面 $ 不进入公式态", async () => {
    const te = await makeTestEditor();
    te.insertText("\\$x$");
    // 转义后的 $ 是字面量：文档中不产生公式渲染
    expect(te.view.dom.querySelector(".katex")).toBeNull();
  });

  it("AC-E19-5 行内公式按 ESC 保持渲染且文档不受破坏", async () => {
    const te = await makeTestEditor("$x^2$");
    // 光标置于公式内按 ESC
    te.setSelection(2, 2);
    expect(() => te.press("Escape")).not.toThrow();
    // Crepe 行内数学为实时渲染（无 Typora 的源码/预览双态）：
    // ESC 的验收意图 = 不破坏公式状态、文档内容不变
    expect(te.view.dom.querySelector(".katex")).not.toBeNull();
    expect(te.getMarkdown()).toBe("$x^2$");
  });
});
