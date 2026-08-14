// 自定义语法规则单测：行尾两空格硬换行命令分支全覆盖 + 嵌套引用输入规则正则边界 + setext 二级标题规则
// + 宽松 ATX 标题规则分支全覆盖 + Typora 建表规则（注册表 + 正则边界 + 转换/回落分支）
// （核心语法转换 100% 覆盖）
import { describe, expect, it, vi } from "vitest";
import type { Transaction } from "@milkdown/kit/prose/state";
import { makeTestEditor } from "../../test/editor-test-utils";
import {
  LENIENT_ATX_HEADING_INPUT_PATTERN,
  NESTED_BLOCKQUOTE_INPUT_PATTERN,
  SETEXT_H2_INPUT_PATTERN,
  TYPORA_TABLE_INPUT_PATTERN,
  listEditorInputRules,
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

describe("LENIENT_ATX_HEADING_INPUT_PATTERN 宽松 ATX 标题触发正则边界", () => {
  it("命中：行首 `###Header` + Enter 换行，捕获组为 3 个 # 号", () => {
    const match = LENIENT_ATX_HEADING_INPUT_PATTERN.exec("###Header\n");
    expect(match?.[1]).toBe("###");
  });

  it("命中：`#x` 单 # 无空格形态同样触发（非严格模式宽容）", () => {
    expect(LENIENT_ATX_HEADING_INPUT_PATTERN.exec("#x\n")?.[1]).toBe("#");
  });

  it("未命中：`# Header` 带空格形态（内置严格规则已即时消费，两规则互斥）", () => {
    expect(LENIENT_ATX_HEADING_INPUT_PATTERN.exec("# Header\n")).toBeNull();
  });

  it("未命中：无 Enter 换行的行内输入（Enter 是本规则触发时机）", () => {
    expect(LENIENT_ATX_HEADING_INPUT_PATTERN.exec("###Header")).toBeNull();
  });

  it("未命中：普通文本行", () => {
    expect(LENIENT_ATX_HEADING_INPUT_PATTERN.exec("普通文本\n")).toBeNull();
  });
});

describe("createLenientAtxHeadingInputRule 宽松 ATX 标题转换分支", () => {
  it("转换：`###Header` 按 Enter 整段转 H3 并删除行首 # 标记", async () => {
    const te = await makeTestEditor();
    te.insertText("###Header");
    te.press("Enter"); // Enter 触发规则链（milkdown 将 "\n" 作为拟输入文本跑规则）
    // 整段转为 H3（level = # 号数），行首 # 标记删除仅剩标题文本
    expect(te.view.state.doc.child(0).type.name).toBe("heading");
    expect(te.view.state.doc.child(0).attrs.level).toBe(3);
    expect(te.view.state.doc.child(0).textContent).toBe("Header");
  });

  it("回落：父块非段落（标题块内）返回 null，Enter 回落内置拆段行为", async () => {
    // `# #甲` 解析为 H1（文本 "#甲"）——文本以 # 开头保证本规则正则命中
    const te = await makeTestEditor("# #甲");
    // 光标置于标题文本行尾（父节点为标题块，非段落）
    te.setSelection(te.view.state.doc.content.size - 1, te.view.state.doc.content.size - 1);
    te.press("Enter");
    // 判别点：本规则若消费按键会删除行首 # 并保持单块 H1；实测文档被拆为两块，
    // 说明本规则对非段落父块返回 null 回落，Enter 由内置拆段行为接管
    expect(te.view.state.doc.childCount).toBe(2);
  });
});

describe("输入规则注册表（模块级追加规则）", () => {
  it("Typora 建表规则已注册", () => {
    expect(listEditorInputRules().length).toBeGreaterThanOrEqual(1);
  });

  it("建表正则匹配双单元格行（Enter 触发，拟输入文本含换行）", () => {
    expect(TYPORA_TABLE_INPUT_PATTERN.exec("| a | b |\n")).not.toBeNull();
  });

  it("建表正则匹配单单元格行", () => {
    expect(TYPORA_TABLE_INPUT_PATTERN.exec("| a |\n")).not.toBeNull();
  });

  it("建表正则不匹配无 Enter 的行内输入（Enter 是触发时机，打字中途不提前建表）", () => {
    expect(TYPORA_TABLE_INPUT_PATTERN.exec("| a | b |")).toBeNull();
  });

  it("建表正则不匹配非表格文本", () => {
    expect(TYPORA_TABLE_INPUT_PATTERN.exec("普通文本")).toBeNull();
  });
});

describe("Typora 建表输入规则转换与回落分支", () => {
  it("转换：单格 `| a |` + Enter 创建单列表格（表头含文本）", async () => {
    const te = await makeTestEditor();
    te.insertText("| a |");
    te.press("Enter");
    expect(te.view.dom.querySelector("table")).not.toBeNull();
    expect(te.getMarkdown()).toMatch(/^\| a/);
  });

  it("转换：全空白单元格 `|   |` + Enter 建表（空单元格退化为空段落分支）", async () => {
    const te = await makeTestEditor();
    te.insertText("|   |");
    te.press("Enter");
    expect(te.view.dom.querySelector("table")).not.toBeNull();
  });

  it("回落：行尾有未消费文本时 Enter 不建表（回落内置拆段）", async () => {
    const te = await makeTestEditor();
    te.insertText("| a | b | 尾文");
    // 光标移到「尾文」之前：光标前文本恰为表格语法行，但行尾仍有 2 字未消费
    // （doc.content.size 为段落节点宽：尾文 2 字 + 段落闭标签 1 = 内容终点 - 3）
    te.setSelection(te.view.state.doc.content.size - 3, te.view.state.doc.content.size - 3);
    te.press("Enter");
    // 判别点：未建表且 Enter 将段落拆为两块（表格语法行 + 尾文）
    expect(te.view.dom.querySelector("table")).toBeNull();
    expect(te.view.state.doc.childCount).toBe(2);
  });

  it("回落：列表项内建表语法不转换（canReplaceWith 拒绝表格替换列表项子区间）", async () => {
    const te = await makeTestEditor();
    te.insertText("- "); // 内置列表规则转为列表项
    te.insertText("| a | b |");
    te.press("Enter");
    // 判别点：列表项内不产生表格节点（表格语法保持为文本）
    expect(te.view.dom.querySelector("table")).toBeNull();
  });

  it("回落：触发文本非父块内容起点（超 500 字窗口）不建表，Enter 回落拆段", async () => {
    const te = await makeTestEditor();
    // customInputRules 只回看光标前 500 字窗口：构造「7 字前缀 + | + 490 字 + 表格语法行
    // （9 字）」共 507 字段落，使窗口恰以 `|` 开头且整窗匹配建表正则、但该 `|` 前仍有
    // 7 字（非父块内容起点）——触发文本不独占段首时不建表
    const longText = "x".repeat(7) + "|" + "x".repeat(490) + "| a | b |";
    te.insertText(longText);
    te.press("Enter");
    // 判别点：未建表且 Enter 回落内置拆段（长段落拆为两块）
    expect(te.view.dom.querySelector("table")).toBeNull();
    expect(te.view.state.doc.childCount).toBe(2);
  });
});
