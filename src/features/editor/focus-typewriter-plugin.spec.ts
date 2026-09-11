// Focus/Typewriter 插件测试（12 窗口外壳 W5；AC-M-9/10/11/12 编辑器侧行为）
//
// 断言口径全部面向 DOM 类名契约与滚动副作用（用户可见行为），不触插件内部 state：
// - AC-M-10：F8 后根容器 on-focus-mode、当前块 md-focus、容器链 md-focus-container、
//   其余叶子块 md-end-block，关闭后全清；
// - AC-M-11/12：Typewriter 输入（docChanged）恒滚动居中；纯光标移动（点击/方向键）
//   仅在点击居中偏好开启时滚动；
// - 滚动几何为 jsdom 零布局环境：coordsAtPos 以 spy 注入屏幕坐标，滚动容器为
//   document scrolling box（与产品 body 滚动形态一致）。
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cursorCenterDelta,
  focusTypewriterPlugin,
  getFocusTypewriterConfig,
  resolveScrollSurface,
  setFocusTypewriterConfig,
  shouldCenterCursor,
} from "./focus-typewriter-plugin";
import type { Editor } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import { destroyTestEditors, makeTestEditor } from "../../test/editor-test-utils";

/** 取指定文本所在 PM 文档位置（避免手工计算块边界位置，用例健壮性） */
function posOfText(view: EditorView, needle: string): number {
  let found = -1;
  view.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && (node.text ?? "").startsWith(needle)) {
      found = pos;
    }
    return true;
  });
  expect(found).toBeGreaterThanOrEqual(0);
  return found;
}

afterEach(async () => {
  await destroyTestEditors();
  // 滚动副作用落在 document scrolling box（html 元素），逐用例复位防跨用例污染
  document.documentElement.scrollTop = 0;
  vi.restoreAllMocks();
});

describe("Focus 模式装饰（AC-M-10 类名契约）", () => {
  it("开启后根容器挂 on-focus-mode，当前块 md-focus、其余叶子块 md-end-block（AC-M-10）", async () => {
    const te = await makeTestEditor("段落一\n\n段落二");
    setFocusTypewriterConfig(te.editor, { focusEnabled: true });
    expect(te.view.dom.classList.contains("on-focus-mode")).toBe(true);
    // 初始光标在首段：首段 md-focus；全部叶子块（含当前块）皆挂 md-end-block 契约类
    expect(te.view.dom.querySelector(".md-focus")?.textContent).toBe("段落一");
    const endBlocks = [...te.view.dom.querySelectorAll(".md-end-block")];
    expect(endBlocks.map((el) => el.textContent)).toEqual(["段落一", "段落二"]);
    // 顶层叶子块非容器：不应出现容器类
    expect(te.view.dom.querySelectorAll(".md-focus-container")).toHaveLength(0);
  });

  it("光标移动到其他块时 md-focus 跟随（淡化的当前块随选区迁移）", async () => {
    const te = await makeTestEditor("段落一\n\n段落二\n\n标题");
    setFocusTypewriterConfig(te.editor, { focusEnabled: true });
    expect(te.view.dom.querySelector(".md-focus")?.textContent).toBe("段落一");
    te.setSelection(posOfText(te.view, "段落二") + 1, posOfText(te.view, "段落二") + 1);
    expect(te.view.dom.querySelector(".md-focus")?.textContent).toBe("段落二");
    expect(te.view.dom.classList.contains("on-focus-mode")).toBe(true);
  });

  it("光标在引用块内段落时外层容器挂 md-focus-container（容器链语义）", async () => {
    const te = await makeTestEditor("段落一\n\n> 引文一\n>\n> 引文二");
    setFocusTypewriterConfig(te.editor, { focusEnabled: true });
    // 光标移入引用块首段内部
    const quoteStart = posOfText(te.view, "引文一");
    te.setSelection(quoteStart + 1, quoteStart + 1);
    // 容器类挂引用块 DOM，当前段挂 md-focus，同引用块内非当前段仍是待淡化叶子块
    expect(te.view.dom.querySelector("blockquote")?.classList.contains("md-focus-container")).toBe(
      true,
    );
    expect(te.view.dom.querySelector(".md-focus")?.textContent).toBe("引文一");
    const endBlocks = [...te.view.dom.querySelectorAll(".md-end-block")].map(
      (el) => el.textContent,
    );
    expect(endBlocks).toContain("引文二");
    expect(endBlocks).toContain("段落一");
  });

  it("关闭后根容器与全部装饰类清空（AC-M-10 关闭清理）", async () => {
    const te = await makeTestEditor("段落一\n\n段落二");
    setFocusTypewriterConfig(te.editor, { focusEnabled: true });
    expect(te.view.dom.classList.contains("on-focus-mode")).toBe(true);
    setFocusTypewriterConfig(te.editor, { focusEnabled: false });
    expect(te.view.dom.classList.contains("on-focus-mode")).toBe(false);
    expect(te.view.dom.querySelectorAll(".md-focus")).toHaveLength(0);
    expect(te.view.dom.querySelectorAll(".md-focus-container")).toHaveLength(0);
    expect(te.view.dom.querySelectorAll(".md-end-block")).toHaveLength(0);
  });

  it("无内容/选区变化的空事务走装饰重映射路径（类名保持稳定不重算）", async () => {
    const te = await makeTestEditor("段落一\n\n段落二");
    setFocusTypewriterConfig(te.editor, { focusEnabled: true });
    expect(te.view.dom.querySelectorAll(".md-end-block")).toHaveLength(2);
    // 其他插件可能派发纯 meta 事务：装饰经 mapping 原样保留
    expect(() => te.view.dispatch(te.view.state.tr)).not.toThrow();
    expect(te.view.dom.querySelectorAll(".md-end-block")).toHaveLength(2);
    expect(te.view.dom.querySelector(".md-focus")?.textContent).toBe("段落一");
  });
});

