// search-query 纯函数层用例（100% 覆盖组）：真实 makeTestEditor 构造 doc/state
import { afterEach, describe, expect, it } from "vitest";
import { SearchQuery } from "prosemirror-search";
import { destroyTestEditors, makeTestEditor } from "../../test/editor-test-utils";
import {
  MATCH_ITER_LIMIT,
  activeMatchIndex,
  buildSearchQuery,
  collectMatches,
  nthMatch,
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

describe("nthMatch / activeMatchIndex", () => {
  afterEach(async () => {
    await destroyTestEditors();
  });

  it("按序号取匹配：同段多次命中逐序可取；越界返回 undefined", async () => {
    const te = await makeTestEditor("目标 目标二");
    const q = new SearchQuery({ search: "目标" });
    const m0 = nthMatch(te.view.state, q, 0);
    expect(m0).not.toBeUndefined();
    if (!m0) return;
    expect(te.view.state.doc.textBetween(m0.from, m0.to)).toBe("目标");
    const m1 = nthMatch(te.view.state, q, 1);
    expect(m1).not.toBeUndefined();
    if (!m1) return;
    expect(te.view.state.doc.textBetween(m1.from, m1.to)).toBe("目标");
    expect(nthMatch(te.view.state, q, 2)).toBeUndefined();
  });

  it("多段落空行不影响命中序：序号纯按文档序累计（跨文件对齐底座）", async () => {
    // 源码含单空行与连续双空行：PM 文档模型丢弃空行，命中序不受其影响
    const te = await makeTestEditor("甲\n\n乙 甲\n\n\n甲尾");
    const q = new SearchQuery({ search: "甲" });
    const texts = [0, 1, 2].map((i) => {
      const m = nthMatch(te.view.state, q, i);
      return m ? te.view.state.doc.textBetween(m.from, m.to) : null;
    });
    expect(texts).toEqual(["甲", "甲", "甲"]);
    expect(nthMatch(te.view.state, q, 3)).toBeUndefined();
  });

  it("非法序号守卫：负数/非整数/达迭代上限一律拒绝（外部扫描输入不可信）", async () => {
    const te = await makeTestEditor("甲");
    const q = new SearchQuery({ search: "甲" });
    expect(nthMatch(te.view.state, q, -1)).toBeUndefined();
    expect(nthMatch(te.view.state, q, 1.5)).toBeUndefined();
    expect(nthMatch(te.view.state, q, Number.NaN)).toBeUndefined();
    expect(nthMatch(te.view.state, q, MATCH_ITER_LIMIT)).toBeUndefined();
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
