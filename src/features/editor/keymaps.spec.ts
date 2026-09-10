// keymap 注册表：注册/查询行为 + 内置键位清单（100% 覆盖核心语法转换）
import { describe, expect, it } from "vitest";
import type { Ctx } from "@milkdown/kit/ctx";
import { makeTestEditor } from "../../test/editor-test-utils";
import {
  addEditorKeymap,
  bindMenuShortcut,
  hasEditorKeymap,
  listBindableEditorCommands,
  listEditorKeymaps,
  makeScrollJumpCommand,
  runEditorMenuCommand,
} from "./keymaps";

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

  it("内置 Typora 行内代码键位 Ctrl+Shift+` 已注册（commonmark 预设仅绑 Mod-e）", () => {
    expect(hasEditorKeymap("Mod-Shift-`")).toBe(true);
    expect(listEditorKeymaps().find((e) => e.key === "Mod-Shift-`")?.priority).toBe(200);
  });

  it("内置 Typora 插入代码围栏键位 Ctrl+Shift+K 已注册（commonmark 预设仅绑 Mod-Alt-c）", () => {
    expect(hasEditorKeymap("Mod-Shift-k")).toBe(true);
    // 默认优先级 200，压制表格内置（100）与 baseKeymap（50）
    expect(listEditorKeymaps().find((e) => e.key === "Mod-Shift-k")?.priority).toBe(200);
  });

  it("内置 Typora 表格 Tab 末格加行键位已注册（priority 200 压制内置 NextCell 100）", () => {
    expect(hasEditorKeymap("Tab")).toBe(true);
    expect(listEditorKeymaps().find((e) => e.key === "Tab")?.priority).toBe(200);
  });

  it("内置 Typora 标题级别键位已注册（Ctrl+1~6 设级别、Ctrl+0 转段落、Ctrl+=/- 增减级别）", () => {
    // 级别循环 1-6 全部注册
    for (let level = 1; level <= 6; level++) {
      expect(hasEditorKeymap(`Mod-${level}`)).toBe(true);
    }
    expect(hasEditorKeymap("Mod-0")).toBe(true);
    expect(hasEditorKeymap("Mod-=")).toBe(true);
    expect(hasEditorKeymap("Mod--")).toBe(true);
    // 默认优先级 200，压制表格内置（100）与 baseKeymap（50）
    expect(listEditorKeymaps().find((e) => e.key === "Mod-=")?.priority).toBe(200);
    expect(listEditorKeymaps().find((e) => e.key === "Mod--")?.priority).toBe(200);
  });

  it("默认优先级为 200（压制表格内置 100 与 baseKeymap 50）", () => {
    const entry = listEditorKeymaps().find((e) => e.key === "Mod-[");
    expect(entry?.priority).toBe(200);
  });
});

describe("bindMenuShortcut（10 keyBinding 注入目录）", () => {
  it("目录内命令注入成功且 priority 300 高于内置 200（AC-C1-3 自定义优先）", () => {
    const before = listEditorKeymaps().length;
    expect(bindMenuShortcut("Heading 1", "Mod-Shift-p")).toBe(true);
    const entry = listEditorKeymaps().at(-1)!;
    expect(entry.key).toBe("Mod-Shift-p");
    expect(entry.priority).toBe(300);
    expect(listEditorKeymaps().length).toBe(before + 1);
  });

  it("目录外命令返回 false 不注册（调用方告警忽略）", () => {
    const before = listEditorKeymaps().length;
    expect(bindMenuShortcut("Not A Command", "Mod-j")).toBe(false);
    expect(listEditorKeymaps().length).toBe(before);
  });

  it("目录覆盖编辑器域十命令", () => {
    // 占位键名必须是合法 ProseMirror 键名（本文件后续用例会真实 create 编辑器，
    // 非法修饰符段会在 KeymapManager 键名归一化时抛错）；Mod-Alt-F* 与内置键位无冲突
    for (const [index, commandId] of [
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Heading 4",
      "Heading 5",
      "Heading 6",
      "Paragraph",
      "Code Fences",
      "Inline Code",
      "Bold",
      "Italic",
    ].entries()) {
      expect(bindMenuShortcut(commandId, `Mod-Alt-F${index + 1}`)).toBe(true);
    }
  });
});

