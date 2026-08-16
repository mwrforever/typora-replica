// E9 脚注：引用+定义渲染 / 悬停预览 / 无定义引用降级
import { fireEvent } from "@testing-library/dom";
import type { EditorView } from "@milkdown/kit/prose/view";
import { describe, expect, it, vi } from "vitest";
import { makeTestEditor } from "../../test/editor-test-utils";
import {
  createFootnoteHoverHandlers,
  findFootnoteReferenceElement,
  type FootnoteTooltipHandle,
} from "./footnote-tooltip";

/** 当前文档中的脚注预览浮层（编辑器挂载在 body 内；断言前须判空） */
function footnoteTooltip(): HTMLElement | null {
  return document.querySelector(".milkdown-footnote-tooltip");
}

describe("E9 脚注", () => {
  it("AC-E9-1 输入 [^fn1] 与定义渲染为上标引用 + 文末定义", async () => {
    const te = await makeTestEditor("正文引用[^fn1]\n\n[^fn1]: 脚注内容");
    // 上标引用存在（GFM 内置 footnoteReference 渲染为 sup）
    expect(te.view.dom.querySelector("sup")).not.toBeNull();
    // 定义区块存在（footnoteDefinition 渲染为 dl[data-type=footnote_definition]，dd 内含定义内容）
    const defBlock = te.view.dom.querySelector('dl[data-type="footnote_definition"]');
    expect(defBlock).not.toBeNull();
    expect(defBlock!.textContent).toContain("脚注内容");
  });

  it("AC-E9-2 脚注引用处悬停弹出预览浮层", async () => {
    const te = await makeTestEditor("正文引用[^fn1]\n\n[^fn1]: 脚注内容");
    const ref = te.view.dom.querySelector("sup");
    expect(ref).not.toBeNull();

    fireEvent.mouseOver(ref!);
    // 预览浮层显示脚注内容（.milkdown-footnote-tooltip 为自定义浮层类名，Crepe 无内置脚注 tooltip）
    const tooltip = footnoteTooltip();
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toContain("脚注内容");
    expect(tooltip!.dataset.show).toBe("true");
  });

  it("AC-E9-3 引用 [^nonexist] 无对应定义不崩溃、按普通文本渲染", async () => {
    const te = await makeTestEditor("引用[^nonexist]");
    expect(() => te.getMarkdown()).not.toThrow();
    // 无定义时仍保留引用记号（GFM 允许未解析引用）
    expect(te.getMarkdown()).toContain("[^nonexist]");
  });

  it("多脚注文档悬停按 label 精确匹配定义内容", async () => {
    const te = await makeTestEditor("引[^a]与[^b]\n\n[^a]: 定义甲\n\n[^b]: 定义乙");
    const refs = te.view.dom.querySelectorAll("sup");
    expect(refs).toHaveLength(2);
    // 悬停第二个引用：预览必须命中同 label 定义（跳过 label 不匹配的定义甲）
    fireEvent.mouseOver(refs[1]!);
    const tooltip = footnoteTooltip();
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toBe("定义乙");
    expect(tooltip!.dataset.show).toBe("true");
  });

  it("悬停无定义引用不显示浮层（未解析引用降级）", async () => {
    const te = await makeTestEditor("正文");
    // 经 schema 直接插入无对应定义的引用节点（等价 HTML 粘贴/定义删除后的孤引用状态；
    // markdown 侧无定义引用按普通文本解析，不产生节点）
    const refType = te.view.state.schema.nodes["footnote_reference"];
    expect(refType).not.toBeUndefined();
    te.view.dispatch(te.view.state.tr.replaceSelectionWith(refType!.create({ label: "ghost" })));
    const sup = te.view.dom.querySelector("sup");
    expect(sup).not.toBeNull();
    fireEvent.mouseOver(sup!);
    const tooltip = footnoteTooltip();
    expect(tooltip).not.toBeNull();
    expect(tooltip!.dataset.show).toBe("false");
    expect(tooltip!.textContent).toBe("");
  });

  it("悬停普通文本或移出编辑器后浮层隐藏", async () => {
    const te = await makeTestEditor("正文引用[^fn1]\n\n[^fn1]: 脚注内容");
    const sup = te.view.dom.querySelector("sup")!;
    fireEvent.mouseOver(sup);
    const tooltip = footnoteTooltip();
    expect(tooltip).not.toBeNull();
    expect(tooltip!.dataset.show).toBe("true");

    // 悬停非引用元素（段落）：浮层隐藏
    const paragraph = te.view.dom.querySelector("p")!;
    fireEvent.mouseOver(paragraph);
    expect(tooltip!.dataset.show).toBe("false");

    // 再次悬停显示后移出编辑器：浮层隐藏
    fireEvent.mouseOver(sup);
    expect(tooltip!.dataset.show).toBe("true");
    fireEvent.mouseLeave(te.view.dom);
    expect(tooltip!.dataset.show).toBe("false");
  });

  it("浮层显示期间文档更新即隐藏（内容过期保护）", async () => {
    const te = await makeTestEditor("正文引用[^fn1]\n\n[^fn1]: 脚注内容");
    fireEvent.mouseOver(te.view.dom.querySelector("sup")!);
    const tooltip = footnoteTooltip();
    expect(tooltip).not.toBeNull();
    expect(tooltip!.dataset.show).toBe("true");

    // 任意文档事务（此处输入字符）触发插件视图 update：浮层立即隐藏，待下次悬停重取
    te.insertText("x");
    expect(tooltip!.dataset.show).toBe("false");
  });

  it("findFootnoteReferenceElement：非元素目标与未命中返回 null、命中返回 sup", () => {
    // null 目标与非元素目标（文本节点）直接未命中
    expect(findFootnoteReferenceElement(null)).toBeNull();
    expect(findFootnoteReferenceElement(document.createTextNode("x"))).toBeNull();
    // 无 data-type 的普通元素未命中
    const div = document.createElement("div");
    expect(findFootnoteReferenceElement(div)).toBeNull();
    // 命中：sup[data-type=footnote_reference] 返回元素自身
    const sup = document.createElement("sup");
    sup.setAttribute("data-type", "footnote_reference");
    expect(findFootnoteReferenceElement(sup)).toBe(sup);
  });

  it("handlers 工厂：视图未初始化时指针事件不处理（防御分支）", () => {
    // getView 恒返回 null（编辑器 create 早期）：mousemove/mouseleave 直接返回不崩溃
    const handlers = createFootnoteHoverHandlers(() => null);
    handlers.mousemove(
      {} as unknown as EditorView,
      { type: "mousemove", target: document.body } as unknown as Event,
    );
    handlers.mouseleave();
  });

  it("handlers 工厂：引用元素缺 label 时隐藏浮层（防御分支）", async () => {
    const te = await makeTestEditor("引用[^fn1]\n\n[^fn1]: 脚注内容");
    // 桩浮层观察显隐调用（内置 schema 恒渲染 label，此处覆盖非法 DOM 的防御路径）
    const hide = vi.fn();
    const show = vi.fn();
    const handle: FootnoteTooltipHandle = { hide, show };
    const handlers = createFootnoteHoverHandlers(() => handle);
    const sup = document.createElement("sup");
    sup.setAttribute("data-type", "footnote_reference");
    handlers.mousemove(te.view, { type: "mousemove", target: sup } as unknown as Event);
    expect(hide).toHaveBeenCalledOnce();
    expect(show).not.toHaveBeenCalled();
  });

  it("P1-2 同 label 悬停移动不重复扫描重建浮层（高频路径短路）", () => {
    const show = vi.fn();
    const hide = vi.fn();
    const handle: FootnoteTooltipHandle = { hide, show };
    const handlers = createFootnoteHoverHandlers(() => handle);
    // 构造两个同 label 引用与一个异 label 引用（桩句柄：不做真实扫描，观察 show 调用次数）
    const makeSup = (label: string): HTMLSpanElement => {
      const sup = document.createElement("sup");
      sup.setAttribute("data-type", "footnote_reference");
      sup.setAttribute("data-label", label);
      return sup;
    };
    const supA = makeSup("fn1");
    const event = (target: Element): Event => ({ type: "mousemove", target }) as unknown as Event;
    // 首次命中：扫描并显示
    handlers.mousemove(null as never, event(supA));
    expect(show).toHaveBeenCalledTimes(1);
    // 同 label 连续移动（悬停期间 mousemove ~60-120Hz）：短路不再扫描/重建
    handlers.mousemove(null as never, event(supA));
    handlers.mousemove(null as never, event(supA));
    expect(show).toHaveBeenCalledTimes(1);
    // 切到另一 label 的引用：重新扫描显示
    const supB = makeSup("fn2");
    handlers.mousemove(null as never, event(supB));
    expect(show).toHaveBeenCalledTimes(2);
    // 移出后再次悬停同 label：缓存已清，重新扫描
    handlers.mouseleave();
    handlers.mousemove(null as never, event(supA));
    expect(show).toHaveBeenCalledTimes(3);
    // 移出/移入普通元素：隐藏并清缓存
    handlers.mousemove(null as never, event(document.createElement("p")));
    expect(hide).toHaveBeenCalled();
    handlers.mousemove(null as never, event(supA));
    expect(show).toHaveBeenCalledTimes(4);
  });
});
