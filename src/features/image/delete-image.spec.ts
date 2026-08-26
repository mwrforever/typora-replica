// Delete Image 链路测试（07 Task 11，AC-P5 系列）
//
// 覆盖三块：
// ① runDeleteFlow 决策链：确认弹窗/回收站删除+节点移除/取消零副作用/不可解析仅删引用/
//    回收站失败降级/多引用计数提示/路径解析 IPC 异常降级/root-url 基准透传
// ② handleImageContext 菜单皮（jsdom 冒烟）：命中弹菜单并以文档模型 src 启动决策链、
//    非 img 与非管辖图片放行
// ③ 生产依赖集默认实现（假视图替身）：引用计数扫描/首命中删节点/DOM→模型 src 反查
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent } from "@testing-library/dom";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editorManager } from "../editor/editor-manager";
import {
  closeImageMenu,
  createDefaultImageDeleteDeps,
  handleImageContext,
  runDeleteFlow,
  type DeleteImageDeps,
} from "./delete-image";

/** 组装依赖桩（全部可观测点为 vi.fn，按用例覆写） */
function makeDeps(overrides: Partial<DeleteImageDeps> = {}): DeleteImageDeps & {
  invoke: ReturnType<typeof vi.fn>;
  removeNodeBySrc: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
  countReferences: ReturnType<typeof vi.fn>;
} {
  // 缺省桩：resolve 命中磁盘路径、delete_to_trash 成功
  const invoke = vi.fn(async (cmd: string) =>
    cmd === "resolve_image_path" ? "C:\\docs\\p.png" : undefined,
  );
  return {
    getContext: vi.fn(() => ({ documentSaved: true, docDir: "C:\\docs", frontMatter: null })),
    confirm: vi.fn(async () => true),
    invoke,
    countReferences: vi.fn(() => 1),
    removeNodeBySrc: vi.fn(() => true),
    notify: vi.fn(),
    resolveOriginalSrc: vi.fn(() => "p.png"),
    ...overrides,
  } as DeleteImageDeps & {
    invoke: ReturnType<typeof vi.fn>;
    removeNodeBySrc: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
    notify: ReturnType<typeof vi.fn>;
    countReferences: ReturnType<typeof vi.fn>;
  };
}

describe("Delete Image 流程（runDeleteFlow）", () => {
  it("AC-P5-2 确认后：解析路径 → 回收站 → 删节点", async () => {
    const deps = makeDeps();
    await runDeleteFlow("p.png", deps);
    expect(deps.confirm).toHaveBeenCalledWith(expect.stringContaining("回收站"));
    expect(deps.invoke).toHaveBeenCalledWith(
      "resolve_image_path",
      expect.objectContaining({ src: "p.png" }),
    );
    expect(deps.invoke).toHaveBeenCalledWith(
      "delete_to_trash",
      expect.objectContaining({ path: "C:\\docs\\p.png" }),
    );
    expect(deps.removeNodeBySrc).toHaveBeenCalledWith("p.png");
  });

  it("AC-P5-3 取消 → 零副作用", async () => {
    const deps = makeDeps({ confirm: vi.fn(async () => false) });
    await runDeleteFlow("p.png", deps);
    expect(deps.invoke).not.toHaveBeenCalled();
    expect(deps.removeNodeBySrc).not.toHaveBeenCalled();
  });

  it("AC-P5-4 src 不可解析 → 仅删引用并提示", async () => {
    const deps = makeDeps({
      invoke: vi.fn(async (cmd: string) => (cmd === "resolve_image_path" ? null : undefined)),
    });
    await runDeleteFlow("https://a/x.png", deps);
    expect(deps.removeNodeBySrc).toHaveBeenCalledWith("https://a/x.png");
    expect(deps.notify).toHaveBeenCalledWith("info", expect.stringContaining("已移除引用"));
  });

  it("回收站失败 → 仍删引用并报错（数据安全取向）", async () => {
    const deps = makeDeps({
      invoke: vi.fn(async (cmd: string) => {
        if (cmd === "resolve_image_path") return "C:\\docs\\p.png";
        throw new Error("占用中");
      }),
    });
    await runDeleteFlow("p.png", deps);
    expect(deps.removeNodeBySrc).toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith("error", expect.stringContaining("占用中"));
  });

  it("多引用 → 确认文案含引用计数（增强项）", async () => {
    const deps = makeDeps({ countReferences: vi.fn(() => 3) });
    await runDeleteFlow("p.png", deps);
    expect(deps.confirm).toHaveBeenCalledWith(expect.stringContaining("3"));
  });

  it("单引用 → 确认文案不含引用计数提示段", async () => {
    const deps = makeDeps({ countReferences: vi.fn(() => 1) });
    await runDeleteFlow("p.png", deps);
    const message = vi.mocked(deps.confirm).mock.calls[0]?.[0] ?? "";
    expect(message).not.toContain("被引用");
  });

  it("resolve_image_path 本身异常 → 报错且仍删引用（与回收站失败同一数据安全取向）", async () => {
    const deps = makeDeps({
      invoke: vi.fn(async (cmd: string) => {
        if (cmd === "resolve_image_path") throw new Error("IPC 断开");
        return undefined;
      }),
    });
    await runDeleteFlow("p.png", deps);
    expect(deps.notify).toHaveBeenCalledWith("error", expect.stringContaining("IPC 断开"));
    expect(deps.removeNodeBySrc).toHaveBeenCalledWith("p.png");
  });

  it("front matter 的 typora-root-url 作为解析基准透传给 Rust", async () => {
    const deps = makeDeps({
      getContext: vi.fn(() => ({
        documentSaved: true,
        docDir: "C:\\docs",
        frontMatter: "---\ntypora-root-url: ./assets\n---",
      })),
    });
    await runDeleteFlow("p.png", deps);
    expect(deps.invoke).toHaveBeenCalledWith(
      "resolve_image_path",
      expect.objectContaining({ rootUrl: "./assets" }),
    );
  });
});

