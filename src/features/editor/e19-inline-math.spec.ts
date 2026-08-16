// E19 行内数学：$...$ 渲染 / Pandoc 三条规则 / 转义保护 / ESC 退出编辑态
//
// AC-E19-5 严格实现（2026-08-16 用户裁决）：点击公式进入编辑浮层（Crepe latex
// feature 内嵌 CodeMirror），ESC 取消编辑（不应用修改）回 KaTeX 预览态——
// 由 latex-escape.ts 的 document 级监听接管（浮层挂载于 body，按键不冒泡到
// 主编辑器）。非编辑态按 ESC 保持公式渲染、文档内容不变（原降格语义保留）。
import { describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/dom";
import { NodeSelection } from "@milkdown/kit/prose/state";
import { setupLatexEscape } from "./latex-escape";
import { makeTestEditor, type TestEditor } from "../../test/editor-test-utils";

/** 编辑浮层（latex 内联编辑挂载于 body；隐藏态容器仍存在，innerView 已销毁） */
function latexEditTooltip(): HTMLElement | null {
  return document.querySelector(".milkdown-latex-inline-edit");
}

/** 浮层是否处于打开态（dataset.show=true 且内嵌编辑视图存活） */
function isLatexEditingOpen(): boolean {
  const floating = latexEditTooltip();
  if (!floating) return false;
  return floating.dataset.show === "true" && !!floating.querySelector(".ProseMirror");
}

/** 定位文档中首个 math_inline 节点位置（无节点返回 -1） */
function firstMathInlinePos(te: TestEditor): number {
  let pos = -1;
  te.view.state.doc.descendants((node, nodePos) => {
    if (node.type.name === "math_inline") {
      pos = nodePos;
      return false;
    }
    return true;
  });
  return pos;
}

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

  it("AC-E19-5 严格实现：编辑浮层聚焦时按 ESC 取消编辑回预览态", async () => {
    const te = await makeTestEditor("$x^2$");
    // 选中公式节点（NodeSelection）→ latex 编辑浮层打开（内嵌 CodeMirror 编辑源码）
    const pos = firstMathInlinePos(te);
    expect(pos).toBeGreaterThan(0);
    te.view.dispatch(te.view.state.tr.setSelection(NodeSelection.create(te.view.state.doc, pos)));
    await new Promise((r) => setTimeout(r, 0)); // tooltip provider 经 debounce(0) 异步弹出
    expect(isLatexEditingOpen()).toBe(true);
    // 模拟焦点在浮层内（编辑中）：ESC 应取消编辑（不应用修改）并收起浮层。
    // 聚焦内嵌编辑视图（contenteditable，jsdom 下仅可聚焦元素会更新 activeElement）
    (latexEditTooltip()!.querySelector(".ProseMirror") as HTMLElement | null)?.focus();
    expect(document.activeElement).not.toBe(document.body); // 焦点确认已进入浮层
    fireEvent.keyDown(document, { key: "Escape" });
    await new Promise((r) => setTimeout(r, 0)); // provider update 经 debounce(0) 异步收起
    // 浮层关闭（innerView 销毁，.cm-editor 移除）、选择不再是公式节点、文档未被修改
    expect(isLatexEditingOpen()).toBe(false);
    expect(te.view.state.selection).not.toBeInstanceOf(NodeSelection);
    expect(te.getMarkdown()).toBe("$x^2$");
    // 公式仍处于 KaTeX 预览态
    expect(te.view.dom.querySelector(".katex")).not.toBeNull();
  });

  it("AC-E19-5 非编辑态按 ESC 保持公式渲染且文档不受破坏", async () => {
    const te = await makeTestEditor("$x^2$");
    // 光标置于公式内（普通文本选择，无编辑浮层）按 ESC
    te.setSelection(2, 2);
    expect(isLatexEditingOpen()).toBe(false);
    expect(() => te.press("Escape")).not.toThrow();
    // 未接管场景：公式渲染与文档内容均不变
    expect(te.view.dom.querySelector(".katex")).not.toBeNull();
    expect(te.getMarkdown()).toBe("$x^2$");
  });

  it("AC-E19-5 浮层打开但焦点不在浮层内：ESC 不接管（保持编辑态）", async () => {
    const te = await makeTestEditor("$x^2$");
    const pos = firstMathInlinePos(te);
    te.view.dispatch(te.view.state.tr.setSelection(NodeSelection.create(te.view.state.doc, pos)));
    await new Promise((r) => setTimeout(r, 0));
    expect(isLatexEditingOpen()).toBe(true);
    // 焦点留在编辑器内（浮层开着但未聚焦）：ESC 不得取消编辑——浮层保持、选择不变
    fireEvent.keyDown(document, { key: "Escape" });
    await new Promise((r) => setTimeout(r, 0));
    expect(isLatexEditingOpen()).toBe(true);
    expect(te.view.state.selection).toBeInstanceOf(NodeSelection);
    expect(te.getMarkdown()).toBe("$x^2$");
  });

  it("AC-E19-5 非 Escape 键不触发取消编辑（接管条件收窄）", async () => {
    const te = await makeTestEditor("$x^2$");
    const pos = firstMathInlinePos(te);
    te.view.dispatch(te.view.state.tr.setSelection(NodeSelection.create(te.view.state.doc, pos)));
    await new Promise((r) => setTimeout(r, 0));
    (latexEditTooltip()!.querySelector(".ProseMirror") as HTMLElement | null)?.focus();
    // 浮层内按普通字符键：不接管、浮层保持打开
    fireEvent.keyDown(document, { key: "a" });
    await new Promise((r) => setTimeout(r, 0));
    expect(isLatexEditingOpen()).toBe(true);
    expect(te.view.state.selection).toBeInstanceOf(NodeSelection);
  });

  it("setupLatexEscape 视图访问器为空（销毁竞态）时 ESC 不崩溃", () => {
    // 直接单测 handler：浮层聚焦但 getView 返回 undefined（编辑器销毁竞态）——
    // ESC 必须安全短路（line 36 防御分支）
    const floating = document.createElement("div");
    floating.className = "milkdown-latex-inline-edit";
    const inner = document.createElement("div");
    inner.setAttribute("contenteditable", "true");
    floating.appendChild(inner);
    document.body.appendChild(floating);
    inner.focus();
    const cleanup = setupLatexEscape(() => undefined);
    expect(() => fireEvent.keyDown(document, { key: "Escape" })).not.toThrow();
    cleanup();
    floating.remove();
  });
});
