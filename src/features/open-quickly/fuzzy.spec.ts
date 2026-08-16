import { describe, expect, it } from "vitest";
import { searchQuickItems, type QuickItem } from "./fuzzy";

function item(path: string, over: Partial<QuickItem> = {}): QuickItem {
  const label = path.split("/").pop() ?? path;
  return { path, label, kind: "file", pinned: false, ...over };
}

describe("Open Quickly 模糊匹配（F11）", () => {
  const items = [
    item("C:/docs/readme.md"),
    item("C:/docs/notes/bread.md"),
    item("C:/docs/README-zh.md"),
    item("C:/docs/sub.md", { pinned: true }),
  ];

  it("空 query 返回原序（全量候选）", () => {
    expect(searchQuickItems("", items)).toHaveLength(4);
  });

  it("包含匹配：不区分大小写", () => {
    const r = searchQuickItems("read", items);
    expect(r.map((x) => x.path)).toEqual([
      "C:/docs/readme.md", // 前缀命中
      "C:/docs/README-zh.md", // 前缀命中（大小写不敏感）
      "C:/docs/notes/bread.md", // 包含（read 在 bread 内，非前缀排后）
    ]);
  });

  it("排序：前缀优先 + 固定项提前 + 名称短优先", () => {
    const r = searchQuickItems("sub", items);
    expect(r[0].path).toBe("C:/docs/sub.md"); // 固定项优先
  });

  it("分数相同时按字典序排序（平局分支）", () => {
    // ab.md 与 cb.md 对 "b" 同为 idx=1 长度 5 → 同分，落入 localeCompare 平局分支
    const r = searchQuickItems("b", [item("C:/y/cb.md"), item("C:/x/ab.md")]);
    expect(r.map((x) => x.path)).toEqual(["C:/x/ab.md", "C:/y/cb.md"]);
  });

  it("前缀命中长名优先于非前缀固定短名（信号冲突：层级不穿越）", () => {
    // book-very-long-name.md 前缀命中但名称长；ab.md 非前缀但固定且短——
    // 前缀命中为最高层级，不得被长度/固定项加权反超
    const r = searchQuickItems("b", [
      item("C:/x/ab.md", { pinned: true }),
      item("C:/x/book-very-long-name.md"),
    ]);
    expect(r.map((x) => x.path)).toEqual(["C:/x/book-very-long-name.md", "C:/x/ab.md"]);
  });

  it("无匹配返回空数组（AC-F11-4）", () => {
    expect(searchQuickItems("zzz", items)).toEqual([]);
  });

  it("排序：同分时固定项恒在前（pinned 比较两方向）", () => {
    // 同 idx、同长度、pinned 不同 → 固定项置前（覆盖 pinned 三目的两个方向分支）
    const r1 = searchQuickItems("b", [item("C:/x/ab.md"), item("C:/x/cb.md", { pinned: true })]);
    expect(r1.map((x) => x.path)).toEqual(["C:/x/cb.md", "C:/x/ab.md"]); // 非固定向后
    const r2 = searchQuickItems("b", [item("C:/x/ab.md", { pinned: true }), item("C:/x/cb.md")]);
    expect(r2.map((x) => x.path)).toEqual(["C:/x/ab.md", "C:/x/cb.md"]); // 固定保持在前
  });
});
