// 官方 prosemirror-search 装配行为钉桩（06 P1 基座，spike 常驻防库改名静默失效）
// 断言口径全部走 DOM/命令可观察行为，不触插件内部 state（版本演进安全）
import { afterEach, describe, expect, it } from "vitest";
import { SearchQuery, findNext, replaceAll, setSearchState } from "prosemirror-search";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { destroyTestEditors, makeTestEditor } from "../../test/editor-test-utils";

/** 派发查询并返回当前 DOM 中普通/激活匹配类数量 */
function decoCounts(view: EditorView): { normal: number; active: number } {
  return {
    normal: view.dom.querySelectorAll(".ProseMirror-search-match").length,
    active: view.dom.querySelectorAll(".ProseMirror-active-search-match").length,
  };
}

describe("prosemirror-search 装配", () => {
  afterEach(async () => {
    await destroyTestEditors();
  });

  it("setSearchState 派发查询后 DOM 高亮全部匹配，选区命中处出现 active 类", async () => {
    const te = await makeTestEditor("hello world hello");
    const query = new SearchQuery({ search: "hello" });
    te.view.dispatch(setSearchState(te.view.state.tr, query));
    expect(decoCounts(te.view)).toEqual({ normal: 2, active: 0 });

    // 选区移到第二处匹配（从第一处终点起 findNext）→ 该处转 active
    const first = query.findNext(te.view.state, 0);
    const second = query.findNext(te.view.state, first!.to);
    expect(second).not.toBeNull();
    te.view.dispatch(
      te.view.state.tr.setSelection(
        // TextSelection.create 经 tr.setSelection 的标准路径
        TextSelection.create(te.view.state.doc, second!.from, second!.to),
      ),
    );
    expect(decoCounts(te.view)).toEqual({ normal: 1, active: 1 });
  });

  it("valid 为只读属性：空串/非法正则为 false，合法查询为 true（AC-F25-5 底座）", () => {
    expect(new SearchQuery({ search: "" }).valid).toBe(false);
    expect(new SearchQuery({ search: "(", regexp: true }).valid).toBe(false);
    expect(new SearchQuery({ search: "a+" }).valid).toBe(true);
  });

  it("wholeWord 用 Unicode \\p{L} 词界：「中文」在『学中文课 中文』仅命中第二处（AC-F25-6 语义钉）", async () => {
    // 注：夹具第二处必须是无字母邻接的裸「中文」——若尾随「课」（\p{L}），词界
    // 不成立该处同样被拒（1.1.1 实测，计划原夹具『学中文课 中文课』两处均拒）
    const te = await makeTestEditor("学中文课 中文");
    const query = new SearchQuery({ search: "中文", wholeWord: true });
    te.view.dispatch(setSearchState(te.view.state.tr, query));
    // 第一处两侧均为汉字（\p{L}）→ 词界不成立被忽略；第二处前为空格/文首后为文尾 → 命中
    expect(decoCounts(te.view).normal + decoCounts(te.view).active).toBe(1);
  });

  it("wholeWord ASCII 数字邻接钉桩：cat 对『concatenate cat cat2』DOM 高亮 2 处（JS \\p{L} 词界）", async () => {
    // 钉住 JS 引擎词界语义并与 io/search.rs 头注分引擎陈述互证：concatenate
    // 内部 cat 左邻字母 → 拒；裸 cat → 命中；cat2 尾邻数字 2 在 \p{L} 判据下
    // 属边界 → 命中（Rust \b 把数字当词字符故全局面板同查询不命中，spec §11 披露）
    const te = await makeTestEditor("concatenate cat cat2");
    const query = new SearchQuery({ search: "cat", wholeWord: true });
    te.view.dispatch(setSearchState(te.view.state.tr, query));
    expect(decoCounts(te.view).normal + decoCounts(te.view).active).toBe(2);
  });

  it("findNext 从当前选区起跳且文档尾回绕（AC-F24-3 引擎语义）", async () => {
    const te = await makeTestEditor("甲乙甲");
    const query = new SearchQuery({ search: "甲" });
    te.view.dispatch(setSearchState(te.view.state.tr, query));
    // 光标放到最后一处「甲」上（段落内文本偏移 +1：两处为 1..2 与 3..4），
    // findNext 向前无匹配 → 应回绕到第一处（1..2）
    const firstAt = query.findNext(te.view.state, 0)!;
    const lastAt = query.findNext(te.view.state, firstAt.to)!;
    expect(lastAt.from).toBe(3);
    te.view.dispatch(
      te.view.state.tr.setSelection(
        TextSelection.create(te.view.state.doc, lastAt.from, lastAt.to),
      ),
    );
    let dispatched = false;
    const ok = findNext(te.view.state, (tr) => {
      dispatched = true;
      te.view.dispatch(tr);
    });
    expect(ok && dispatched).toBe(true);
    expect(te.view.state.selection.from).toBe(1);
    expect(te.view.state.selection.to).toBe(2);
  });

  it("replaceAll 单事务完成 $n 捕获组交换（AC-F25-2/3 引擎语义）", async () => {
    const te = await makeTestEditor("a@b c@d");
    const query = new SearchQuery({
      search: "(\\w+)@(\\w+)",
      replace: "$2@$1",
      regexp: true,
    });
    te.view.dispatch(setSearchState(te.view.state.tr, query));
    let dispatchCount = 0;
    replaceAll(te.view.state, (tr) => {
      dispatchCount += 1;
      te.view.dispatch(tr);
    });
    expect(dispatchCount).toBe(1); // 全部替换合并单事务 → 一次 Ctrl+Z 全撤的前提
    expect(te.view.state.doc.textBetween(0, te.view.state.doc.content.size, "\n")).toBe("b@a d@c");
  });
});
