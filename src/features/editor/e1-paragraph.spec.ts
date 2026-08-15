// E1 段落与换行：Enter 拆段 / Shift+Enter 硬换行 / 行尾两空格兼容硬换行 / 连续 Enter 健壮性
import { describe, expect, it } from "vitest";
import { destroyTestEditors, makeTestEditor } from "../../test/editor-test-utils";

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

    // 交互行为：段落不拆分、内部出现 hardBreak 节点（行尾两空格转为兼容硬换行）
    let hasHardBreak = false;
    te.view.state.doc.descendants((n) => {
      if (n.type.name === "hardbreak") {
        hasHardBreak = true;
        return false; // 找到即停止遍历
      }
    });
    expect(hasHardBreak).toBe(true);
    expect(te.view.state.doc.childCount).toBe(1);
    // 继续输入使硬换行落在段中：段尾 hardBreak 会被 milkdown 序列化器丢弃（上游行为），
    // 段中形态才能完整落盘。落盘为「文本两空格 + break 序列化 \\\n」的 CommonMark 兼容语法
    te.insertText("第二行");
    const md = te.crepe.getMarkdown();
    expect(md).toBe("行一  \\\n第二行\n");
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

  it("FIX-1 段中两空格后按 Enter 回落内置拆段（不误插 hardBreak）", async () => {
    const te = await makeTestEditor();
    te.insertText("ab  cd");
    // 光标置于第二个空格之后（段中：parentOffset=4 < 内容大小 6，非行尾）
    te.setSelection(5, 5);
    te.press("Enter");
    // 判别点：段落正常拆分（Typora 段中两空格不构成硬换行），无 hardBreak 节点
    expect(te.view.state.doc.childCount).toBe(2);
    let hasHardBreak = false;
    te.view.state.doc.descendants((n) => {
      if (n.type.name === "hardbreak") hasHardBreak = true;
    });
    expect(hasHardBreak).toBe(false);
  });

  it("FIX-5 段尾多空格保存往返不丢字符（字面空格 + &#x20; 编码组合保住两空格）", async () => {
    const te = await makeTestEditor();
    // 事务直插绕过输入规则，构造段尾两空格的字面文本节点（未按 Enter）
    te.view.dispatch(te.view.state.tr.insertText("abc  ", te.view.state.selection.from));
    const md = te.crepe.getMarkdown();
    // 段尾多空格非硬换行载体：safe() 编码最后一个空格为 &#x20;、前一个保持字面
    //（修复前还原为字面空格落盘，重解析被 CommonMark 行尾剥离规则吃掉——静默数据丢失）
    expect(md).toBe("abc &#x20;\n");
    // 往返：字面空格 + 字符引用组合在重解析时两空格完整保留，再次落盘为定点
    const reparsed = await makeTestEditor(md);
    expect(reparsed.view.state.doc.textContent).toBe("abc  ");
    expect(reparsed.crepe.getMarkdown()).toBe("abc &#x20;\n");
  });

  it("FIX-5 段中两空格+Enter 真硬换行往返保留两空格与 hardBreak（不回归）", async () => {
    const te = await makeTestEditor();
    te.view.dispatch(te.view.state.tr.insertText("abc  ", te.view.state.selection.from));
    te.press("Enter");
    te.insertText("def");
    const md = te.crepe.getMarkdown();
    // 硬换行落盘形态：文本两空格 + break 序列化的 "\\\n"（safe 不编码段中尾随空白）
    expect(md).toBe("abc  \\\ndef\n");
    const reparsed = await makeTestEditor(md);
    expect(reparsed.view.state.doc.textContent).toBe("abc  \ndef");
    let br = 0;
    reparsed.view.state.doc.descendants((n) => {
      if (n.type.name === "hardbreak") br++;
    });
    expect(br).toBe(1);
  });

  it("FIX-2 测试基座销毁不向 body 累积挂载根元素", async () => {
    const before = document.body.querySelectorAll("div").length;
    await makeTestEditor("一");
    await makeTestEditor("二");
    await makeTestEditor("三");
    // 三个编辑器挂载后 body div 数必然增长（每实例 root div + 编辑器内部结构）
    expect(document.body.querySelectorAll("div").length).toBeGreaterThan(before);
    await destroyTestEditors();
    // 销毁路径移除 root div 与编辑器内部容器，body 恢复用例前数量（无残留累积）
    expect(document.body.querySelectorAll("div").length).toBe(before);
  });
});