describe("图片右键菜单（handleImageContext）", () => {
  afterEach(() => {
    closeImageMenu();
    vi.restoreAllMocks();
  });

  it("命中管辖图片：拦截事件弹出删除菜单，点击后以模型 src 启动决策链", async () => {
    const container = document.createElement("div");
    container.innerHTML = '<div class="milkdown"><img alt=""></div>';
    document.body.appendChild(container);
    const deps = makeDeps({ resolveOriginalSrc: vi.fn(() => "assets/p.png") });
    const img = container.querySelector("img")!;
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 5,
      clientY: 6,
    });
    img.dispatchEvent(event);
    expect(handleImageContext(event, deps)).toBe(true);
    // AC-P5-1 前置：命中即 preventDefault 并在点击处弹菜单
    expect(event.defaultPrevented).toBe(true);
    const menu = document.querySelector<HTMLElement>(".markwell-image-menu");
    expect(menu?.textContent).toContain("删除图片");
    expect(menu?.style.left).toBe("5px");
    expect(menu?.style.top).toBe("6px");
    // 点击删除项：异步决策链启动（macrotask 排空微任务链后断言）
    fireEvent.click(menu!.querySelector("button")!);
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(deps.confirm).toHaveBeenCalledWith(expect.stringContaining("assets/p.png"));
    expect(deps.removeNodeBySrc).toHaveBeenCalledWith("assets/p.png");
  });

  it("非 img 目标不消费事件也不弹菜单", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>正文</p>";
    document.body.appendChild(container);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    container.querySelector("p")!.dispatchEvent(event);
    expect(handleImageContext(event, makeDeps())).toBe(false);
    expect(document.querySelector(".markwell-image-menu")).toBeNull();
  });

  it("src 反查失败（html 块内嵌图等非管辖图片）不消费事件", () => {
    const container = document.createElement("div");
    container.innerHTML = '<div><img alt=""></div>';
    document.body.appendChild(container);
    const deps = makeDeps({ resolveOriginalSrc: vi.fn(() => undefined) });
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    container.querySelector("img")!.dispatchEvent(event);
    expect(handleImageContext(event, deps)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelector(".markwell-image-menu")).toBeNull();
  });

  it("菜单定位样式守卫：crepe-overrides.css 含 fixed 定位与 z-index（jsdom 不加载 CSS，直读样式文件断言）", () => {
    // mermaid 菜单同款守卫：定位样式在样式文件而非内联样式里，jsdom 的
    // getComputedStyle 反映不了，直读文件断言规则存在以防回归
    const css = readFileSync(resolve("src/styles/crepe-overrides.css"), "utf8");
    const menuRule = css.match(/\.markwell-image-menu\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(menuRule).toContain("position: fixed");
    expect(menuRule).toContain("z-index");
    expect(css).toMatch(/\.markwell-image-menu button:hover/);
  });
});

