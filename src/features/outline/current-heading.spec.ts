// 双通道活动标题判定纯函数用例（05 大纲 Task 5，AC-F19-2/3）
//
// 编辑通道走真实 Crepe 文档（anchor-id 插件同源写 id：英文 slug 小写化），
// 滚动通道纯数据驱动，不依赖 DOM 布局。
import { afterEach, describe, expect, it } from "vitest";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { destroyTestEditors, makeTestEditor } from "../../test/editor-test-utils";
import { collectHeadings } from "../editor/heading-collect";
import { activeIdByPos, pickActiveByTop } from "./current-heading";

describe("activeIdByPos 编辑通道", () => {
  afterEach(async () => {
    await destroyTestEditors();
  });

  it("activeIdByPos：光标上溯命中标题祖先；正文光标回退取 pos 之前最近标题（AC-F19-2）", async () => {
    const { view } = await makeTestEditor("# A\n\n## B\n\n正文段落");
    const doc = view.state.doc;
    const headings = collectHeadings(doc);
    // 光标在「## B」标题文本内（pos 落在 B 文本区间；findTextPos 找不到目标会抛错，
    // 等价承担夹具自检职责——本版 prosemirror 的 doc.text 非字符串，不可用 indexOf 预判）
    const inB = findTextPos(doc, "B");
    expect(activeIdByPos(headings, doc, inB)).toBe("b");
    // 光标在正文段落内（无标题祖先）→ 最近前置标题 B
    const bodyPos = findTextPos(doc, "正文段落");
    expect(activeIdByPos(headings, doc, bodyPos)).toBe("b");
  });

  it("命中未编号标题（空文本）返回空串，调用方按无高亮处理", async () => {
    // 空文本标题被 anchor-id 插件跳过编号：attrs.id 保持 schema 默认空串
    const { view } = await makeTestEditor("# \n\n正文");
    const doc = view.state.doc;
    // 空标题节点内部位置（「# 」标题起点 +1 落在节点开闭标记之间）
    expect(activeIdByPos(collectHeadings(doc), doc, 1)).toBe("");
  });

  it("回退通道忽略 pos 之后的标题，仅取最近前置条目", async () => {
    const { view } = await makeTestEditor("# A\n\n## B\n\n正文段落\n\n## C");
    const doc = view.state.doc;
    const headings = collectHeadings(doc);
    const bodyPos = findTextPos(doc, "正文段落");
    // 光标前有 A/B、后有 C：取最近的 B，后方 C 不参与判定
    expect(activeIdByPos(headings, doc, bodyPos)).toBe("b");
  });
});

describe("pickActiveByTop 滚动通道", () => {
  it("pickActiveByTop：取最后一个 top ≤ 阈值的条目；全部越阈返回 undefined（AC-F19-3）", () => {
    const candidates = [
      { id: "a", top: 10 },
      { id: "b", top: 60 },
      { id: "c", top: 120 },
    ];
    expect(pickActiveByTop(candidates, 100)).toBe("b");
    expect(pickActiveByTop(candidates, 5)).toBeUndefined();
    expect(pickActiveByTop([], 100)).toBeUndefined();
  });
});

/** 定位首个包含目标文本的 text 节点内该文本的起点（测试私有工具） */
function findTextPos(doc: ProseMirrorNode, target: string): number {
  let found: number | undefined;
  doc.descendants((node, pos) => {
    if (found !== undefined) return false; // 已定位，停止下钻
    if (node.isText && node.text !== undefined && node.text.includes(target)) {
      found = pos + node.text.indexOf(target);
      return false;
    }
    return true;
  });
  if (found === undefined) throw new Error(`测试夹具未找到目标文本：${target}`);
  return found;
}
