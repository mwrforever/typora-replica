// E10 水平线：*** / --- 生成、非空行后 --- 不误转
import { describe, expect, it } from "vitest";
import { makeTestEditor } from "../../test/editor-test-utils";

describe("E10 水平线", () => {
  it("AC-E10-1 空行输入 `***` + Enter 渲染为水平线", async () => {
    const te = await makeTestEditor();
    te.insertText("***");
    te.press("Enter");
    expect(te.view.dom.querySelector("hr")).not.toBeNull();
  });

  it("AC-E10-2 空行输入 `---` + Enter 渲染为水平线", async () => {
    const te = await makeTestEditor();
    te.insertText("---");
    te.press("Enter");
    expect(te.view.dom.querySelector("hr")).not.toBeNull();
  });

  it("AC-E10-3 非空行后输入 `---` 不误转水平线", async () => {
    const te = await makeTestEditor();
    te.insertText("前面有文字");
    te.press("Enter");
    te.insertText("---");
    te.press("Enter");

    // 不得出现 hr（CommonMark 语义下会转为 setext 二级标题，同样不产生水平线）
    expect(te.view.dom.querySelector("hr")).toBeNull();
  });
});
