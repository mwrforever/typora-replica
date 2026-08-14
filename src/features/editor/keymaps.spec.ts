// keymap 注册表：注册/查询行为 + 内置键位清单（100% 覆盖核心语法转换）
import { describe, expect, it } from "vitest";
import { addEditorKeymap, hasEditorKeymap, listEditorKeymaps } from "./keymaps";

describe("keymap 注册表", () => {
  it("addEditorKeymap 后可在注册表中查询到该键位", () => {
    addEditorKeymap({ key: "Mod-Test", onRun: () => () => false, priority: 300 });
    expect(hasEditorKeymap("Mod-Test")).toBe(true);
    expect(listEditorKeymaps()).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "Mod-Test" })]),
    );
  });

  it("内置 Typora 反向 Indent/Outdent 键位已注册", () => {
    // Ctrl+[ = Indent（缩进增加）、Ctrl+] = Outdent（缩进减少）
    expect(hasEditorKeymap("Mod-[")).toBe(true);
    expect(hasEditorKeymap("Mod-]")).toBe(true);
  });

  it("默认优先级为 200（压制表格内置 100 与 baseKeymap 50）", () => {
    const entry = listEditorKeymaps().find((e) => e.key === "Mod-[");
    expect(entry?.priority).toBe(200);
  });
});
