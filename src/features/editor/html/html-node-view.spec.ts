// html 节点 NodeView 单元测试：构造/更新/忽略变更直接驱动
//
// update 由 ProseMirror 生命周期调用，编辑器行为用例难以确定性触发，
// 本用例经真实 schema 构造节点后直连工厂实例驱动（与 PM 调用语义一致）。
import { schemaCtx } from "@milkdown/kit/core";
import { describe, expect, it } from "vitest";
import { makeTestEditor } from "../../../test/editor-test-utils";
import { htmlNodeViewFactory } from "./html-node-view";

describe("html NodeView", () => {
  it("构造渲染清洗后内容，值未变时 update 复用 DOM，值变化时重渲", async () => {
    const te = await makeTestEditor("<b>x</b>");
    const schema = te.editor.action((ctx) => ctx.get(schemaCtx));
    const factory = htmlNodeViewFactory();
    // 构造 html 节点（与真实编辑器同 schema，attrs.value 即原始 HTML）
    const node = schema.nodes.html.create({ value: "<b>x</b>" });
    const view = factory(node);
    // 构造时渲染：白名单清洗 + 剥离装饰属性后呈现
    expect(view.dom.querySelector("b")?.textContent).toBe("x");
    // 值未变：update 返回 true 且不重渲（同一 DOM 引用保持）
    const domBefore = view.dom;
    expect(view.update(node)).toBe(true);
    expect(view.dom).toBe(domBefore);
    // 值变化：重渲为新内容，旧内容移除
    const next = schema.nodes.html.create({ value: "<i>y</i>" });
    expect(view.update(next)).toBe(true);
    expect(view.dom.querySelector("i")?.textContent).toBe("y");
    expect(view.dom.querySelector("b")).toBeNull();
  });

  it("ignoreMutation 恒为 true（容器内容由本视图全量接管）", async () => {
    const te = await makeTestEditor("<b>x</b>");
    const schema = te.editor.action((ctx) => ctx.get(schemaCtx));
    const view = htmlNodeViewFactory()(schema.nodes.html.create({ value: "<b>x</b>" }));
    expect(view.ignoreMutation()).toBe(true);
  });
});
