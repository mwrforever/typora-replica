// 自定义语法规则单测：行尾两空格硬换行命令分支全覆盖 + 嵌套引用输入规则正则边界 + setext 二级标题规则
// （核心语法转换 100% 覆盖）
import { describe, expect, it, vi } from "vitest";
import type { Transaction } from "@milkdown/kit/prose/state";
import { makeTestEditor } from "../../test/editor-test-utils";
import {
  NESTED_BLOCKQUOTE_INPUT_PATTERN,
  SETEXT_H2_INPUT_PATTERN,
  trailingSpacesHardBreakCommand,
} from "./input-rules";

/** 在空文档光标处字面插入带行尾两空格的文本（经事务直插保证两空格字面落位，不经过输入规则链） */
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

describe("NESTED_BLOCKQUOTE_INPUT_PATTERN 嵌套引用输入规则正则边界", () => {
  it("命中：行首 `>> ` 触发嵌套引用输入规则", () => {
    expect(NESTED_BLOCKQUOTE_INPUT_PATTERN.exec(">> ")?.[0]).toBe(">> ");
  });

  it("命中：行首空白后的 `>> ` 同样触发（正则 ^\\s* 前缀）", () => {
    expect(NESTED_BLOCKQUOTE_INPUT_PATTERN.exec("  >> ")?.[0]).toBe("  >> ");
  });

  it("未命中：单层 `> ` 由内置引用规则处理（两规则互斥，不冲突）", () => {
    expect(NESTED_BLOCKQUOTE_INPUT_PATTERN.exec("> ")).toBeNull();
  });

  it("未命中：`>>` 无尾随空格（空格是触发字符）", () => {
    expect(NESTED_BLOCKQUOTE_INPUT_PATTERN.exec(">>")).toBeNull();
  });

  it("未命中：`>>> ` 三连引用（正则要求恰好两个 `>`，多级形态不在 AC 范围）", () => {
    expect(NESTED_BLOCKQUOTE_INPUT_PATTERN.exec(">>> ")).toBeNull();
  });

  it("未命中：普通文本", () => {
    expect(NESTED_BLOCKQUOTE_INPUT_PATTERN.exec("普通文本")).toBeNull();
  });
});

describe("createNestedBlockquoteInputRule 包裹与合并行为", () => {
  it("顶层段落行首 `>> ` 包裹为单级引用（前置节点不存在，走 before 为空分支）", async () => {
    const te = await makeTestEditor();
    te.insertText(">>");
    te.insertText(" "); // 空格触发规则：包裹当前段落
    te.insertText("顶层引用");

    // 首节点为引用块且内容正确，无嵌套（单级）
    expect(te.view.state.doc.child(0).type.name).toBe("blockquote");
    expect(te.view.state.doc.child(0).textContent).toBe("顶层引用");
    expect(te.getMarkdown()).toContain("> 顶层引用");
  });

  it("紧邻引用块后的段落触发 `>> ` 与前一引用块合并（join 分支）", async () => {
    const te = await makeTestEditor();
    te.insertText("> 已有引用");
    te.press("Enter"); // 引用内空行
    te.press("Enter"); // 退出引用块，得到普通段落
    te.insertText(">>");
    te.insertText(" "); // 空格触发规则：包裹当前段落并与前置引用块合并
    te.insertText("并入行");

    // 合并结果：整个文档仅一个引用块，两段文本同处其中
    const blockquotes: string[] = [];
    te.view.state.doc.descendants((n) => {
      if (n.type.name === "blockquote") blockquotes.push(n.textContent);
    });
    expect(blockquotes).toHaveLength(1);
    expect(blockquotes[0]).toContain("已有引用");
    expect(blockquotes[0]).toContain("并入行");
    expect(te.getMarkdown()).toContain("> 并入行");
  });
});

describe("SETEXT_H2_INPUT_PATTERN setext 二级标题触发正则边界", () => {
  it("命中：行首恰好 `---`（三个连字符，无尾随空白）", () => {
    expect(SETEXT_H2_INPUT_PATTERN.exec("---")?.[0]).toBe("---");
  });

  it("未命中：`--` 两个连字符（未到触发长度）", () => {
    expect(SETEXT_H2_INPUT_PATTERN.exec("--")).toBeNull();
  });

  it("未命中：`----` 四个连字符（与内置 hr 规则一致，均不处理）", () => {
    expect(SETEXT_H2_INPUT_PATTERN.exec("----")).toBeNull();
  });

  it("未命中：`--- ` 带尾随空格（空格不是本规则触发字符）", () => {
    expect(SETEXT_H2_INPUT_PATTERN.exec("--- ")).toBeNull();
  });
});

describe("createSetextH2InputRule 非空行后 `---` setext 转换分支", () => {
  it("转换：非空段落后的 `---` 使前置段落转为二级标题且不产生水平线", async () => {
    const te = await makeTestEditor();
    te.insertText("前面有文字");
    te.press("Enter");
    te.insertText("---");

    // 前置段落整体转为 h2（level 2），触发段落（含 `---`）被消费删除
    expect(te.view.state.doc.childCount).toBe(1);
    expect(te.view.state.doc.child(0).type.name).toBe("heading");
    expect(te.view.state.doc.child(0).attrs.level).toBe(2);
    expect(te.view.state.doc.child(0).textContent).toBe("前面有文字");
    expect(te.view.dom.querySelector("hr")).toBeNull();
  });

  it("回落：空文档中 `---` 无前置块，仍由内置规则生成水平线", async () => {
    const te = await makeTestEditor();
    te.insertText("---");
    expect(te.view.dom.querySelector("hr")).not.toBeNull();
  });

  it("回落：前置块为空段落（空行分隔）时 `---` 生成水平线", async () => {
    const te = await makeTestEditor();
    te.insertText("前面有文字");
    te.press("Enter");
    te.press("Enter"); // 再换行得到空前置段落（setext 要求无空行分隔）
    te.insertText("---");
    expect(te.view.dom.querySelector("hr")).not.toBeNull();
  });

  it("回落：前置块为标题（非纯段落）时 `---` 生成水平线", async () => {
    const te = await makeTestEditor();
    te.insertText("# 标题");
    te.press("Enter");
    te.insertText("---");
    expect(te.view.dom.querySelector("hr")).not.toBeNull();
  });
});
