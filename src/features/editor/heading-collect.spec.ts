// collectHeadings 共享收集函数用例（05 大纲 Task 3，AC-F23-1 唯一数据源）
//
// 验证三件事：① 层级/文本/位置/锚点 id 四元组按文档序收集（嵌套容器内标题同样入列，
// id 断言依赖 anchor-id 插件写入 attrs.id）；② 无标题文档返回空数组（FM title 不进
// 文档树，天然不入列）；③ 空文本标题跳过，与锚点插件的跳过语义一致。
import { afterEach, describe, expect, it } from "vitest";
import { destroyTestEditors, makeTestEditor } from "../../test/editor-test-utils";
import { collectHeadings } from "./heading-collect";

describe("collectHeadings 标题收集", () => {
  afterEach(async () => {
    await destroyTestEditors();
  });

  it("收集层级/文本/位置/id，嵌套容器内的标题同样入列", async () => {
    const { view } = await makeTestEditor("# 一级\n\n## 二级\n\n> ### 引用内三级");
    const items = collectHeadings(view.state.doc);
    expect(items.map((h) => [h.level, h.text])).toEqual([
      [1, "一级"],
      [2, "二级"],
      [3, "引用内三级"],
    ]);
    expect(items.map((h) => h.id)).toEqual(["一级", "二级", "引用内三级"]);
    // pos 单调递增且指向各自节点起点
    expect(items[0].pos).toBeLessThan(items[1].pos);
    expect(items[1].pos).toBeLessThan(items[2].pos);
  });

  it("空文档返回空数组；FM title 天然不入列（不进文档树）", async () => {
    const { view } = await makeTestEditor("正文没有标题");
    expect(collectHeadings(view.state.doc)).toEqual([]);
  });

  it("空文本标题不入列（与锚点插件跳过语义一致）", async () => {
    const { view } = await makeTestEditor("# \n\n# 实标题");
    const items = collectHeadings(view.state.doc);
    expect(items.map((h) => h.text)).toEqual(["实标题"]);
  });
});
