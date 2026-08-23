// Typora 锚点 id 插件用例（05 大纲 P1，AC-F23-2/3）
//
// 验证三件事：① 内置 MILKDOWN_HEADING_ID 插件已被本模块禁用（spike 判定，
// 失败则按 plan 回退分支改道收集器侧计算 id）；② 重复标题后缀对齐 Typora
// 「-1 起编号」（禁止内置 `-#2` 形态落进 attrs.id）；③ 中文 slug 保留中文、
// 空白折叠为 -，空文本标题跳过编号且不占用计数。
import { afterEach, describe, expect, it } from "vitest";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { destroyTestEditors, makeTestEditor } from "../../../test/editor-test-utils";
import { keyOf } from "./typora-heading-id";

describe("Typora 锚点 id 插件", () => {
  afterEach(async () => {
    await destroyTestEditors();
  });

  it("spike：内置 MILKDOWN_HEADING_ID 插件已被禁用（过滤生效前提）", async () => {
    const { view } = await makeTestEditor("# Hello");
    // 若此断言失败 = prosePluginsCtx 过滤时机不可行 → 按 plan §回退分支改道收集器侧计算 id
    // （keyOf：本版 prosemirror-state d.ts 遗漏实例 key 声明，经插件模块的收窄助手读取）
    const hasBuiltin = view.state.plugins.some((p) => keyOf(p).startsWith("MILKDOWN_HEADING_ID"));
    expect(hasBuiltin).toBe(false);
  });

  it("AC-F23-2：两个同名 # Hello 的锚点为 hello 与 hello-1（Typora -1 起编号）", async () => {
    const { view } = await makeTestEditor("# Hello\n\n正文\n\n# Hello");
    const ids = view.state.doc.textContent ? collectIds(view.state.doc) : [];
    expect(ids).toEqual(["hello", "hello-1"]); // 禁止出现 hello-#2 形态
  });

  it("AC-F23-3：中文标题 id 保留中文、空格转 -", async () => {
    const { view } = await makeTestEditor("第三章 数据结构设计".replace(/^/, "# ") + "\n\n正文");
    expect(collectIds(view.state.doc)).toEqual(["第三章-数据结构设计"]);
  });

  it("空文本标题跳过编号且不影响后续计数", async () => {
    const { view } = await makeTestEditor("# \n\n# Hello\n\n# Hello");
    const ids = collectIds(view.state.doc);
    expect(ids.filter((id) => id !== "")).toEqual(["hello", "hello-1"]);
  });
});

/** 从 doc 收集全部 heading 的 attrs.id（按文档序） */
function collectIds(doc: ProseMirrorNode): string[] {
  const out: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "heading") out.push(String(node.attrs.id ?? ""));
  });
  return out;
}