describe("Typewriter 滚动（AC-M-11/12 触发条件与居中偏移）", () => {
  /** 注入光标屏幕坐标（jsdom 无布局，coordsAtPos 恒零 → spy 出可控几何） */
  function stubCursorCoords(te: Awaited<ReturnType<typeof makeTestEditor>>): void {
    vi.spyOn(te.view, "coordsAtPos").mockReturnValue({
      top: 600,
      bottom: 620,
      left: 0,
      right: 0,
    });
  }

  it("开启 Typewriter 后输入文字滚动居中：光标中心超出视口中线的偏移写入滚动容器（AC-M-11）", async () => {
    const te = await makeTestEditor("段落");
    stubCursorCoords(te);
    setFocusTypewriterConfig(te.editor, { typewriterEnabled: true });
    // 开启即居中（官方行为：启用打字机后光标立即归中）：610 − 768/2 = 226
    expect(document.documentElement.scrollTop).toBe(226);
    document.documentElement.scrollTop = 0;
    te.insertText("字");
    expect(document.documentElement.scrollTop).toBe(226);
  });

  it("纯光标移动默认滚动居中（点击居中偏好默认开，AC-M-12）", async () => {
    const te = await makeTestEditor("段落");
    stubCursorCoords(te);
    setFocusTypewriterConfig(te.editor, { typewriterEnabled: true });
    document.documentElement.scrollTop = 0;
    const target = posOfText(te.view, "段") + 1;
    te.setSelection(target, target);
    expect(document.documentElement.scrollTop).toBe(226);
  });

  it("点击居中偏好关闭后纯光标移动不滚动，输入仍滚动（AC-M-12 偏好关断言）", async () => {
    const te = await makeTestEditor("段落");
    stubCursorCoords(te);
    setFocusTypewriterConfig(te.editor, { typewriterEnabled: true, typewriterClickCenter: false });
    document.documentElement.scrollTop = 0;
    // 纯选区变化（模拟点击落点）：偏好关 → 不滚动
    const target = posOfText(te.view, "段") + 1;
    te.setSelection(target, target);
    expect(document.documentElement.scrollTop).toBe(0);
    // 输入（doc 变更）：打字机核心语义，偏好关也滚动
    te.insertText("字");
    expect(document.documentElement.scrollTop).toBe(226);
  });

  it("居中死区：偏移小于 1px 不写滚动（防浮点抖动）", async () => {
    const te = await makeTestEditor("段落");
    // 光标中心恰在视口垂直中线（(374+394)/2 = 384 = 768/2）→ 零偏移不滚动
    vi.spyOn(te.view, "coordsAtPos").mockReturnValue({
      top: 374,
      bottom: 394,
      left: 0,
      right: 0,
    });
    setFocusTypewriterConfig(te.editor, { typewriterEnabled: true });
    expect(document.documentElement.scrollTop).toBe(0);
  });

  it("关闭 Typewriter 后不再滚动（配置关闭路径）", async () => {
    const te = await makeTestEditor("段落");
    stubCursorCoords(te);
    setFocusTypewriterConfig(te.editor, { typewriterEnabled: true });
    setFocusTypewriterConfig(te.editor, { typewriterEnabled: false });
    document.documentElement.scrollTop = 0;
    te.insertText("字");
    expect(document.documentElement.scrollTop).toBe(0);
  });

  it("存在 overflow 滚动祖先时以就近滚动容器为面（块级容器路径）", async () => {
    // 模拟外层滚动容器形态：编辑器根被包进 overflow-y auto 容器
    const te = await makeTestEditor("段落");
    stubCursorCoords(te);
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    document.body.appendChild(scroller);
    // makeTestEditor 的根 div 直接挂 body：自视图 DOM 上溯到 body 直属子级即根
    let editorRoot: HTMLElement = te.view.dom;
    while (editorRoot.parentElement && editorRoot.parentElement !== document.body) {
      editorRoot = editorRoot.parentElement;
    }
    scroller.appendChild(editorRoot);
    setFocusTypewriterConfig(te.editor, { typewriterEnabled: true });
    // 光标中心 610 − 容器可视中线 0（jsdom 零布局）= 610 全额写入容器 scrollTop
    expect(scroller.scrollTop).toBe(610);
    // 文档滚动面不受影响（滚动落在容器面上）
    expect(document.documentElement.scrollTop).toBe(0);
  });

  it("resolveScrollSurface：overflow-y auto/scroll 祖先就近命中，无则回落文档滚动面", () => {
    // 命中块级容器面：scrollBy 写入容器 scrollTop
    const scroller = document.createElement("div");
    scroller.style.overflowY = "scroll";
    const inner = document.createElement("div");
    scroller.appendChild(inner);
    document.body.appendChild(scroller);
    resolveScrollSurface(inner).scrollBy(40);
    expect(scroller.scrollTop).toBe(40);
    // 无 overflow 祖先：回落文档滚动面（scrollBy 落在 html 元素上）
    const plain = document.createElement("div");
    document.body.appendChild(plain);
    document.documentElement.scrollTop = 0;
    resolveScrollSurface(plain).scrollBy(25);
    expect(document.documentElement.scrollTop).toBe(25);
    document.documentElement.scrollTop = 0;
  });
});