describe("keyBinding 注入键位真实生效（AC-C1-2 端到端：注册表 → keymap 链 → 命令消费）", () => {
  // 注入目录工厂在 KeymapManager.build（create 时）解析 ctx、按键时执行命令——
  // 本组用例走真实 create + DOM keydown 链路，断言注入键位在编辑器内实际生效。
  it("注入 Bold/Italic 键位后按键切换行内标记（可叠加）", async () => {
    bindMenuShortcut("Bold", "Mod-F10");
    bindMenuShortcut("Italic", "Mod-F11");
    const te = await makeTestEditor("选中文字");
    te.setSelection(1, 5);
    te.press("F10", { ctrl: true });
    expect(te.getMarkdown()).toBe("**选中文字**");
    te.press("F11", { ctrl: true });
    expect(te.getMarkdown()).toBe("***选中文字***");
  });

  it("注入 Inline Code 键位后按键包裹反引号（commandsCtx 调用路径）", async () => {
    bindMenuShortcut("Inline Code", "Mod-F12");
    const te = await makeTestEditor("选中文字");
    te.setSelection(1, 5);
    te.press("F12", { ctrl: true });
    expect(te.getMarkdown()).toBe("`选中文字`");
  });

  it("注入 Paragraph 键位后按键将标题转为正文段落（setBlockType 路径）", async () => {
    bindMenuShortcut("Paragraph", "Mod-F9");
    const te = await makeTestEditor("# 标题文字");
    te.setSelection(2, 2);
    te.press("F9", { ctrl: true });
    expect(te.getMarkdown()).toBe("标题文字");
  });

  it("注入 Heading 1~6 与 Code Fences 键位后按键切换块级形态", async () => {
    bindMenuShortcut("Heading 1", "Mod-F1");
    bindMenuShortcut("Heading 2", "Mod-F2");
    bindMenuShortcut("Heading 3", "Mod-F3");
    bindMenuShortcut("Heading 4", "Mod-F4");
    bindMenuShortcut("Heading 5", "Mod-F5");
    bindMenuShortcut("Heading 6", "Mod-F6");
    bindMenuShortcut("Code Fences", "Mod-F8");
    const te = await makeTestEditor("正文文字");
    te.setSelection(1, 1);
    // 六级逐级设档（Typora Ctrl+1~6 口径：当前块直接设为对应级别）
    te.press("F3", { ctrl: true });
    expect(te.getMarkdown()).toBe("### 正文文字");
    te.press("F4", { ctrl: true });
    expect(te.getMarkdown()).toBe("#### 正文文字");
    te.press("F5", { ctrl: true });
    expect(te.getMarkdown()).toBe("##### 正文文字");
    te.press("F2", { ctrl: true });
    expect(te.getMarkdown()).toBe("## 正文文字");
    te.press("F1", { ctrl: true });
    expect(te.getMarkdown()).toBe("# 正文文字");
    te.press("F6", { ctrl: true });
    expect(te.getMarkdown()).toBe("###### 正文文字");
    te.press("F8", { ctrl: true });
    // 围栏块序列化以换行收尾（e6 同款形态：内容行后闭合围栏 + 尾随换行）
    expect(te.getMarkdown()).toBe("```\n正文文字\n```\n");
  });
});