describe("生产依赖集默认实现（假视图替身，不经真实编辑器）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** 构造最小 ProseMirror 视图替身：doc.descendants 线性铺节点，tr.delete 记录入参 */
  function stubViewWithNodes(nodes: Array<{ name: string; src: unknown; nodeSize?: number }>) {
    const deleted: Array<{ from: number; to: number }> = [];
    const fake = {
      state: {
        doc: {
          descendants(cb: (node: unknown, pos: number) => boolean) {
            nodes.forEach((n, i) =>
              cb(
                { type: { name: n.name }, attrs: { src: n.src }, nodeSize: n.nodeSize ?? 2 },
                i * 10,
              ),
            );
          },
        },
        tr: {
          delete(from: number, to: number) {
            deleted.push({ from, to });
            return this;
          },
        },
      },
      dispatch(): void {
        // 替身无需真实派发；tr.delete 已记录入参
      },
    };
    vi.spyOn(editorManager, "getView").mockReturnValue(fake as unknown as EditorView);
    return { deleted };
  }

  it("countReferences 统计同 src 的 image-block 节点数（含自身）", () => {
    stubViewWithNodes([
      { name: "paragraph", src: "" },
      { name: "image-block", src: "a.png" },
      { name: "image-block", src: "a.png" },
      { name: "image-block", src: "b.png" },
    ]);
    const deps = createDefaultImageDeleteDeps();
    expect(deps.countReferences("a.png")).toBe(2);
    expect(deps.countReferences("b.png")).toBe(1);
    expect(deps.countReferences("c.png")).toBe(0);
  });

  it("removeNodeBySrc 删除首个命中节点并返回 true；无命中返回 false 不派发", () => {
    const { deleted } = stubViewWithNodes([
      { name: "image-block", src: "a.png", nodeSize: 5 },
      { name: "image-block", src: "a.png" },
    ]);
    const deps = createDefaultImageDeleteDeps();
    expect(deps.removeNodeBySrc("a.png")).toBe(true);
    expect(deleted).toEqual([{ from: 0, to: 5 }]);
    // 无命中：不产生事务派发
    expect(deps.removeNodeBySrc("missing.png")).toBe(false);
    expect(deleted).toHaveLength(1);
  });

  it("视图未就绪时 removeNodeBySrc 返回 false、countReferences 返回 0", () => {
    vi.spyOn(editorManager, "getView").mockReturnValue(undefined);
    const deps = createDefaultImageDeleteDeps();
    expect(deps.removeNodeBySrc("a.png")).toBe(false);
    expect(deps.countReferences("a.png")).toBe(0);
  });

  it("extractOriginalSrc 沿祖先链取 image-block attrs.src；不在编辑器 DOM 内返回 undefined", () => {
    const img = document.createElement("img");
    const dom = document.createElement("div");
    dom.appendChild(img);
    const imageNode = { type: { name: "image-block" }, attrs: { src: "real/p.png" } };
    const fake = {
      dom,
      posAtDOM: () => 7,
      state: {
        doc: {
          resolve: () => ({
            depth: 1,
            node: (d: number) => (d === 1 ? imageNode : undefined),
          }),
        },
      },
    };
    vi.spyOn(editorManager, "getView").mockReturnValue(fake as unknown as EditorView);
    const deps = createDefaultImageDeleteDeps();
    // 命中：以模型 attrs.src 为准（DOM src 可能已被 asset:// 替换）
    expect(deps.resolveOriginalSrc(img)).toBe("real/p.png");
    // img 不在本视图 DOM 内（外来元素）不接管
    const outsider = document.createElement("img");
    document.body.appendChild(outsider);
    expect(deps.resolveOriginalSrc(outsider)).toBeUndefined();
  });

  it("extractOriginalSrc 无 image-block 祖先或视图未就绪时返回 undefined，posAtDOM 抛错按未命中处理", () => {
    const img = document.createElement("img");
    const dom = document.createElement("div");
    dom.appendChild(img);
    // 无 image-block 祖先（如 html 块内嵌图的段落祖先）
    const noImage = {
      dom,
      posAtDOM: () => 3,
      state: {
        doc: {
          resolve: () => ({
            depth: 1,
            node: (d: number) => (d === 1 ? { type: { name: "paragraph" }, attrs: {} } : undefined),
          }),
        },
      },
    };
    vi.spyOn(editorManager, "getView").mockReturnValue(noImage as unknown as EditorView);
    let deps = createDefaultImageDeleteDeps();
    expect(deps.resolveOriginalSrc(img)).toBeUndefined();

    // 视图未就绪
    vi.restoreAllMocks();
    vi.spyOn(editorManager, "getView").mockReturnValue(undefined);
    deps = createDefaultImageDeleteDeps();
    expect(deps.resolveOriginalSrc(img)).toBeUndefined();

    // posAtDOM 抛错（元素不属于当前文档树）
    vi.restoreAllMocks();
    const throwing = {
      dom,
      posAtDOM: () => {
        throw new Error("not in doc");
      },
      state: {},
    };
    vi.spyOn(editorManager, "getView").mockReturnValue(throwing as unknown as EditorView);
    deps = createDefaultImageDeleteDeps();
    expect(deps.resolveOriginalSrc(img)).toBeUndefined();
  });

  it("无激活会话时 notify 兜底控制台告警（错误不静默丢失）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = createDefaultImageDeleteDeps();
    deps.notify("error", "测试消息");
    expect(warn).toHaveBeenCalledWith("[MarkWell]", "测试消息");
  });
});
