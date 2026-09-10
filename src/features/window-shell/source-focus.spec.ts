// 源码层 Focus 叠加扩展测试（12 窗口外壳 W5；AC-M-9：源码模式下 Focus 生效可叠加）
//
// 断言口径：CM 行装饰类名（当前行 md-focus）与开关 effect 行为（开启/关闭/光标
// 随行迁移），面向用户可见行为不触字段内部。CodeMirror 实例以最小扩展组在 jsdom
// 直建（SourceModeLayer.spec 同款环境，无需 Milkdown 装配）。
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { setSourceFocusEffect, sourceFocusExtension } from "./source-focus";

/** 直建最小 CM 视图（markdown 源码三行夹具；扩展组只挂被测扩展） */
function makeView(doc: string): { view: EditorView; destroy: () => void } {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [sourceFocusExtension()] }),
    parent,
  });
  return { view, destroy: () => view.destroy() };
}

afterEach(() => {
  document.querySelectorAll(".cm-editor").forEach((el) => el.remove());
});

describe("sourceFocusExtension（AC-M-9 源码层 Focus 叠加）", () => {
  it("默认关闭：不注入任何行装饰类（未开启 Focus 的源码层零视觉干预）", () => {
    const { view, destroy } = makeView("第一行\n第二行");
    expect(view.dom.querySelectorAll(".cm-line.md-focus")).toHaveLength(0);
    destroy();
  });

  it("effect 开启后当前光标行挂 md-focus（Typora 契约类名同名）", () => {
    const { view, destroy } = makeView("第一行\n第二行\n第三行");
    view.dispatch({ effects: setSourceFocusEffect.of(true) });
    // 初始光标在文档头 = 第一行
    const focused = view.dom.querySelectorAll(".cm-line.md-focus");
    expect(focused).toHaveLength(1);
    expect(focused[0]?.textContent).toBe("第一行");
    destroy();
  });

  it("光标移到其他行时 md-focus 跟随该行（选区迁移重算）", () => {
    const { view, destroy } = makeView("第一行\n第二行\n第三行");
    view.dispatch({ effects: setSourceFocusEffect.of(true) });
    // 光标移入第二行（「第二行」中段，4 = 行首 4 + 偏移 1）
    view.dispatch({ selection: { anchor: 5 } });
    const focused = view.dom.querySelectorAll(".cm-line.md-focus");
    expect(focused).toHaveLength(1);
    expect(focused[0]?.textContent).toBe("第二行");
    destroy();
  });

  it("effect 关闭后清除行装饰（与 WYSIWYG 侧 Focus 关闭语义一致）", () => {
    const { view, destroy } = makeView("第一行\n第二行");
    view.dispatch({ effects: setSourceFocusEffect.of(true) });
    expect(view.dom.querySelectorAll(".cm-line.md-focus")).toHaveLength(1);
    view.dispatch({ effects: setSourceFocusEffect.of(false) });
    expect(view.dom.querySelectorAll(".cm-line.md-focus")).toHaveLength(0);
    destroy();
  });

  it("编辑中保持跟随：光标行变更事务后装饰重算不丢失", () => {
    const { view, destroy } = makeView("第一行\n第二行");
    view.dispatch({ effects: setSourceFocusEffect.of(true) });
    // 在光标行输入文本（doc + 选区同事务变更）
    view.dispatch(view.state.replaceSelection("字"));
    const focused = view.dom.querySelectorAll(".cm-line.md-focus");
    expect(focused).toHaveLength(1);
    expect(focused[0]?.textContent).toBe("字第一行");
    destroy();
  });
});