describe("滚动几何纯函数（jsdom 零布局下的可测核心）", () => {
  it("cursorCenterDelta：光标中心减视口中线（正下负上）", () => {
    expect(cursorCenterDelta(600, 620, 0, 768)).toBe(226);
    expect(cursorCenterDelta(100, 120, 0, 768)).toBe(-274);
    expect(cursorCenterDelta(374, 394, 100, 568)).toBe(0);
  });

  it("shouldCenterCursor：关闭恒不滚，开启即滚，输入恒滚，纯移动看偏好", () => {
    // 关闭态：任何触发源都不滚动
    expect(
      shouldCenterCursor({
        wasEnabled: false,
        nowEnabled: false,
        docChanged: true,
        selectionChanged: true,
        clickCenter: true,
      }),
    ).toBe(false);
    // 刚开启：立即居中一次（官方行为）
    expect(
      shouldCenterCursor({
        wasEnabled: false,
        nowEnabled: true,
        docChanged: false,
        selectionChanged: false,
        clickCenter: false,
      }),
    ).toBe(true);
    // 输入（doc 变更）：偏好关也滚动（打字机核心语义）
    expect(
      shouldCenterCursor({
        wasEnabled: true,
        nowEnabled: true,
        docChanged: true,
        selectionChanged: true,
        clickCenter: false,
      }),
    ).toBe(true);
    // 纯光标移动：偏好开滚动 / 偏好关不滚
    expect(
      shouldCenterCursor({
        wasEnabled: true,
        nowEnabled: true,
        docChanged: false,
        selectionChanged: true,
        clickCenter: true,
      }),
    ).toBe(true);
    expect(
      shouldCenterCursor({
        wasEnabled: true,
        nowEnabled: true,
        docChanged: false,
        selectionChanged: true,
        clickCenter: false,
      }),
    ).toBe(false);
    // 无变化不滚动
    expect(
      shouldCenterCursor({
        wasEnabled: true,
        nowEnabled: true,
        docChanged: false,
        selectionChanged: false,
        clickCenter: true,
      }),
    ).toBe(false);
  });
});

describe("配置读写门面（12 控制器消费面）", () => {
  it("getFocusTypewriterConfig 读回当前配置，缺省即默认值", async () => {
    const te = await makeTestEditor("段落");
    expect(getFocusTypewriterConfig(te.editor)).toEqual({
      focusEnabled: false,
      typewriterEnabled: false,
      typewriterClickCenter: true,
    });
    setFocusTypewriterConfig(te.editor, { focusEnabled: true });
    expect(getFocusTypewriterConfig(te.editor)?.focusEnabled).toBe(true);
    // 未触及键保持默认（补丁式合并）
    expect(getFocusTypewriterConfig(te.editor)?.typewriterClickCenter).toBe(true);
  });

  it("编辑器未就绪（ctx 不可用）时读写安全降级：读返回 undefined、写静默", () => {
    // 与 EditorPage adopt 竞态先例同口径：action 抛错即实例未就绪
    const brokenEditor = {
      action: () => {
        throw new Error("ctx 未就绪");
      },
    } as unknown as Editor;
    expect(getFocusTypewriterConfig(brokenEditor)).toBeUndefined();
    expect(() => setFocusTypewriterConfig(brokenEditor, { focusEnabled: true })).not.toThrow();
  });

  it("插件随工厂装配（模块导出可用作 editor.use 入参）", async () => {
    const te = await makeTestEditor("段落");
    // makeTestEditor 与产品工厂同源注入：插件在位时配置读写即生效
    expect(focusTypewriterPlugin).toBeTruthy();
    setFocusTypewriterConfig(te.editor, { focusEnabled: true });
    expect(te.view.dom.classList.contains("on-focus-mode")).toBe(true);
  });
});
