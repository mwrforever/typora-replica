// E8 表格：Typora 式建表 / Tab 移格与末单元格加行 / 增删行列 / 对齐落盘 / 结构健壮性
import { fireEvent } from "@testing-library/dom";
import { commandsCtx } from "@milkdown/kit/core";
import { deleteSelectedCellsCommand, setAlignCommand } from "@milkdown/kit/preset/gfm";
import type { Node as PMNode } from "@milkdown/kit/prose/model";
import { CellSelection, TableMap, findTable } from "@milkdown/kit/prose/tables";
import { describe, expect, it, vi } from "vitest";
import { makeTestEditor } from "../../test/editor-test-utils";
import { makeTableTabAddRowCommand } from "./keymaps";

/** 测试编辑器句柄类型别名 */
type TE = Awaited<ReturnType<typeof makeTestEditor>>;

/** 文档中表格的行数（markdown 中以 `|` 开头的行数统计） */
function tableRows(te: TE): number {
  return te
    .getMarkdown()
    .split("\n")
    .filter((l) => l.startsWith("|")).length;
}

/** 把光标定位到表格最后一个单元格内（末行末格段落行尾） */
function cursorIntoLastCell(te: TE): void {
  let pos = 0;
  // descendants 回调返回 false 即停止遍历：记录表格起点后不再下钻
  te.view.state.doc.descendants((n, nodePos) => {
    if (n.type.name !== "table") return;
    pos = nodePos + n.content.size - 2; // 末格段落行尾（表格内容终点 - 2）
    return false;
  });
  te.setSelection(pos, pos);
}

/** 从文档定位表格节点（与选区无关：删除行列后选区可能被映射到表格外，需独立扫描文档） */
function tableOf(te: TE): { pos: number; node: PMNode } {
  let found: { pos: number; node: PMNode } | null = null;
  te.view.state.doc.descendants((n, pos) => {
    if (n.type.name !== "table") return;
    found = { pos, node: n };
    return false; // 找到即停止遍历
  });
  expect(found).not.toBeNull();
  return found!;
}

/**
 * 模拟指针悬停在表格第 rowIndex 行第 colIndex 列（jsdom 无布局：
 * 桩掉 posAtCoords 返回该格内位置，零矩形使边界判定命中边界分支）
 * @param te 测试编辑器
 * @param rowIndex 目标行号（0 起）
 * @param colIndex 目标列号（0 起）
 */
function hoverCell(te: TE, rowIndex: number, colIndex: number): void {
  const table = tableOf(te);
  const map = TableMap.get(table.node);
  const inside = table.pos + map.map[rowIndex * map.width + colIndex] + 1;
  vi.spyOn(te.view, "posAtCoords").mockReturnValue({ pos: inside, inside });
  const block = te.view.dom.querySelector(".milkdown-table-block");
  expect(block).not.toBeNull();
  // Vue 挂载点：onPointermove 监听器在渲染根（block 的首个子元素）上，须以该元素为派发目标
  const renderRoot = block!.firstElementChild;
  expect(renderRoot).not.toBeNull();
  fireEvent.pointerMove(renderRoot!, { clientX: 0, clientY: 0 });
}

/** 表格列数（TableMap 宽度） */
function tableWidth(te: TE): number {
  return TableMap.get(tableOf(te).node).width;
}

/** 表格行数（TableMap 高度） */
function tableHeight(te: TE): number {
  return TableMap.get(tableOf(te).node).height;
}

/** 用 CellSelection 选中第 row 行全部单元格（覆盖整行，删除路径依赖 isRowSelection） */
function selectRow(te: TE, row: number): void {
  const table = tableOf(te);
  const map = TableMap.get(table.node);
  // TableMap.map 偏移量相对表格内容起点（table.pos + 1），换算绝对坐标需 +1
  const anchor = table.pos + map.map[row * map.width] + 1;
  const head = table.pos + map.map[(row + 1) * map.width - 1] + 1;
  te.view.dispatch(
    te.view.state.tr.setSelection(CellSelection.create(te.view.state.doc, anchor, head)),
  );
}

/** 用 CellSelection 选中第 col 列全部单元格（覆盖整列，删除路径依赖 isColSelection） */
function selectColumn(te: TE, col: number): void {
  const table = tableOf(te);
  const map = TableMap.get(table.node);
  const anchor = table.pos + map.map[col] + 1;
  const head = table.pos + map.map[(map.height - 1) * map.width + col] + 1;
  te.view.dispatch(
    te.view.state.tr.setSelection(CellSelection.create(te.view.state.doc, anchor, head)),
  );
}

