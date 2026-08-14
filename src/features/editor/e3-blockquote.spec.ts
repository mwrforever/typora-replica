// E3 引用块：`> ` 生成 / Enter 延续 / `>> ` 嵌套 / 空行退出
import { describe, expect, it } from "vitest";
import { makeTestEditor } from "../../test/editor-test-utils";

describe("E3 引用块", () => {
  it("AC-E3-1 行首输入 `> ` 生成引用块且 Enter 延续 `>`", async () => {
    const te = await makeTestEditor();
    te.insertText("> 引用内容");
    te.press("Enter");
    te.insertText("延续行");

    const blockquotes = te.view.dom.querySelectorAll("blockquote");
    expect(blockquotes.length).toBeGreaterThanOrEqual(1);
    // 新行延续引用块（两行文本都在引用块内）
    expect(te.view.dom.querySelector("blockquote")?.textContent).toContain("延续行");
    // 落盘无多余 `>` 残留
    expect(te.getMarkdown()).toMatch(/^> 引用内容/);
  });

  it("AC-E3-2 引用块内行首实时输入 `>> ` 生成嵌套引用块", async () => {
    const te = await makeTestEditor();
    te.insertText("> 外层"); // 逐字实时输入：`> ` 触发内置引用输入规则生成外层引用
    te.press("Enter"); // 外层引用内换出新行
    te.insertText(">>"); // 逐字输入两个 `>`：无规则命中，字面落文本
    te.insertText(" "); // 空格触发嵌套引用输入规则（^\s*>>\s$），当前行包裹为内层引用
    // 嵌套结构：blockquote 内包含 blockquote，且触发文本 `>> ` 已被规则消费
    expect(te.view.dom.querySelector("blockquote blockquote")?.textContent).toBe("");
    te.insertText("内层"); // 内层引用内输入正文
    expect(te.view.dom.querySelector("blockquote blockquote")?.textContent).toContain("内层");
    // 落盘语义断言：remark 序列化嵌套引用在 `>` 间保留空格（`> > 内层`），
    // 即 brief「落盘含 `>> 内层` 语义」的两层嵌套形态
    expect(te.getMarkdown()).toContain("> > 内层");
  });

  it("AC-E3-3 空行后输入普通文字退出引用块且无残留 `>`", async () => {
    const te = await makeTestEditor();
    te.insertText("> 引用内容");
    te.press("Enter"); // 空引用行
    te.press("Enter"); // 退出引用块
    te.insertText("普通文字");

    // 最后一个 blockquote 不含「普通文字」且文档无文本级 `>` 残留
    const lastBq = te.view.dom.querySelector("blockquote:last-of-type");
    expect(lastBq?.textContent).not.toContain("普通文字");
    expect(te.getMarkdown()).not.toContain("> 普通文字");
  });
});
