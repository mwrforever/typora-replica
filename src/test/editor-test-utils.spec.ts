// 测试助手自验证：保证基座（jsdom stubs + Crepe 创建）可用，后续任务才可依赖
import { describe, expect, it } from "vitest";
import { makeTestEditor } from "./editor-test-utils";

describe("编辑器测试助手", () => {
  it("能在 jsdom 中创建 Crepe 实例并写入初始文档", async () => {
    const te = await makeTestEditor("# 测试标题");

    // 初始 markdown 应被解析为 heading 节点
    expect(te.getMarkdown()).toBe("# 测试标题");
    expect(te.view.dom.querySelector("h1")?.textContent).toBe("测试标题");
  });

  it("insertText 能插入文本并触发输入规则", async () => {
    const te = await makeTestEditor();
    te.insertText("# 新标题");
    expect(te.view.dom.querySelector("h1")?.textContent).toBe("新标题");
  });

  it("press 能触发 keymap（Enter 拆分段落）", async () => {
    const te = await makeTestEditor("第一段");
    te.setSelection(3, 3);
    te.press("Enter");
    // 段落拆分后文档应有两个 paragraph 节点
    expect(te.view.state.doc.childCount).toBe(2);
  });
});
