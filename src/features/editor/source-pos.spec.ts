// source-pos 位置映射测试（01 增补接口缺口 A；12 源码模式 AC-M-7 光标恢复依赖）
//
// 覆盖口径：正常（单段落/多段落/列表/标题）/ 边界（空文档/行首行尾/长行/
// 硬换行/原子块与行内原子节点/越界收敛）/ 异常路径（undo 后映射随文档收缩）。
// 经真实 Crepe 实例（makeTestEditor）断言双向映射行为，杜绝实现细节绑定。
import { describe, expect, it } from "vitest";
import { undo } from "@milkdown/kit/prose/history";
import { makeTestEditor } from "../../test/editor-test-utils";
import { lineColToPmPos, pmPosToLineCol } from "./source-pos";

describe("pmPosToLineCol 基础映射", () => {
  it("单段落：文档偏移映射行列（首字符为行首）", async () => {
    const te = await makeTestEditor("一二三四五六七八九十");
    expect(pmPosToLineCol(te.editor, 1)).toEqual({ line: 0, col: 0 });
    expect(pmPosToLineCol(te.editor, 3)).toEqual({ line: 0, col: 2 });
  });

  it("行首行尾：行尾偏移映射行尾列（col = 行长）", async () => {
    const te = await makeTestEditor("一二三");
    // 段落内容末（位置 4 = 行尾）→ col 3
    expect(pmPosToLineCol(te.editor, 4)).toEqual({ line: 0, col: 3 });
    // 文档头（位置 0 早于全部文本）→ 原点
    expect(pmPosToLineCol(te.editor, 0)).toEqual({ line: 0, col: 0 });
  });

  it("多段落：段落边界两侧分别映射行尾与次行行首", async () => {
    const te = await makeTestEditor("第一段\n\n第二段");
    // 位置 4 = 第一段内容末 → 行 0 行尾（col 3）
    expect(pmPosToLineCol(te.editor, 4)).toEqual({ line: 0, col: 3 });
    // 位置 5 落在次段落开标记内，归次行行首（插入点语义）
    expect(pmPosToLineCol(te.editor, 5)).toEqual({ line: 1, col: 0 });
    // 位置 6 = 第二段首字符 → 行 1 行首
    expect(pmPosToLineCol(te.editor, 6)).toEqual({ line: 1, col: 0 });
  });

  it("列表：每个列表项计一行（与 markdown 逐项一行对齐）", async () => {
    const te = await makeTestEditor("- 甲\n- 乙\n- 丙");
    expect(pmPosToLineCol(te.editor, 3)).toEqual({ line: 0, col: 0 });
    expect(pmPosToLineCol(te.editor, 8)).toEqual({ line: 1, col: 0 });
    expect(pmPosToLineCol(te.editor, 13)).toEqual({ line: 2, col: 0 });
  });

  it("空段落计一行空行（连续段落间空行行首映射）", async () => {
    const te = await makeTestEditor("第一段\n\n第三段");
    // 中间空段落：行 1 为空行，行首映射落在空段落内位置
    expect(lineColToPmPos(te.editor, { line: 1, col: 0 })).toBe(6);
  });
});

