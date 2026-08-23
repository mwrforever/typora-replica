// 大纲 store 状态机用例（05 大纲 Task 5，F19 高亮/F21 过滤/F22 折叠共享状态）
//
// 纯 Pinia 状态派生验证：折叠交集保留（AC-F22-3）、过滤平铺保级（AC-F21-1/2）、
// 折叠祖先链裁剪与 F21×F22 正交性、Flat 开关联动清空。
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { HeadingInfo } from "../editor/heading-collect";
import { useOutlineStore } from "./outline-store";

/** 条目构造捷径（id/level/text/pos 四元组，pos 仅用于排序语义不参与派生） */
const H = (id: string, level: number, text: string, pos: number): HeadingInfo => ({
  id,
  level,
  text,
  pos,
});

describe("outlineStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("applyHeadings 重算后 collapsedIds 按 id 交集保留（AC-F22-3）", () => {
    const store = useOutlineStore();
    store.applyHeadings([H("a", 1, "A", 0), H("b", 2, "B", 5)]);
    store.setCollapsible(true);
    store.toggleCollapsed("b");
    expect(store.collapsedIds.has("b")).toBe(true);
    store.applyHeadings([H("a", 1, "A", 0), H("b", 2, "B", 4), H("c", 2, "C", 9)]);
    expect(store.collapsedIds.has("b")).toBe(true); // id 匹配保留
    store.applyHeadings([H("a", 1, "A", 0), H("d", 2, "D", 4)]); // b 消失
    expect(store.collapsedIds.has("b")).toBe(false); // 交集裁剪，不留僵尸
  });

  it("filteredHeadings 命中项保留原 level；清空恢复全量（AC-F21-1/2）", () => {
    const store = useOutlineStore();
    store.applyHeadings([H("a", 1, "安装指南", 0), H("b", 2, "卸载", 10), H("c", 1, "附录", 20)]);
    store.setFilter("卸载");
    expect(store.filteredHeadings.map((h) => h.id)).toEqual(["b"]); // 只显命中项
    expect(store.filteredHeadings[0].level).toBe(2); // 缩进按原级别
    store.setFilter("");
    expect(store.filteredHeadings.length).toBe(3);
  });

  it("visibleHeadings 折叠祖先链裁剪后代；过滤词非空时忽略折叠（F22×F21 正交）", () => {
    const store = useOutlineStore();
    store.applyHeadings([H("a", 1, "A", 0), H("b", 2, "B", 5), H("c", 3, "C", 10)]);
    store.setCollapsible(true);
    store.toggleCollapsed("a");
    expect(store.visibleHeadings.map((h) => h.id)).toEqual(["a"]);
    store.setFilter("C"); // 过滤优先于折叠
    expect(store.visibleHeadings.map((h) => h.id)).toEqual(["c"]);
  });

  it("setCollapsible(false) 关闭视图同时清空折叠集合（回到 Flat 无残留）", () => {
    const store = useOutlineStore();
    store.setCollapsible(true);
    store.toggleCollapsed("a");
    store.setCollapsible(false);
    expect(store.collapsedIds.size).toBe(0);
  });

  it("默认 Flat 模式 visibleHeadings 全量可见（AC-F22-1）", () => {
    const store = useOutlineStore();
    store.applyHeadings([H("a", 1, "A", 0), H("b", 2, "B", 5)]);
    // 未开启 collapsible：折叠集合即便有残留也不参与裁剪
    expect(store.visibleHeadings.map((h) => h.id)).toEqual(["a", "b"]);
  });

  it("toggleCollapsed 再次点击展开（折叠态可逆）", () => {
    const store = useOutlineStore();
    store.setCollapsible(true);
    store.toggleCollapsed("a");
    expect(store.collapsedIds.has("a")).toBe(true);
    store.toggleCollapsed("a");
    expect(store.collapsedIds.size).toBe(0);
  });

  it("同级标题切换后祖先链正确收缩（新分支的折叠不误伤前分支后代）", () => {
    const store = useOutlineStore();
    store.applyHeadings([
      H("install", 1, "安装", 0),
      H("pre", 2, "前置", 4),
      H("uninstall", 1, "卸载", 12),
      H("clean", 2, "清理", 16),
    ]);
    store.setCollapsible(true);
    store.toggleCollapsed("uninstall");
    // 「卸载」折叠只隐藏其后代「清理」；前分支「前置」不受影响
    expect(store.visibleHeadings.map((h) => h.id)).toEqual(["install", "pre", "uninstall"]);
  });

  it("setActive 回写高亮目标可设可清；setFilter 空串恢复全量", () => {
    const store = useOutlineStore();
    expect(store.activeHeadingId).toBeUndefined();
    store.setActive("a");
    expect(store.activeHeadingId).toBe("a");
    store.setActive(undefined); // 光标离开标题区清除高亮
    expect(store.activeHeadingId).toBeUndefined();
    store.applyHeadings([H("a", 1, "安装指南", 0), H("b", 2, "卸载", 10)]);
    store.setFilter("安装");
    expect(store.filteredHeadings.map((h) => h.id)).toEqual(["a"]);
  });

  it("过滤大小写不敏感（查询词与标题大小写差异不影响命中）", () => {
    const store = useOutlineStore();
    store.applyHeadings([H("a", 1, "Install Guide", 0), H("b", 2, "附录", 10)]);
    store.setFilter("INSTALL"); // 大写查询小写标题
    expect(store.filteredHeadings.map((h) => h.id)).toEqual(["a"]);
    store.setFilter("guide"); // 小写查询含大写原文
    expect(store.filteredHeadings.map((h) => h.id)).toEqual(["a"]);
  });
});
