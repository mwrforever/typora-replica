// E4 列表：- /1. 创建 / Tab 缩进 / Ctrl+[ 与 Ctrl+] 的 Typora 反向配对
import { describe, expect, it } from "vitest";
import { makeTestEditor } from "../../test/editor-test-utils";

describe("E4 列表", () => {
  it("AC-E4-1 行首 `- ` 创建无序列表且 Enter 延续", async () => {
    const te = await makeTestEditor();
    te.insertText("- 项目一");
    te.press("Enter");
    te.insertText("项目二");

    expect(te.view.dom.querySelectorAll("ul li")).toHaveLength(2);
    expect(te.getMarkdown()).toContain("- 项目二");
  });

  it("AC-E4-2 行首 `1. ` 创建有序列表且序号递增", async () => {
    const te = await makeTestEditor();
    te.insertText("1. 第一项");
    te.press("Enter");
    te.insertText("第二项");

    const items = te.view.dom.querySelectorAll("ol li");
    expect(items).toHaveLength(2);
    expect(te.getMarkdown()).toMatch(/1\. 第一项\s*\n2\. 第二项/);
  });

  it("AC-E4-3 列表项内 Tab 缩进一级，Shift+Tab 降回", async () => {
    const te = await makeTestEditor();
    te.insertText("- 项目一");
    te.press("Enter");
    te.insertText("子项目");
    // 光标保持在子项目文本末尾（insertText 逐字输入后光标自然落在末尾）。
    // 注意：不可用 doc.content.size - 1 定位——milkdown 的 remark-preserve-empty-line
    // 插件会在文档末尾追加空段落，size-1 落在列表外的空段落中，Tab 不会命中列表项
    te.press("Tab");
    expect(te.view.dom.querySelector("ul ul li")?.textContent).toContain("子项目");

    te.press("Tab", { shift: true });
    expect(te.view.dom.querySelector("ul ul")).toBeNull();
  });

  it("AC-E4-4 Ctrl+[ 增加缩进（Indent）、Ctrl+] 减少缩进（Outdent，与 VS Code 相反）", async () => {
    const te = await makeTestEditor();
    te.insertText("- 项目一");
    te.press("Enter");
    te.insertText("子项目");
    // 光标保持在子项目文本末尾（同 AC-E4-3，避免落入文档尾部空段落）

    // Typora 特有：Ctrl+[ = Indent（缩进增加）
    te.press("[", { ctrl: true });
    expect(te.view.dom.querySelector("ul ul li")?.textContent).toContain("子项目");

    // Ctrl+] = Outdent（缩进减少）
    te.press("]", { ctrl: true });
    expect(te.view.dom.querySelector("ul ul")).toBeNull();
  });

  it("AC-E4-5 空行输入 `- ` 不跟内容不产生空列表项", async () => {
    const te = await makeTestEditor();
    te.insertText("- ");
    te.press("Enter");
    te.insertText("- ");
    te.press("Enter");

    // 无内容的 `- ` 不生成残留空列表项（列表节点不含空项）
    const items = te.view.dom.querySelectorAll("li");
    expect(items).toHaveLength(0);
  });
});
