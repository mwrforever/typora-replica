// 缩放渲染 PluginView 测试（07 spec P11 / P10）
//
// 被测契约：
//   AC-P11-1 zoom title 文档（Task 9 schema 解析为 attrs.ratio）→ 对应 DOM img 按 ratio
//            设置内联 style.zoom（jsdom 实测支持该属性，赋值读回一致）；
//   AC-P11-2 无 zoom 的常规图片 → 不设任何 zoom 样式；
//   HTML `<img style="zoom:50%">` 形态经 E20 html 节点渲染天然保留内联 zoom
//   （html img 不在 image-block 映射范围，插件绝不触碰其样式）；
//   P10 单图居中：库内置以 .image-wrapper{width:fit-content;margin:0 auto} 满足，
//   crepe-overrides.css 按实测 DOM 嵌套重申守护规则（直读断言，mermaid-menu.spec 先例）。
//
// 装配说明：本文件以「裸 Crepe + 定制 schema + zoom 插件」最小面装配被测对象
// （image-block-pin.spec 的裸装配同模式），不引入 TOC/html/search 等无关插件；
// 产品工厂的接线由独立的工厂级用例守护（防止单测绿但 create-editor 忘记 use）。
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkwellEditor } from "../editor/create-editor";
import { markwellImageBlockSchema } from "../editor/image-schema";
import { setupHtmlNodeView } from "../editor/html/html-node-view";
import { zoomRenderPlugin } from "./zoom-render";

/** 本 describe 创建的实例清单（afterEach 统一销毁，不经 editor-test-utils 全局登记） */
const liveEditors: { crepe: Crepe; root: HTMLElement }[] = [];

/**
 * 创建缩放渲染测试编辑器（被测最小面：定制 schema + zoom 渲染插件）
 * @param markdown 初始文档内容
 * @returns 编辑器视图句柄（DOM 查询与事务派发用）
 */
async function makeZoomTestEditor(markdown: string): Promise<{ view: EditorView; crepe: Crepe }> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const crepe = new Crepe({ root, defaultValue: markdown });
  // 与产品工厂同源的两项定制：schema 把 zoom title 解析进 attrs.ratio，
  // zoom 插件把 ratio 同步到 DOM img.style.zoom（被测对象）
  crepe.editor.use(markwellImageBlockSchema);
  crepe.editor.use(zoomRenderPlugin);
  // E20 html 节点渲染 NodeView（HTML 内联缩放分支的真实渲染路径），与产品工厂同源；
  // 缺席时 html 块不产出真实 img 元素，AC-P11-1 的 html 形态无从验证
  crepe.editor.config((ctx) => {
    setupHtmlNodeView(ctx);
  });
  await crepe.create();
  liveEditors.push({ crepe, root });
  return { crepe, view: crepe.editor.action((ctx) => ctx.get(editorViewCtx)) };
}

describe("zoom 渲染 PluginView", () => {
  afterEach(async () => {
    for (const { crepe, root } of liveEditors.splice(0)) {
      try {
        await crepe.destroy();
      } catch {
        // 销毁失败不阻塞用例收尾
      }
      root.remove();
    }
  });

  it("AC-P11-1 zoom:0.50 文档 → img 按 50% 缩放渲染", async () => {
    const te = await makeZoomTestEditor('![a](p.png "zoom:0.50")');
    const img = te.view.dom.querySelector<HTMLImageElement>("img");
    expect(img).not.toBeNull();
    // jsdom 实测：style.zoom = "0.5" 读回 "0.5"（cssText 同步落地）
    expect(img!.style.zoom).toBe("0.5");
  });

  it("AC-P11-2 无 zoom title → 不设 zoom 样式", async () => {
    const te = await makeZoomTestEditor("![a](p.png)");
    const img = te.view.dom.querySelector<HTMLImageElement>("img")!;
    expect(img.style.zoom).toBe("");
  });

  it("显式 zoom:1.00 title（ratio=1）→ 清空样式不残留", async () => {
    const te = await makeZoomTestEditor('![a](p.png "zoom:1.00")');
    const img = te.view.dom.querySelector<HTMLImageElement>("img")!;
    // ratio=1 属无缩放语义：即使曾设置过（如外部改 attr），同步后必须清空
    expect(img.style.zoom).toBe("");
  });

  it("事务后新增缩放图 → update 路径即时同步", async () => {
    // 初始空文档创建（PluginView 构造期无图可同步），经事务编程插入 ratio=0.5 图
    const te = await makeZoomTestEditor("");
    const imageBlockType = te.view.state.schema.nodes["image-block"]!;
    te.view.dispatch(
      te.view.state.tr.replaceSelectionWith(
        imageBlockType.create({ src: "p.png", caption: "", ratio: 0.5, rawTitle: "" }),
      ),
    );
    const img = te.view.dom.querySelector<HTMLImageElement>("img")!;
    // update 钩子在事务后执行：新节点 ratio 即时映射到 DOM（不等下一次编辑）
    expect(img.style.zoom).toBe("0.5");
  });

  it("初始文档即含缩放图 → 构造期首屏同步（不等首个事务）", async () => {
    // 反向场景：PluginView 创建后 ProseMirror 不会主动调 update，
    // 打开含缩放图的文档必须构造期就完成一次全量同步
    const te = await makeZoomTestEditor('首段\n\n![](pic.png "zoom:1.50")\n\n尾段');
    const img = te.view.dom.querySelector<HTMLImageElement>('img[src="pic.png"]')!;
    expect(img.style.zoom).toBe("1.5");
  });
});

