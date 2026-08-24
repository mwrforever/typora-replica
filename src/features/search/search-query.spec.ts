// search-query 纯函数层用例（100% 覆盖组）：真实 makeTestEditor 构造 doc/state
import { afterEach, describe, expect, it } from "vitest";
import { SearchQuery } from "prosemirror-search";
import { destroyTestEditors, makeTestEditor } from "../../test/editor-test-utils";
import {
  activeMatchIndex,
  buildSearchQuery,
  collectMatches,
  findMatchOnLine,
} from "./search-query";

describe("buildSearchQuery", () => {
  it("空查询返回 empty；非法正则返回 invalid-regex（AC-F25-5）", () => {
    expect(buildSearchQuery({ query: "" }).status).toBe("empty");
    expect(buildSearchQuery({ query: "(", regexp: true }).status).toBe("invalid-regex");
  });

  it("可匹配空串的正则前置拒绝（防 replaceAll 原地打转）", () => {
    expect(buildSearchQuery({ query: "\\d*", regexp: true }).status).toBe("matches-empty");
    expect(buildSearchQuery({ query: "a*", regexp: true }).status).toBe("matches-empty");
    // 非正则模式永不触发（字面串非空即非空匹配）
    expect(buildSearchQuery({ query: "a*" }).status).toBe("ok");
  });

  it("双保险：本层探测通过但官方 u 标志校验更严时仍拒绝（库语义钉桩）", () => {
    // \u{110000} 超出 Unicode 码点上限：普通 RegExp（非 u）可编译且非空匹配，
    // 官方 validRegExp 以 u 标志构造抛 SyntaxError → SearchQuery.valid=false
    expect(buildSearchQuery({ query: "\\u{110000}", regexp: true }).status).toBe("invalid-regex");
  });

  it("三开关正确透传；替换串携带 $n", () => {
    const built = buildSearchQuery({
      query: "(\\w+)@(\\w+)",
      replacement: "$2@$1",
      caseSensitive: true,
      wholeWord: true,
      regexp: true,
    });
    expect(built.status).toBe("ok");
    if (built.status !== "ok") return;
    expect(built.query.regexp).toBe(true);
    expect(built.query.caseSensitive).toBe(true);
    expect(built.query.wholeWord).toBe(true);
    expect(built.query.replace).toBe("$2@$1");
  });
});

describe("collectMatches", () => {
  afterEach(async () => {
    await destroyTestEditors();
  });

  it("收集全部匹配（跨段落）；大小写不敏感缺省生效", async () => {
    const te = await makeTestEditor("Cat dog cat\n\nCAT bird");
    const matches = collectMatches(te.view.state, new SearchQuery({ search: "cat" }));
    expect(matches.map((m) => te.view.state.doc.textBetween(m.from, m.to))).toEqual([
      "Cat",
      "cat",
      "CAT",
    ]);
  });

  it("max 截断；无效查询返回空数组不抛错", async () => {
    const te = await makeTestEditor("x x x x");
    expect(collectMatches(te.view.state, new SearchQuery({ search: "x" }), 2)).toHaveLength(2);
    expect(collectMatches(te.view.state, new SearchQuery({ search: "(", regexp: true }))).toEqual(
      [],
    );
  });

  it("零长匹配步进守卫：正则可空匹配时不死循环（官方 buildMatchDeco 同款隐患的前置防线）", async () => {
    const te = await makeTestEditor("abc");
    // 绕过 buildSearchQuery 直造可空匹配查询，专测迭代器守卫本身
    const evil = new SearchQuery({ search: "z*", regexp: true });
    const matches = collectMatches(te.view.state, evil, 5);
    expect(matches.length).toBeLessThanOrEqual(5); // 有步进守卫必然终止且不超上限
    for (const m of matches) expect(m.from).toBeLessThan(m.to); // 只收非零长命中
  });
});

describe("findMatchOnLine / activeMatchIndex", () => {
  afterEach(async () => {
    await destroyTestEditors();
  });

  it("行号定位该行首个匹配；无匹配行返回 undefined（AC-F26-2 定位底座）", async () => {
    const te = await makeTestEditor("第一行 无词\n第二行 目标 目标二\n第三行");
    const q = new SearchQuery({ search: "目标" });
    const hit = findMatchOnLine(te.view.state, q, 2);
    expect(hit).not.toBeUndefined();
    if (!hit) return;
    expect(te.view.state.doc.textBetween(hit.from, hit.to)).toBe("目标");
    expect(findMatchOnLine(te.view.state, q, 1)).toBeUndefined();
    expect(findMatchOnLine(te.view.state, q, 99)).toBeUndefined();
  });

  it("activeMatchIndex：光标前最近未越过项优先；越尾回落末项；空集 0", () => {
    const ms = [
      { from: 0, to: 2, match: null, matchStart: 0 },
      { from: 5, to: 7, match: null, matchStart: 5 },
      { from: 9, to: 11, match: null, matchStart: 9 },
    ];
    expect(activeMatchIndex(ms as never, 6)).toBe(1); // head=6 落在第 2 项内
    expect(activeMatchIndex(ms as never, 0)).toBe(0);
    expect(activeMatchIndex(ms as never, 100)).toBe(2);
    expect(activeMatchIndex([], 3)).toBe(0);
  });
});
