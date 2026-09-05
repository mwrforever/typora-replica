// Typora 锚点 id 插件用例（05 大纲 P1，AC-F23-2/3）
//
// 验证四件事：① 内置 MILKDOWN_HEADING_ID 插件已被本模块禁用（spike 判定，
// 失败则按 plan 回退分支改道收集器侧计算 id）；② 重复标题后缀对齐 Typora
// 「-1 起编号」（禁止内置 `-#2` 形态落进 attrs.id）；③ 中文 slug 保留中文、
// 空白折叠为 -，空文本标题跳过编号且不占用计数；④ IME 组合期（view.composing）
// 跳过全量重算，组合结束后的下一次文档变更补算缺失 id。
import { afterEach, describe, expect, it } from "vitest";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
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

  it("IME 组合期跳过重算：attrs.id 不写入；组合结束后恢复补算", async () => {
    const { view } = await makeTestEditor("# Hello");
    // 初始视图挂载即完成首轮编号（基线，防误判后续跳过行为）
    expect(collectIds(view.state.doc)).toEqual(["hello"]);

    // jsdom 无法自然触发 IME composition；本版 prosemirror-view 的 composing
    // 为只读 getter，真实存储位是实例字段 input.composing，经 unknown 收窄置位
    const composingView = view as unknown as { input: { composing: boolean } };
    composingView.input.composing = true;

    // 组合中文档仍会变化（拼音中间态）：追加同名标题，重算被跳过、新标题 id 不写入
    appendHeading(view, "Hello");
    expect(collectIds(view.state.doc)).toEqual(["hello", ""]);

    // 组合结束（compositionend）后下一次文档变更触发全量重算，补齐缺失编号
    composingView.input.composing = false;
    appendHeading(view, "Hello");
    expect(collectIds(view.state.doc)).toEqual(["hello", "hello-1", "hello-2"]);
  });
});

/** 在文档末尾追加一级标题（直接派生事务制造文档变更，驱动插件 update 链路） */
function appendHeading(view: EditorView, text: string): void {
  const headingType = view.state.schema.nodes.heading!;
  view.dispatch(
    view.state.tr.insert(
      view.state.doc.content.size,
      headingType.create({ level: 1 }, headingType.schema.text(text)),
    ),
  );
}

/** 从 doc 收集全部 heading 的 attrs.id（按文档序） */
function collectIds(doc: ProseMirrorNode): string[] {
  const out: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "heading") out.push(String(node.attrs.id ?? ""));
  });
  return out;
}
