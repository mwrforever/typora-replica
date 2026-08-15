// E16 行内样式：粗体快捷键 / 斜体输入规则 / GFM 单词内下划线 / 行内代码快捷键
import { describe, expect, it } from "vitest";
import { makeTestEditor } from "../../test/editor-test-utils";

describe("E16 行内样式", () => {
  it("AC-E16-1 选中文字按 Ctrl+B 加粗（落盘 **文字**）", async () => {
    const te = await makeTestEditor("选中加粗");
    // 选中全部 4 字：ProseMirror 文本位置从 1 起算（0 为 doc 边界，非行内文本位置）
    te.setSelection(1, 5);
    te.press("b", { ctrl: true });

    expect(te.view.dom.querySelector("strong")?.textContent).toBe("选中加粗");
    expect(te.getMarkdown()).toBe("**选中加粗**");
  });

  it("AC-E16-2 输入 *斜体* 渲染为斜体", async () => {
    const te = await makeTestEditor();
    te.insertText("*斜体*");
    expect(te.view.dom.querySelector("em")?.textContent).toBe("斜体");
  });

  it("AC-E16-3 单词内下划线不触发斜体（GFM）", async () => {
    const te = await makeTestEditor();
    te.insertText("wow_great_stuff");

    // 单词内部下划线不产生 em 节点
    expect(te.view.dom.querySelector("em")).toBeNull();
    expect(te.getMarkdown()).toBe("wow_great_stuff");
  });

  it("AC-E16-4 选中文字按 Ctrl+Shift+` 转为行内代码", async () => {
    const te = await makeTestEditor("转代码");
    // 选中全部 3 字：ProseMirror 文本位置从 1 起算（0 为 doc 边界，非行内文本位置）
    te.setSelection(1, 4);
    te.press("`", { ctrl: true, shift: true });

    expect(te.view.dom.querySelector("code")?.textContent).toBe("转代码");
    expect(te.getMarkdown()).toBe("`转代码`");
  });
});