describe("pmPosToLineCol 边界与近似口径", () => {
  it("空文档：映射原点不崩溃", async () => {
    const te = await makeTestEditor();
    expect(pmPosToLineCol(te.editor, 0)).toEqual({ line: 0, col: 0 });
  });

  it("标题+段落：行号对齐（序列化前缀列漂移属既定近似）", async () => {
    const te = await makeTestEditor("# 标题\n\n正文段落");
    // 标题文本首字符（markdown 中该行首是 "# " 前缀，列漂移但行号对齐）
    expect(pmPosToLineCol(te.editor, 1)).toEqual({ line: 0, col: 0 });
    expect(pmPosToLineCol(te.editor, 5)).toEqual({ line: 1, col: 0 });
  });

  it("行内硬换行计一行（同段落折两行）", async () => {
    const te = await makeTestEditor("第一行");
    const hardbreak = te.view.state.schema.nodes.hardbreak?.create();
    expect(hardbreak).toBeTruthy();
    te.setSelection(4, 4);
    te.view.dispatch(te.view.state.tr.replaceSelectionWith(hardbreak!));
    te.insertText("第二行");
    // 硬换行后首字符 → 行 1 行首；硬换行本身 → 行 0 行尾
    expect(pmPosToLineCol(te.editor, 5)).toEqual({ line: 1, col: 0 });
    expect(pmPosToLineCol(te.editor, 4)).toEqual({ line: 0, col: 3 });
  });

  it("行内原子节点（图片）不产列偏移（近似口径）且不崩溃", async () => {
    const te = await makeTestEditor("前");
    const image = te.view.state.schema.nodes.image?.create({ src: "x.png" });
    expect(image).toBeTruthy();
    te.setSelection(2, 2);
    te.view.dispatch(te.view.state.tr.replaceSelectionWith(image!));
    // 图片前后光标位均映射 col 1（原子节点不占列，既定近似口径）
    expect(pmPosToLineCol(te.editor, 2)).toEqual({ line: 0, col: 1 });
    expect(pmPosToLineCol(te.editor, 3)).toEqual({ line: 0, col: 1 });
  });

  it("叶子块（水平线）不产文本不崩溃", async () => {
    const te = await makeTestEditor("上文");
    const hr = te.view.state.schema.nodes.hr?.create();
    expect(hr).toBeTruthy();
    const size = te.view.state.doc.content.size;
    te.view.dispatch(te.view.state.tr.insert(size, hr!));
    expect(pmPosToLineCol(te.editor, 2)).toEqual({ line: 0, col: 1 });
  });

  it("长行：万字符段落首尾映射正确", async () => {
    const te = await makeTestEditor("x".repeat(10000));
    expect(pmPosToLineCol(te.editor, 1)).toEqual({ line: 0, col: 0 });
    expect(pmPosToLineCol(te.editor, 10000)).toEqual({ line: 0, col: 9999 });
  });

  it("越界收敛：pos 超文档尾映射末行行尾", async () => {
    const te = await makeTestEditor("一二三");
    expect(pmPosToLineCol(te.editor, 99999)).toEqual({ line: 0, col: 3 });
  });
});

describe("lineColToPmPos 基础映射与越界收敛", () => {
  it("单段落：行列还原文档偏移（与 pmPosToLineCol 互逆）", async () => {
    const te = await makeTestEditor("一二三四五六七八九十");
    expect(lineColToPmPos(te.editor, { line: 0, col: 0 })).toBe(1);
    expect(lineColToPmPos(te.editor, { line: 0, col: 2 })).toBe(3);
  });

  it("多段落：次行行首映射段落首字符位置", async () => {
    const te = await makeTestEditor("第一段\n\n第二段");
    expect(lineColToPmPos(te.editor, { line: 1, col: 0 })).toBe(6);
    expect(lineColToPmPos(te.editor, { line: 0, col: 3 })).toBe(4);
  });

  it("行号越界收敛文档尾（语义对齐 reveal-range 越界收敛）", async () => {
    const te = await makeTestEditor("一二三");
    expect(lineColToPmPos(te.editor, { line: 99, col: 0 })).toBe(te.view.state.doc.content.size);
  });

  it("列越界收敛行尾（单段落即文档尾）", async () => {
    const te = await makeTestEditor("一二三");
    expect(lineColToPmPos(te.editor, { line: 0, col: 99999 })).toBe(te.view.state.doc.content.size);
  });

  it("空文档：任意映射收敛文档尾不崩溃", async () => {
    const te = await makeTestEditor();
    expect(lineColToPmPos(te.editor, { line: 0, col: 0 })).toBe(te.view.state.doc.content.size);
  });
});

describe("双向往返（AC-M-7 光标恢复口径）", () => {
  it("多段落随机行列往返落在原偏移附近（同一行内收敛）", async () => {
    const te = await makeTestEditor("第一段\n\n第二段更长\n\n第三段");
    for (const pos of [1, 4, 6, 9, 15]) {
      const { line, col } = pmPosToLineCol(te.editor, pos);
      const restored = lineColToPmPos(te.editor, { line, col });
      // 往返偏差 ≤ 1 位置（块边界归一化造成 ±1 收敛）
      expect(Math.abs(restored - pos)).toBeLessThanOrEqual(1);
    }
  });

  it("undo 后映射随文档收缩（以当前文档为计算源，不缓存旧结构）", async () => {
    const te = await makeTestEditor("一二三");
    te.setSelection(4, 4);
    te.insertText("四五");
    // 插入后「五」在 col 4
    expect(pmPosToLineCol(te.editor, 5)).toEqual({ line: 0, col: 4 });
    undo(te.view.state, te.view.dispatch);
    expect(te.getMarkdown()).toBe("一二三");
    // 同一偏移在收缩后的文档上映射为行尾（col 3），证明映射读取当前文档
    expect(pmPosToLineCol(te.editor, 5)).toEqual({ line: 0, col: 3 });
  });
});