describe("HTML img 内联 zoom 天然保留（E20 html 节点）", () => {
  afterEach(async () => {
    for (const { crepe, root } of liveEditors.splice(0)) {
      try {
        await crepe.destroy();
      } catch {
        // 销毁失败不阻塞用例收尾
      }
      root.remove();
    }
  });

  it("<img style='zoom:50%'> 编辑视图按原样保留内联缩放", async () => {
    const te = await makeZoomTestEditor('<img src="x.png" style="zoom:50%">');
    // html 节点内的外来 img 不带 data-type、不在 image-block 子树内，
    // 插件遍历恒不命中——Typora 形态的 HTML 缩放零干预保留（AC-P11-1 html 分支）
    const img = te.view.dom.querySelector<HTMLImageElement>('img[src="x.png"]')!;
    expect(img.style.zoom).toBe("50%");
    // 原始内联 style 属性未被改写（导出侧原文保真由 e20-html.spec 守护，此处钉显示侧）
    expect(img.getAttribute("style")).toContain("zoom:50%");
  });

  it("混合文档：markdown 缩放图与 HTML 缩放图互不干扰", async () => {
    const te = await makeZoomTestEditor(
      '![a](p.png "zoom:0.50")\n\n<img src="x.png" style="zoom:30%">',
    );
    // markdown 侧按 ratio 渲染
    expect(te.view.dom.querySelector<HTMLImageElement>('img[src="p.png"]')!.style.zoom).toBe("0.5");
    // html 侧原样保留（若插件误扫全部 img 并清空非命中项，此断言即红）
    expect(te.view.dom.querySelector<HTMLImageElement>('img[src="x.png"]')!.style.zoom).toBe("30%");
  });
});

describe("P10 单图居中（库内置行为 + 守护规则钉桩）", () => {
  afterEach(async () => {
    for (const { crepe, root } of liveEditors.splice(0)) {
      try {
        await crepe.destroy();
      } catch {
        // 销毁失败不阻塞用例收尾
      }
      root.remove();
    }
  });

  it("crepe-overrides.css 含实测选择器的单图居中守护规则（亮/暗两段）", () => {
    // 直读样式文件断言（mermaid-menu.spec 先例）：Crepe 内置已让 .image-wrapper 居中，
    // 此规则按 MarkWell 实测 DOM 嵌套重申，防库升级静默移除内置居中时漂移。
    // 亮色段是当前应用形态（markwell-dark 由 08 落地、现阶段恒亮色）下真实生效的守护；
    // 暗色段保证 08 激活后行为不变（审查 I-1）
    const css = readFileSync(resolve("src/styles/crepe-overrides.css"), "utf8");
    // 行首锚定：暗色选择器行含「.markwell-dark .milkdown …」前缀，无锚定时会
    // 作为子串命中亮色正则造成假绿
    expect(css).toMatch(
      /^\.milkdown \.milkdown-image-block > \.image-wrapper\s*\{[^}]*margin-inline:\s*auto/m,
    );
    expect(css).toMatch(
      /^\.markwell-dark \.milkdown \.milkdown-image-block > \.image-wrapper\s*\{[^}]*margin-inline:\s*auto/m,
    );
  });

  it("单图文档 DOM 为顶层 image-block 且 img 在 image-wrapper 内（选择器命中前提）", async () => {
    const te = await makeZoomTestEditor("![](pic.png)");
    // T12 实测钉桩：image-block 是 doc 顶层块节点而非 p 子元素——官方
    // `p .md-image:only-child` 选择器在 MarkWell DOM 不适用，居中选择器必须走本形态
    const block = te.view.dom.querySelector(".milkdown .milkdown-image-block");
    expect(block).not.toBeNull();
    // img 的直接命中路径 = 选择器的目标子链（> .image-wrapper > img）
    expect(block!.querySelector(":scope > .image-wrapper > img")).not.toBeNull();
  });
});

describe("createMarkwellEditor 工厂接线（use 防遗漏）", () => {
  afterEach(async () => {
    for (const { crepe, root } of liveEditors.splice(0)) {
      try {
        await crepe.destroy();
      } catch {
        // 销毁失败不阻塞用例收尾
      }
      root.remove();
    }
  });

  it("产品工厂渲染 zoom 文档即生效（接线回归守护）", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const crepe = createMarkwellEditor(root, '![a](p.png "zoom:0.50")');
    await crepe.create();
    liveEditors.push({ crepe, root });
    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx));
    const img = view.dom.querySelector<HTMLImageElement>("img")!;
    // 若 create-editor.ts 移除 use(zoomRenderPlugin)，此处回落空串即红
    expect(img.style.zoom).toBe("0.5");
  });
});
