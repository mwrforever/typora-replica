// E12 目录 TOC：`[toc]` 生成 / 标题增删防抖重算 / 点击跳转 / 无标题空目录 / 落盘往返（100% 覆盖）
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { fireEvent } from "@testing-library/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestEditor } from "../../../test/editor-test-utils";
import { configureToc, tocSchema } from "./toc-plugin";

describe("E12 目录 TOC", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("AC-E12-1 输入 [toc] + Enter 生成目录区块列出全部标题", async () => {
    const te = await makeTestEditor("# 第一章\n\n## 第一节");
    // 文末插入 [toc]（输入规则在 ] 落字时整段替换为 toc 节点）
    te.setSelection(te.view.state.doc.content.size, te.view.state.doc.content.size);
    te.insertText("[toc]");
    te.press("Enter");

    const toc = te.view.dom.querySelector(".markwell-toc");
    expect(toc).not.toBeNull();
    expect(toc?.textContent).toContain("第一章");
    expect(toc?.textContent).toContain("第一节");
  });

  it("AC-E12-2 新增/删除标题后目录防抖自动更新", async () => {
    const te = await makeTestEditor("# 第一章\n\n[toc]");
    vi.advanceTimersByTime(0); // 初始重算（节点创建时同步执行，防抖仅用于后续更新）
    const toc = te.view.dom.querySelector(".markwell-toc");
    expect(toc?.textContent).toContain("第一章");

    // 新增标题（行首输入 ## 触发内置标题规则转 H2）
    te.setSelection(te.view.state.doc.content.size, te.view.state.doc.content.size);
    te.press("Enter");
    te.insertText("## 新增节");
    // 底层 listener 插件自身有 200ms 内部防抖，再叠加本插件 300ms：总窗口 500ms
    vi.advanceTimersByTime(500);
    expect(te.view.dom.querySelector(".markwell-toc")?.textContent).toContain("新增节");

    // 删除标题后重算：选中并删除 H2 标题
    const sel = te.view.state.selection.from;
    te.setSelection(sel - 4, sel);
    fireEvent.keyDown(te.view.dom, { key: "Backspace" });
    vi.advanceTimersByTime(500);
    expect(te.view.dom.querySelector(".markwell-toc")?.textContent).not.toContain("新增节");
  });

  it("AC-E12-3 点击目录条目跳转到对应标题", async () => {
    const te = await makeTestEditor("# 第一章\n\n正文段落\n\n# 第二章\n\n[toc]");
    const entries = te.view.dom.querySelectorAll(".markwell-toc__item");
    expect(entries.length).toBe(2);
    // 点击「第二章」条目：选区定位到对应标题文本（from > 0）
    fireEvent.click(entries[1]!);
    const selFrom = te.view.state.selection.from;
    expect(selFrom).toBeGreaterThan(0);
    // 选区应落在第二章标题内（首个标题文本起点 = 1，第二章在其后）
    expect(selFrom).toBeGreaterThan(1);
    // 高亮落在标题元素上（nodeDOM 命中文本节点时回退到父元素，Task 2 同款守卫）
    const highlighted = te.view.dom.querySelector(".markwell-reveal-highlight");
    expect(highlighted).not.toBeNull();
    expect(highlighted?.tagName).toBe("H1");
    // 高亮定时消退
    vi.advanceTimersByTime(1200);
    expect(te.view.dom.querySelector(".markwell-reveal-highlight")).toBeNull();
  });

  it("AC-E12-4 无标题文档输入 [toc] 显示空目录提示", async () => {
    const te = await makeTestEditor();
    te.insertText("[toc]");
    te.press("Enter");
    const toc = te.view.dom.querySelector(".markwell-toc");
    expect(toc).not.toBeNull();
    expect(toc?.textContent).toContain("无标题");
  });

  it("落盘往返：[toc] 序列化为字面文本，回读还原 toc 节点", async () => {
    const te = await makeTestEditor("# 标题\n\n[toc]");
    const md = te.getMarkdown();
    expect(md).toContain("[toc]");
    expect(md).toContain("# 标题");
    // 回读（新编辑器加载同一 markdown 仍生成 toc 节点）
    const te2 = await makeTestEditor(md);
    expect(te2.view.dom.querySelector(".markwell-toc")).not.toBeNull();
  });

  it("行中多余文本不触发 [toc] 转换（独占整行守卫）", async () => {
    const te = await makeTestEditor("[toc]更多文字");
    // 光标定位到 [toc] 之后、行尾之前（行中）：光标前文本为 [toc] 但行尾仍有内容
    te.setSelection(5, 5);
    te.insertText("]");
    expect(te.view.dom.querySelector(".markwell-toc")).toBeNull();
    // 文本保持普通段落（safe 序列化会把 [ 转义，仅断言行尾文字未被吞掉）
    expect(te.getMarkdown()).toContain("更多文字");
  });

  it("连续更新防抖合并：仅最后一次重算生效（窗口内 clearTimeout）", async () => {
    const te = await makeTestEditor("# 第一章\n\n[toc]");
    te.setSelection(te.view.state.doc.content.size, te.view.state.doc.content.size);
    te.press("Enter");
    te.insertText("## 新增节");
    // 推进 250ms：listener 内部防抖（200ms）触发第一次 updated，本插件 300ms 计时器待发
    vi.advanceTimersByTime(250);
    // 窗口内再次更新：第二次 updated 到来时清掉旧计时器并重排（覆盖 clearTimeout 分支）
    te.insertText("再改");
    vi.advanceTimersByTime(500);
    const toc = te.view.dom.querySelector(".markwell-toc");
    expect(toc?.textContent).toContain("新增节再改");
  });

  it("外部篡改目录 DOM 不触发 ProseMirror 重渲染（ignoreMutation）", async () => {
    const te = await makeTestEditor("# 标题\n\n[toc]");
    const toc = te.view.dom.querySelector(".markwell-toc");
    expect(toc).not.toBeNull();
    // 直接篡改 NodeView 容器内容（绕过编辑器派发路径）
    toc!.textContent = "外部篡改";
    // 篡改后正常输入不崩溃，且目录可随更新重算恢复
    te.insertText("正文");
    vi.advanceTimersByTime(500);
    expect(te.view.dom.querySelector(".markwell-toc")?.textContent).toContain("标题");
  });

  it("点击条目时 nodeDOM 返回元素则直接高亮该元素（Element 分支）", async () => {
    const te = await makeTestEditor("# 标题\n\n[toc]");
    const el = document.createElement("h1");
    const spy = vi.spyOn(te.view, "nodeDOM").mockReturnValue(el);
    fireEvent.click(te.view.dom.querySelector(".markwell-toc__item") as HTMLElement);
    expect(el.classList.contains("markwell-reveal-highlight")).toBe(true);
    vi.advanceTimersByTime(1200);
    expect(el.classList.contains("markwell-reveal-highlight")).toBe(false);
    spy.mockRestore();
  });

  it("点击条目时 nodeDOM 失效（null）仅定位选区、跳过高亮（空值分支）", async () => {
    const te = await makeTestEditor("# 标题\n\n[toc]");
    const spy = vi.spyOn(te.view, "nodeDOM").mockReturnValue(null);
    fireEvent.click(te.view.dom.querySelector(".markwell-toc__item") as HTMLElement);
    // 选区定位仍生效，高亮跳过不崩溃
    expect(te.view.state.selection.from).toBeGreaterThan(0);
    expect(te.view.dom.querySelector(".markwell-reveal-highlight")).toBeNull();
    spy.mockRestore();
  });

  it("未注册 NodeView 时 toc 节点回退 schema toDOM 渲染", async () => {
    // 绕过 makeTestEditor（已注册 NodeView），直连 Crepe 仅注册 schema 与解析接线
    const root = document.createElement("div");
    document.body.appendChild(root);
    const crepe = new Crepe({ root, defaultValue: "[toc]" });
    crepe.editor.use(tocSchema);
    crepe.editor.config((ctx) => configureToc(ctx));
    await crepe.create();
    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx));
    const toc = view.dom.querySelector(".markwell-toc");
    expect(toc).not.toBeNull();
    expect(toc?.getAttribute("data-node-type")).toBe("toc");
    crepe.destroy();
  });
});
