import { describe, expect, it } from "vitest";
import { createSearchEntry } from "./search-entry";

// 全局搜索入口（03 文件树，F12）：输入/提交事件透传测试（简报 Task 12 用例逐字）
describe("search-entry", () => {
  it("handleInput/handleSubmit 透传查询事件", () => {
    const reqs: string[] = [];
    const entry = createSearchEntry((r) => reqs.push(r.query));
    entry.handleInput("foo");
    entry.handleSubmit("bar");
    expect(reqs).toEqual(["foo", "bar"]);
  });

  it("未传回调时不抛错", () => {
    const entry = createSearchEntry();
    expect(() => entry.handleInput("x")).not.toThrow();
  });
});
