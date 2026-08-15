// E1 段落与换行：Enter 拆段 / Shift+Enter 硬换行 / 行尾两空格兼容硬换行 / 连续 Enter 健壮性
import { describe, expect, it } from "vitest";
import { makeTestEditor } from "../../test/editor-test-utils";

describe("E1 段落与换行", () => {
  it("AC-E1-1 段中按 Enter 拆分为两个段落", async () => {
    const te = await makeTestEditor("第一段第二段");
    // 光标置于段中：全文 6 字符的第 3 字符后（「第一段」与「第二段」交界处），对应 AC 的「段中按 Enter」
    te.setSelection(3, 3);
    te.press("Enter");

    expect(te.view.state.doc.childCount).toBe(2);
    expect(te.view.state.doc.child(0).type.name).toBe("paragraph");
    expect(te.view.state.doc.child(1).type.name).toBe("paragraph");
    expect(te.view.dom.querySelectorAll("p")).toHaveLength(2);
  });

  it("AC-E1-2 按 Shift+Enter 产生硬换行（hardBreak 节点）", async () => {
    const te = await makeTestEditor("第一行第二行");
    te.setSelection(3, 3);
    te.press("Enter", { shift: true });

    // 段落不拆分，内部出现 hardBreak 节点（位于原光标处，即首个文本节点之后）
    expect(te.view.state.doc.childCount).toBe(1);
    let hasHardBreak = false;
    te.view.state.doc.descendants((n) => {
      if (n.type.name === "hardbreak") {
        hasHardBreak = true;
        return false; // 找到即停止遍历
      }
    });
    expect(hasHardBreak).toBe(true);
  });

  it("AC-E1-3 行尾两个空格后换行落盘为兼容性硬换行", async () => {
    const te = await makeTestEditor();
    // 字面键入行尾两个空格（经事务直插保证两空格字面落位，不经过 insertText 的输入规则链逐字模拟）
    te.view.dispatch(te.view.state.tr.insertText("行一  ", te.view.state.selection.from));
    te.press("Enter");

    // 落盘为硬换行（渲染为换行、序列化保留兼容语法）
    let hasHardBreak = false;
    te.view.state.doc.descendants((n) => {
      if (n.type.name === "hardbreak") {
        hasHardBreak = true;
        return false; // 找到即停止遍历
      }
    });
    expect(hasHardBreak).toBe(true);
    // 原始序列化：直接调 crepe.getMarkdown() 取原始输出（不经测试助手 getMarkdown 的尾部换行裁剪），
    // 行尾两空格 + 换行即兼容语法本体，段尾换行在此处是语义而非噪音
    const md = te.crepe.getMarkdown();
    // CommonMark 兼容序列化：行尾两空格或 <br/>，二者取一
    expect(md.includes("  \n") || md.includes("<br/>")).toBe(true);
  });

  it("AC-E1-4 文首空文档连续按 Enter 5 次不报错且段落数正确", async () => {
    const te = await makeTestEditor();
    expect(() => {
      for (let i = 0; i < 5; i++) te.press("Enter");
    }).not.toThrow();

    // 空文档初始 1 个空段落，每按一次 Enter 拆分出 1 个新空段落
    const paragraphs = te.view.state.doc.content.content.filter((n) => n.type.name === "paragraph");
    expect(paragraphs).toHaveLength(6);
    expect(te.view.state.doc.childCount).toBe(6);
  });
});
