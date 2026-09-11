// 源码模式位置映射（01 编辑核心对外接口；模块 01 spec §5 2026-09-10 增补，缺口 A）
//
// 职责：WYSIWYG 文档位置（PM 偏移）↔ 源码行列号 的双向近似映射，供 12 源码模式
// 双向切换时恢复光标消费（模块 12 spec AC-M-7：切回光标落在同一行/字符附近）。
//
// 行列口径（MVP 近似制，验收 = 「同一行/字符附近」，非逐字符精确）：
// - 行（line，0 起）：按文档块结构拆行——兄弟块边界计一个换行、行内硬换行
//   （hardbreak）计一个换行、代码块内容内嵌换行按字符原样计数；空块（空段落）
//   自然产生空行。该口径与 markdown 序列化的行结构大体对齐（段落/标题/列表项/
//   引用块/表格行各占一行）。
// - 列（col，0 起）：行内 UTF-16 码元偏移（与 JS 字符串 length / CodeMirror 位置
//   口径一致）。序列化符号（标题 "# "、列表 "- "、强调标记等）不在文档文本内，
//   含此类前缀的行列会相对 markdown 源码左漂；行内原子节点（图片等）不占列——
//   行号对齐是本映射的精度承诺，列仅近似（既定口径，随 PR 披露）。
// - Front Matter 不进文档树（E11），本映射一律正文口径；源码全文的行偏移由
//   消费方（12 切换状态机）折算。
//
// 实现形态：单次遍历文档构建「虚拟文本 + 逐字符 PM 位置表」，两方向映射均为
// 对当前文档的线性扫描（纯函数语义：只读状态、无副作用、无缓存，undo 后即时
// 反映收缩后文档）。PM Node 类型仅在本文件内部出现，对外签名只有 Editor /
// number / LineCol JSON 值对象（宪法 A.7.4：PM 类型不出 01 域；Editor 实例形参
// 同 revealRange 先例）。
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";

/** 行列坐标（JSON 值对象；line/col 均 0 起） */
export interface LineCol {
  /** 行号（0 起；按文档块结构拆行口径） */
  line: number;
  /** 行内 UTF-16 码元偏移（0 起） */
  col: number;
}

/** 虚拟文本中的换行分隔（块边界与硬换行的统一表示） */
const NEWLINE = "\n";

/** 文档虚拟文本与逐字符 PM 位置表（两数组按码元一一对齐） */
interface DocTextTrace {
  /** 虚拟文本（块边界以 \n 表示；不含块定界符等序列化符号） */
  text: string;
  /** text 第 i 个码元对应的 PM 文档偏移（严格递增；\n 归前块内容末位置） */
  positions: number[];
}

/**
 * 深度优先遍历文档块树，构建虚拟文本与位置表
 * @param doc 目标文档（只读遍历，不改状态）
 * @returns 虚拟文本与位置表；空文档返回双空数组
 */
function collectDocText(doc: ProseMirrorNode): DocTextTrace {
  let text = "";
  const positions: number[] = [];
  /** 追加一段文本：逐 UTF-16 码元登记位置（PM 偏移按码元推进，禁止按码点） */
  const push = (chunk: string, start: number): void => {
    for (let i = 0; i < chunk.length; i++) {
      text += chunk.charAt(i);
      positions.push(start + i);
    }
  };
  /**
   * 递归遍历块节点
   * @param node 当前块节点（文本节点由调用方分流，不进本函数）
   * @param start 节点开标记位置（doc 根传 -1：文档内容自 0 起）
   * @returns 遍历完成后的位置（越过闭标记；叶子块为 start + nodeSize）
   */
  const walk = (node: ProseMirrorNode, start: number): number => {
    // 叶子块（水平线等原子块）：不产文本，仅消耗一个节点位（近似口径）
    if (node.isLeaf) return start + node.nodeSize;
    let pos = start + 1; // 跳过开标记进入内容
    let sawBlockChild = false;
    node.forEach((child) => {
      if (child.isText) {
        // 不变量：文本节点 text 恒非空（PM 文档模型保证），断言收窄类型
        push(child.text!, pos);
        pos += child.text!.length;
      } else if (child.isBlock) {
        // 兄弟块之间补换行（首个块子节点前不加）；边界位置归前块内容末，
        // 使「上一行行尾」与「下一行行首」两个光标位都落回真实文档位置
        if (sawBlockChild) push(NEWLINE, pos - 1);
        pos = walk(child, pos);
        sawBlockChild = true;
      } else if (child.type.name === "hardbreak") {
        // 行内硬换行：markdown 序列化为换行，计一行
        push(NEWLINE, pos);
        pos += child.nodeSize;
      } else {
        // 其余行内原子节点（图片等）：不产文本，仅推进位置（列近似口径）
        pos += child.nodeSize;
      }
    });
    return pos + 1; // 越过闭标记
  };
  walk(doc, -1);
  return { text, positions };
}

/**
 * PM 文档位置 → 行列（对当前文档线性扫描，纯函数语义）
 * @param editor 目标编辑器实例
 * @param pmPos 文档偏移（插入点语义：光标位早于全部文本含空文档映射原点
 *              {line:0,col:0}；块内容末映射行尾列；越界收敛文档末行行尾）
 * @returns 行列坐标（口径见文件头注释）
 */
export function pmPosToLineCol(editor: Editor, pmPos: number): LineCol {
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  const { text, positions } = collectDocText(view.state.doc);
  // 插入点语义：统计位置严格小于 pmPos 的码元数——「行末字符之后」的光标位
  // （块内容末）映射为行尾列（col = 行长），而非末字符所在列
  let idx = 0;
  while (idx < positions.length && positions[idx]! < pmPos) idx++;
  // idx 之前的换行数即行号；距最近换行的距离即列号
  let line = 0;
  let lastNewline = -1;
  for (let i = 0; i < idx; i++) {
    if (text.charAt(i) === NEWLINE) {
      line++;
      lastNewline = i;
    }
  }
  return { line, col: idx - lastNewline - 1 };
}

/**
 * 行列 → PM 文档位置（对当前文档线性扫描，纯函数语义）
 * @param editor 目标编辑器实例
 * @param pos 行列坐标；行号越界或文档无文本时收敛文档尾（语义对齐
 *            reveal-range 越界收敛）；列越界收敛该行行尾
 * @returns PM 文档偏移（可直接交 revealRange 设置选区）
 */
export function lineColToPmPos(editor: Editor, pos: LineCol): number {
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  const { text, positions } = collectDocText(view.state.doc);
  // 定位目标行首：跳过 pos.line 个换行
  let i = 0;
  let line = 0;
  while (i < text.length && line < pos.line) {
    if (text.charAt(i) === NEWLINE) line++;
    i++;
  }
  if (line < pos.line) {
    // 行号越界：收敛文档尾
    return view.state.doc.content.size;
  }
  // 行内推进 pos.col：遇换行或文本尾即停（行尾/文档尾收敛）
  let col = 0;
  while (col < pos.col && i < text.length && text.charAt(i) !== NEWLINE) {
    i++;
    col++;
  }
  // i 指向目标码元（或行尾换行/文本尾）；位置表越界 = 文档无文本，收敛文档尾
  return positions[i] ?? view.state.doc.content.size;
}
