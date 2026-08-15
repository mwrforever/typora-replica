// E14 链接：解析渲染 / 点击展开编辑 / Ctrl+点击系统浏览器 / 裸 URL 自动识别 / 重复标题锚点
import { fireEvent } from "@testing-library/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestEditor } from "../../test/editor-test-utils";

// 模拟系统浏览器打开（隔离 Tauri 环境；项目无 @/ 别名，按相对路径 mock）
vi.mock("../../services/external-open", () => ({
  openExternalUrl: vi.fn(),
}));
import { openExternalUrl } from "../../services/external-open";

/** 当前文档中的链接预览浮层（编辑器挂载在 body 内，浮层由 TooltipProvider 挂到容器） */
function linkPreview(): HTMLElement | null {
  return document.querySelector(".milkdown-link-preview");
}

/**
 * jsdom 无布局命中测试：桩 document.elementFromPoint 使 ProseMirror 的 posAtCoords
 * 能把事件坐标解析到目标元素（真实浏览器由原生命中测试完成），返回还原函数。
 */
function stubHitTarget(target: Element): () => void {
  const prev = document.elementFromPoint;
  document.elementFromPoint = () => target;
  return () => {
    document.elementFromPoint = prev;
  };
}

/**
 * 在元素上派发完整鼠标序列（按下→抬起→点击）。
 * ProseMirror 的点击处理链是 mousedown 创建 LeftMouseDown、mouseup 触发 handleClick，
 * fireEvent.click 仅派发单个 click 事件，不足以驱动该链路；坐标恒 (0,0) 使
 * updateAllowDefault 判定未移动（与按下位置一致）。
 */
function fireClickSequence(target: Element, mods: { ctrlKey?: boolean } = {}): void {
  fireEvent.mouseDown(target, { clientX: 0, clientY: 0, ...mods });
  fireEvent.mouseUp(target, { clientX: 0, clientY: 0, ...mods });
  fireEvent.click(target, { clientX: 0, clientY: 0, ...mods });
}

describe("E14 链接", () => {
  beforeEach(() => {
    vi.mocked(openExternalUrl).mockClear();
  });

  it("AC-E14-1 输入 [文本](url) 渲染为可点击链接", async () => {
    const te = await makeTestEditor("[文本](https://example.com)");
    const a = te.view.dom.querySelector("a");
    expect(a).not.toBeNull();
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.textContent).toBe("文本");
  });

  it("AC-E14-2 点击链接展开编辑态可改 URL", async () => {
    const te = await makeTestEditor("[文本](https://example.com)");
    const a = te.view.dom.querySelector("a")!;
    // jsdom 无布局：桩命中测试使点击/悬停坐标解析到链接（真实浏览器原生命中测试并聚焦）。
    // 桩须保持到悬停防抖处理器（50ms 后）执行完 posAtCoords 再还原
    const restore = stubHitTarget(a);
    fireClickSequence(a);
    // jsdom 不会因 mousedown 原生聚焦编辑器（真实浏览器 contenteditable 原生聚焦），
    // 内置 link-tooltip 的悬停预览要求视图聚焦，此处显式聚焦补齐
    te.view.focus();
    // 内置 link-tooltip 由 mousemove 悬停驱动预览浮层（非 click）；浮层元素随编辑器
    // 创建即挂载（隐藏态 data-show=false），须以 data-show=true 断言真正展开。
    // 注意 vitest4 waitFor 仅在回调抛错时重试，条件不满足须显式 throw
    fireEvent.mouseMove(a, { clientX: 0, clientY: 0 });
    const preview = await vi.waitFor(() => {
      const el = linkPreview();
      if (!el || el.dataset.show !== "true") throw new Error("链接预览浮层未展开");
      return el;
    });
    expect(preview).not.toBeNull();
    restore();
    const editBtn = preview!.querySelector(".link-edit-button");
    expect(editBtn).not.toBeNull(); // 编辑入口（改 URL 的入口）暴露
    // 内置按钮经 onPointerdown 触发（Icon 组件统一 pointerdown 语义，click 不命中），
    // 点击编辑按钮进入编辑态：URL 预填可修改（编辑浮层元素同样常驻 DOM，等待值刷新）
    fireEvent.pointerDown(editBtn!);
    const editInput = await vi.waitFor(() => {
      const input = document.querySelector<HTMLInputElement>(".milkdown-link-edit input");
      if (!input || input.value !== "https://example.com") throw new Error("编辑态未预填 URL");
      return input;
    });
    expect(editInput).not.toBeNull();
    // 修改 URL 并确认（confirm 按钮同为 Icon 组件，pointerdown 触发）：落盘 markdown 同步更新
    fireEvent.input(editInput!, { target: { value: "https://new.example.com" } });
    fireEvent.pointerDown(document.querySelector(".milkdown-link-edit .confirm")!);
    await vi.waitFor(() => expect(te.getMarkdown()).toBe("[文本](https://new.example.com)"));
  });

  it("AC-E14-3 Ctrl+点击链接打开系统浏览器", async () => {
    const te = await makeTestEditor("[文本](https://example.com)");
    const a = te.view.dom.querySelector("a")!;
    // jsdom 无布局：桩命中测试使点击坐标解析到链接位置（真实浏览器原生命中）
    const restore = stubHitTarget(a);
    fireClickSequence(a, { ctrlKey: true });
    restore();
    expect(vi.mocked(openExternalUrl)).toHaveBeenCalledWith("https://example.com");
  });

  it("AC-E14-4 裸 URL www.example.com 自动识别为链接", async () => {
    const te = await makeTestEditor("访问 www.example.com 试试");
    const a = te.view.dom.querySelector("a");
    expect(a).not.toBeNull();
    expect(a?.getAttribute("href")).toContain("example.com");
  });

  it("AC-E14-5 两个同名标题锚点后缀不冲突", async () => {
    const te = await makeTestEditor("# 标题\n\n# 标题");
    const ids = [...te.view.dom.querySelectorAll("h1[id]")].map((h) => h.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2); // 两个 id 不冲突
    // 实际渲染形态：首个标题用原文 id，重复标题追加 -#2 后缀（Milkdown 内置去重方案）
    expect(ids[0]).toBe("标题");
    expect(ids[1]).toBe("标题-#2");
  });

  it("普通点击链接不触发系统浏览器（放行内置编辑）", async () => {
    const te = await makeTestEditor("[文本](https://example.com)");
    const a = te.view.dom.querySelector("a")!;
    const restore = stubHitTarget(a);
    fireClickSequence(a); // 无 Ctrl/Meta 修饰
    restore();
    expect(vi.mocked(openExternalUrl)).not.toHaveBeenCalled();
  });

  it("Ctrl+点击无链接的普通文本不触发系统浏览器", async () => {
    const te = await makeTestEditor("普通文本");
    const p = te.view.dom.querySelector("p")!;
    const restore = stubHitTarget(p);
    fireClickSequence(p, { ctrlKey: true });
    restore();
    expect(vi.mocked(openExternalUrl)).not.toHaveBeenCalled();
  });

  it("Ctrl+点击空 href 链接不触发系统浏览器", async () => {
    const te = await makeTestEditor("[空]()");
    const a = te.view.dom.querySelector("a")!;
    const restore = stubHitTarget(a);
    fireClickSequence(a, { ctrlKey: true });
    restore();
    expect(vi.mocked(openExternalUrl)).not.toHaveBeenCalled();
  });
});
