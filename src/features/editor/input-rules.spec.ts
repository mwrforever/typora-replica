// 自定义语法规则单测：行尾两空格硬换行命令分支全覆盖（核心语法转换 100% 覆盖）
import { describe, expect, it, vi } from "vitest";
import type { Transaction } from "@milkdown/kit/prose/state";
import { makeTestEditor } from "../../test/editor-test-utils";
import { trailingSpacesHardBreakCommand } from "./input-rules";

/** 在空文档光标处字面插入带行尾两空格的文本（绕过 markdown 解析的尾空格吞并） */
function typeTrailingSpaces(te: Awaited<ReturnType<typeof makeTestEditor>>): void {
  te.view.dispatch(te.view.state.tr.insertText("行一  ", te.view.state.selection.from));
}

/** 判断文档中是否存在 hardBreak 节点 */
function hasHardBreak(te: Awaited<ReturnType<typeof makeTestEditor>>): boolean {
  let found = false;
  te.view.state.doc.descendants((n) => {
    if (n.type.name === "hardbreak") {
      found = true;
      return false; // 找到即停止遍历
    }
  });
  return found;
}

describe("trailingSpacesHardBreakCommand 行尾两空格硬换行", () => {
  it("命中：行尾两空格后插入 hardBreak 节点且返回 true（段落不拆分）", async () => {
    const te = await makeTestEditor();
    typeTrailingSpaces(te);
    const dispatch = vi.fn((tr: Transaction) => te.view.dispatch(tr));
    const ok = trailingSpacesHardBreakCommand(te.view.state, dispatch);
    expect(ok).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(hasHardBreak(te)).toBe(true);
    // 两空格保留在 hardBreak 之前（Milkdown 序列化器丢弃段尾硬换行，行尾两空格是落盘载体）
    expect(te.view.state.doc.child(0).textContent).toBe("行一  \n");
    expect(te.view.state.doc.childCount).toBe(1);
  });

  it("dry-run：命中条件成立但无派发函数时返回 true 且不改文档", async () => {
    const te = await makeTestEditor();
    typeTrailingSpaces(te);
    const before = JSON.stringify(te.view.state.doc.toJSON());
    const ok = trailingSpacesHardBreakCommand(te.view.state);
    expect(ok).toBe(true);
    expect(JSON.stringify(te.view.state.doc.toJSON())).toBe(before);
  });

  it("未命中：光标前没有行尾两空格返回 false 且不派发", async () => {
    const te = await makeTestEditor("行一");
    te.setSelection(te.view.state.doc.content.size, te.view.state.doc.content.size); // 光标置于行尾
    const dispatch = vi.fn();
    const ok = trailingSpacesHardBreakCommand(te.view.state, dispatch);
    expect(ok).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("未命中：非空文本选区返回 false", async () => {
    const te = await makeTestEditor();
    typeTrailingSpaces(te);
    te.setSelection(1, 3); // 跨两字符的非空选区
    const ok = trailingSpacesHardBreakCommand(te.view.state, () => {});
    expect(ok).toBe(false);
  });

  it("未命中：文档级光标（父节点非文本块）返回 false", async () => {
    const te = await makeTestEditor("行一  ");
    te.setSelection(0, 0); // 深度 0 光标：父节点为 doc 而非文本块
    const ok = trailingSpacesHardBreakCommand(te.view.state, () => {});
    expect(ok).toBe(false);
  });
});