describe("菜单命令目录（缺口 G 形态 b：10 keyBinding 注入与 12 menuRouter 同源）", () => {
  it("目录覆盖原有 keyBinding 十一命令与 Edit/Paragraph/Format 域扩展命令", () => {
    const catalog = listBindableEditorCommands();
    // 原有目录（AC-C1-2 十命令 + Italic）
    for (const commandId of [
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Heading 4",
      "Heading 5",
      "Heading 6",
      "Paragraph",
      "Code Fences",
      "Inline Code",
      "Bold",
      "Italic",
    ]) {
      expect(catalog).toContain(commandId);
    }
    // 12 Edit/Paragraph/Format 菜单可执行扩展
    for (const commandId of [
      "New Paragraph",
      "New Line",
      "Select All",
      "Jump to Top",
      "Jump to Bottom",
      "Jump to Selection",
      "Increase Heading Level",
      "Decrease Heading Level",
      "Table",
      "Quote",
      "Ordered List",
      "Unordered List",
      "Indent",
      "Outdent",
      "Strike",
    ]) {
      expect(catalog).toContain(commandId);
    }
  });

  it("runEditorMenuCommand 目录外命令返回 false（调用方告警忽略）", () => {
    expect(runEditorMenuCommand("Not A Command", () => undefined)).toBe(false);
  });

  it("runEditorMenuCommand 无编辑器实例返回 false（未创建/已销毁窗口期）", () => {
    expect(runEditorMenuCommand("Bold", () => undefined)).toBe(false);
  });

  it("runEditorMenuCommand 执行 Bold 与按键路径同一命令函数（AC-M-3 同源断言）", async () => {
    const te = await makeTestEditor("选中文字");
    te.setSelection(1, 5);
    // 菜单 action 路径：runEditorMenuCommand 经目录工厂执行 toggleStrong
    expect(runEditorMenuCommand("Bold", () => te.editor)).toBe(true);
    expect(te.getMarkdown()).toBe("**选中文字**");
  });

  it("runEditorMenuCommand 执行 Quote/Unordered List/Ordered List 块级包裹", async () => {
    // 引用块：段落上下文包裹（列表内引用无合法包裹路径，命令返回 false 不消费）
    const te = await makeTestEditor("引用文字");
    te.setSelection(1, 1);
    expect(runEditorMenuCommand("Quote", () => te.editor)).toBe(true);
    expect(te.getMarkdown()).toContain("> 引用文字");
    expect(runEditorMenuCommand("Quote", () => te.editor)).toBe(true);
    expect(te.getMarkdown()).toContain("> > 引用文字");
    // 无序列表：段落转列表（列表序列化以换行收尾）
    const te2 = await makeTestEditor("列表文字");
    te2.setSelection(1, 1);
    expect(runEditorMenuCommand("Unordered List", () => te2.editor)).toBe(true);
    expect(te2.getMarkdown()).toContain("- 列表文字");
    // 有序列表
    const te3 = await makeTestEditor("列表文字");
    te3.setSelection(1, 1);
    expect(runEditorMenuCommand("Ordered List", () => te3.editor)).toBe(true);
    expect(te3.getMarkdown()).toContain("1. 列表文字");
  });

  it("runEditorMenuCommand 执行 Strike 行内删除线", async () => {
    const te = await makeTestEditor("删除文字");
    te.setSelection(1, 5);
    expect(runEditorMenuCommand("Strike", () => te.editor)).toBe(true);
    expect(te.getMarkdown()).toBe("~~删除文字~~");
  });

  it("runEditorMenuCommand 执行 Table 插入 3×3 表格", async () => {
    const te = await makeTestEditor("");
    expect(runEditorMenuCommand("Table", () => te.editor)).toBe(true);
    // 空表格序列化为管道分隔行（3 列头 + 分隔 + 2 数据行）
    const markdown = te.getMarkdown();
    expect(markdown).toContain("|");
    expect(markdown.match(/\|/g)?.length).toBeGreaterThanOrEqual(8);
  });

  it("runEditorMenuCommand 执行标题级别增减（钳制 1-6，非标题上下文不消费）", async () => {
    const te = await makeTestEditor("## 标题文字");
    te.setSelection(1, 1);
    // H2 升级 → H1；H1 再升级钳制保持 H1
    expect(runEditorMenuCommand("Increase Heading Level", () => te.editor)).toBe(true);
    expect(te.getMarkdown()).toBe("# 标题文字");
    expect(runEditorMenuCommand("Increase Heading Level", () => te.editor)).toBe(true);
    expect(te.getMarkdown()).toBe("# 标题文字");
    // 降级两级 → H3
    expect(runEditorMenuCommand("Decrease Heading Level", () => te.editor)).toBe(true);
    expect(runEditorMenuCommand("Decrease Heading Level", () => te.editor)).toBe(true);
    expect(te.getMarkdown()).toBe("### 标题文字");
    // 非标题上下文（段落）：命令返回 false 不消费
    const te2 = await makeTestEditor("正文段落");
    te2.setSelection(1, 1);
    expect(runEditorMenuCommand("Decrease Heading Level", () => te2.editor)).toBe(false);
  });

  it("runEditorMenuCommand 执行 New Paragraph/New Line/Select All 与光标跳转", async () => {
    // 新段落：光标处拆段（PM splitBlock，回车主路径；markdown 段间以空行分隔）
    const te = await makeTestEditor("首行文字");
    te.setSelection(3, 3);
    expect(runEditorMenuCommand("New Paragraph", () => te.editor)).toBe(true);
    expect(te.getMarkdown()).toBe("首行\n\n文字");
    // 新行：软换行（Shift+Enter 主路径，序列化为硬换行标记）
    const te2 = await makeTestEditor("首行文字");
    te2.setSelection(3, 3);
    expect(runEditorMenuCommand("New Line", () => te2.editor)).toBe(true);
    expect(te2.getMarkdown()).toBe("首行\\\n文字");
    // 全选（selectAll 与 baseKeymap Mod-a 同语义）+ 光标跳转（选区归位断言）
    expect(runEditorMenuCommand("Select All", () => te2.editor)).toBe(true);
    expect(runEditorMenuCommand("Jump to Bottom", () => te2.editor)).toBe(true);
    expect(te2.view.state.selection.from).toBeGreaterThan(1);
    expect(runEditorMenuCommand("Jump to Top", () => te2.editor)).toBe(true);
    expect(te2.view.state.selection.from).toBe(1);
    expect(runEditorMenuCommand("Jump to Selection", () => te2.editor)).toBe(true);
  });

  it("runEditorMenuCommand 执行 Indent/Outdent（与 Ctrl+[/] 同一 sink/lift 路径）", async () => {
    // 缩进需要前一列表项作为下沉宿主（sinkListItem 语义）：单项列表返回 false 不消费
    const single = await makeTestEditor("- 列表项");
    single.setSelection(3, 3);
    expect(runEditorMenuCommand("Indent", () => single.editor)).toBe(false);
    const te = await makeTestEditor("- 甲\n- 乙");
    te.setSelection(6, 6);
    expect(runEditorMenuCommand("Indent", () => te.editor)).toBe(true);
    expect(te.getMarkdown()).toContain("  - 乙");
    expect(runEditorMenuCommand("Outdent", () => te.editor)).toBe(true);
    expect(te.getMarkdown()).toContain("- 乙");
  });
});

describe("makeScrollJumpCommand（光标跳转工厂：dry-run 直调覆盖）", () => {
  it("dispatch 缺省（dry-run）仅判定命中不改文档", async () => {
    const te = await makeTestEditor("跳转文字");
    for (const mode of ["top", "bottom", "selection"] as const) {
      // 工厂不消费 ctx（跳转命令直接基于 state 构建），桩传入即可
      const command = makeScrollJumpCommand(mode)(null as unknown as Ctx);
      expect(command(te.view.state, undefined, te.view)).toBe(true);
      // dry-run 不改选区（未派发事务）
      expect(te.view.state.selection.from).toBe(1);
    }
  });
});