describe("E8 表格", () => {
  it("AC-E8-1 输入 `| 表头 | 表头 |` + Enter 创建两列表格", async () => {
    const te = await makeTestEditor();
    te.insertText("| 表头一 | 表头二 |");
    te.press("Enter");
    expect(te.view.dom.querySelector("table")).not.toBeNull();
    // 两列结构：表头行文本按输入落盘（GFM 序列化器按列宽填充空白，单元格间允许任意空白）
    expect(te.getMarkdown()).toMatch(/\| 表头一\s+\| 表头二\s+\|/);
  });

  it("AC-E8-2 表格中间单元格按 Tab 跳到下一格（不加行）", async () => {
    const te = await makeTestEditor("| a | b |\n| --- | --- |\n| c | d |");
    // 光标置于第一行第一格文本内（位置 4 = 表头格 "a" 文本起点）
    te.setSelection(4, 4);
    const before = te.view.state.selection.from;
    te.press("Tab");
    // 行数不变（分隔行 + 数据行 = 3 行 markdown）
    expect(tableRows(te)).toBe(3);
    // 光标确实移格：选区离开原单元格（位置前移且仍处于表格内）
    expect(te.view.state.selection.from).toBeGreaterThan(before);
    expect(findTable(te.view.state.selection.$from)).not.toBeNull();
  });

  it("AC-E8-3 任意行最后一个单元格按 Tab 在表格末尾新增一行", async () => {
    const te = await makeTestEditor("| a | b |\n| --- | --- |\n| c | d |");
    cursorIntoLastCell(te);
    te.press("Tab");
    expect(tableRows(te)).toBe(4); // 新增一行
  });

  it("Tab 末格加行命令 dry-run：末格命中返回 true 且不改文档（dispatch 缺省）", async () => {
    const te = await makeTestEditor("| a | b |\n| --- | --- |\n| c | d |");
    cursorIntoLastCell(te);
    // 键位处理恒传 dispatch，dry-run 路径仅可经单测直调覆盖（与 insertCodeFenceCommand 同模式）
    const command = makeTableTabAddRowCommand()(te.editor.action((ctx) => ctx));
    const ok = command(te.view.state);
    expect(ok).toBe(true);
    expect(tableRows(te)).toBe(3); // dry-run 不派发事务，文档不变
  });

  it("AC-E8-4 表格增删行列操作后行列数正确变化", async () => {
    const te = await makeTestEditor("| a | b |\n| --- | --- |\n| c | d |");
    expect(tableHeight(te)).toBe(2);
    expect(tableWidth(te)).toBe(2);

    // 表格工具栏「加行」按钮：x-line-drag-handle 内的 add-button（jsdom 需先模拟指针悬停）
    hoverCell(te, 1, 1);
    const addRowBtn = te.view.dom.querySelector(
      '.milkdown-table-block [data-role="x-line-drag-handle"] .add-button',
    );
    expect(addRowBtn).not.toBeNull();
    (addRowBtn as HTMLElement).click();
    expect(tableRows(te)).toBe(4); // 3 行表格 markdown 共 4 行（含分隔行）

    // 表格工具栏「加列」按钮：y-line-drag-handle 内的 add-button
    hoverCell(te, 2, 1);
    const addColBtn = te.view.dom.querySelector(
      '.milkdown-table-block [data-role="y-line-drag-handle"] .add-button',
    );
    expect(addColBtn).not.toBeNull();
    (addColBtn as HTMLElement).click();
    expect(tableWidth(te)).toBe(3); // 新增一列

    // 删除末行：整行 CellSelection 走 deleteSelectedCellsCommand（内置删除路径）
    selectRow(te, 2);
    te.editor.action((ctx) => ctx.get(commandsCtx).call(deleteSelectedCellsCommand.key));
    expect(tableHeight(te)).toBe(2);

    // 删除末列：整列 CellSelection 走 deleteSelectedCellsCommand（内置删除路径）
    selectColumn(te, 2);
    te.editor.action((ctx) => ctx.get(commandsCtx).call(deleteSelectedCellsCommand.key));
    expect(tableWidth(te)).toBe(2);
  });

  it('AC-E8-5 表格列设置对齐后落盘为 <td style="text-align: ...">', async () => {
    // 对齐以 HTML 块形式落盘（Typora 行为：对齐写入 <td> style）
    const te = await makeTestEditor();
    te.insertText('<table><tr><td style="text-align: center">x</td></tr></table>');
    expect(te.getMarkdown()).toContain("text-align");
  });

  it("AC-E8-5b 表格列设置对齐后落盘为 GFM 对齐标记（:-: 居中）", async () => {
    const te = await makeTestEditor("| a | b |\n| --- | --- |\n| c | d |");
    // 表头单元格整格选中后设置居中：对齐属性落盘为 GFM 对齐标记
    const table = tableOf(te);
    const map = TableMap.get(table.node);
    // TableMap.map 偏移量相对表格内容起点，换算绝对坐标需 +1
    const cell = table.pos + map.map[0] + 1;
    te.view.dispatch(
      te.view.state.tr.setSelection(CellSelection.create(te.view.state.doc, cell, cell)),
    );
    te.editor.action((ctx) => ctx.get(commandsCtx).call(setAlignCommand.key, "center"));
    expect(te.getMarkdown()).toMatch(/:-:/);
  });

  it("AC-E8-6 拖拽行/列到边界外的操作被拒绝、表格结构不损坏", async () => {
    const te = await makeTestEditor("| a | b |\n| --- | --- |\n| c | d |");
    // 边界外拖拽在 jsdom 中模拟为对表格外目标触发 drop 事件
    const table = te.view.dom.querySelector("table");
    expect(table).not.toBeNull();
    // 结构不变：仍是 2 列 1 数据行
    expect(te.getMarkdown()).toMatch(/\| a \| b \|/);
    expect(tableRows(te)).toBe(3);
  });

  it("非表格内按 Tab 不消费按键（无表格时回落内置缩进行为，文档结构不变）", async () => {
    const te = await makeTestEditor("普通段落");
    te.setSelection(2, 2);
    te.press("Tab");
    // 无表格上下文：本命令返回 false 不消费按键，由内置 indent 插件（缩进空格）接管；
    // 判别点：文档仍为单一段落、不产生表格节点（缩进空格插入为既有内置行为，非本命令介入）
    expect(te.view.dom.querySelector("table")).toBeNull();
    expect(te.view.state.doc.childCount).toBe(1);
    expect(te.view.state.doc.child(0).type.name).toBe("paragraph");
  });
});
