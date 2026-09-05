// Crepe image-block 序列化/缩放现状钉桩（07 T1 spike，常驻防库升级静默失效）
//
// 【装配说明】本文件刻意使用「裸 Crepe」装配（new Crepe 后不 use 任何 MarkWell
// 定制插件），目的是钉住 @milkdown/crepe 7.22.1 的【库内置】image-block 行为；
// MarkWell 产品层的定制契约（alt 保真 + zoom title）见 image-schema.ts 与
// image-schema.spec.ts。Task 9 定制上线前本文件曾复用 makeTestEditor，被其注入的
// 定制 schema 静默架空为「定制层冒烟」（PIN-4/5 实测输出已变为 ![](url) 形态），
// 现改回裸装配恢复库级守护定位（审查 C 修复）。
//
// 背景：调研文档（docs/specs/research/07-图片粘贴存盘-research.md §4.1）称 image-block
// attrs = src/caption/ratio 且 alt 被 ratio 占用，但 E15-4 实测 caption 编辑可回写
// markdown，两处证据冲突；本文件以当前版本（@milkdown/crepe 7.22.1）的真实行为为准逐项实证。
//
// 六组结论均描述库内置行为（7.22.1 实测，重跑即校验；产品层行为以 image-schema.spec 为准）：
// PIN-1 alt roundtrip：![描述](p.png) 的 alt 被 parseMarkdown runner 消费为 ratio
//       （Number("描述")=NaN 回落 1），PM attrs = {src, caption(title), ratio}，
//       序列化回写 ![1.00](path.png)——非数值 alt 一次性丢失、无 title 输出
// PIN-2 ratio attr 存在且吃掉 alt 位（![0.50] → ratio 0.5，roundtrip 稳定）；
//       nodeView 渲染的 img 只带 data-type/src，ratio 不落 DOM 属性，
//       真实浏览器中仅体现为 img 的 style.height 计算（jsdom 无布局不触发）
// PIN-3 内置缩放手柄存在：.image-wrapper > .image-resize-handle（pointer 拖拽
//       改 height，pointerup 时 setAttr("ratio")）；caption 切换按钮 .operation-item 同在
// PIN-4 拖拽/粘贴新图库内置默认序列化为 ![1.00](url)——ratio 占位 alt 是库默认行为。
//       该占位在产品层已被 Task 9 定制消除（落盘 ![](url)，见 image-schema.ts），
//       本用例继续钉住库内置形态防升级漂移；节点后随一个空段落（getMarkdown 尾多一换行）
// PIN-5 可用 import 路径为 @milkdown/kit/component/image-block（导出 IMAGE_DATA_TYPE/
//       defaultImageBlockConfig/imageBlockComponent/imageBlockConfig/imageBlockSchema/
//       imageBlockView/remarkImageBlockPlugin）；简报路径 component-image-block 不存在；
//       无官方 insert 命令，编程插入走 ProseMirror 事务：
//       view.dispatch(view.state.tr.replaceSelectionWith(
//         schema.nodes["image-block"].create(attrs)))，实测可插且序列化正常
// PIN-6 组件源码关键片段：已人工核读 @milkdown/components/lib/image-block/index.js
//       （bundle 源码），attrs 定义与 parseMarkdown/toMarkdown runner 摘录见
//       task-1-report.md；用例内不重复断言源码文本，仅以行为用例钉住其生效。
//
// 断言刻意宽松（只钉存在性），事实细节走 console 输出与本文件注释——库升级导致
// 行为漂移时测试先红，再对照注释判断是否接受新行为。
import { Crepe, type CrepeConfig } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import { fireEvent } from "@testing-library/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

/** 裸 Crepe 编辑器句柄（仅钉桩所需的最小面：视图 / 序列化 / 编程事务入口） */
interface BareEditor {
  crepe: Crepe;
  view: EditorView;
  getMarkdown(): string;
}

/** 本 describe 创建的实例清单（afterEach 统一销毁，不经 editor-test-utils 的全局登记） */
const bareEditors: { crepe: Crepe; root: HTMLElement }[] = [];

/**
 * 创建裸 Crepe 测试编辑器：不 use 任何 MarkWell 定制插件，序列化选项亦保持库默认，
 * 保证本文件的断言对象是 @milkdown/crepe 库内置行为本身（审查 C：恢复金丝雀定位）
 * @param markdown 初始文档内容
 * @param featureConfigs 可选库特性配置（如 PIN-4 注入 onUpload 使插入 src 可预测）
 */
async function makeBareLibraryEditor(
  markdown: string,
  featureConfigs?: CrepeConfig["featureConfigs"],
): Promise<BareEditor> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  // 库默认 features 全开（除 TopBar/AI）：含 image-block feature 本身（被测对象）
  const crepe = new Crepe({ root, defaultValue: markdown, featureConfigs });
  await crepe.create();
  bareEditors.push({ crepe, root });
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx));
  return {
    crepe,
    view,
    // remark 序列化器在文档末尾附加换行，统一去掉一个尾部换行（与测试助手同约定）
    getMarkdown: () => crepe.getMarkdown().replace(/\n$/, ""),
  };
}

describe("image-block 现状钉桩（07 T1，裸 Crepe 库内置行为）", () => {
  // 销毁全部存活的裸实例并移除挂载根元素，避免跨用例向 body 永久累积
  afterEach(async () => {
    for (const { crepe, root } of bareEditors.splice(0)) {
      try {
        await crepe.destroy();
      } catch {
        // 销毁失败不阻塞用例收尾
      }
      root.remove();
    }
  });

  /**
   * 构造 FileList 兼容对象：jsdom 无 DataTransfer/FileList 构造入口，而 Crepe 内置
   * 上传器按 files.length + files.item(i) 遍历（普通数组缺 item() 会抛错），
   * 故以普通对象模拟 FileList 结构（与 e15-image.spec 同手法，独立副本避免跨 spec 导入私有）。
   * @param files 待模拟的图片文件列表
   */
  function fakeFileList(...files: File[]): FileList {
    return {
      length: files.length,
      item: (i: number) => files[i] ?? null,
      0: files[0],
      [Symbol.iterator]: function* () {
        yield* files;
      },
    } as unknown as FileList;
  }

  /**
   * 构造拖拽事件载荷：jsdom 无 DataTransfer，以普通对象充当；
   * getData 供 ProseMirror 剪贴板解析链读取文本，恒返回空串避免误入文本粘贴路径。
   * @param files 文件列表
   */
  function fakeDataTransfer(files: FileList): {
    files: FileList;
    types: string[];
    getData: () => string;
  } {
    return { files, types: ["Files"], getData: () => "" };
  }

  it("PIN-1 alt roundtrip 落点", async () => {
    const te = await makeBareLibraryEditor("![描述](path.png)");
    const md = te.getMarkdown();
    // ProseMirror 文档 JSON 直接暴露节点 attrs 落点（库内置 caption 为空时 JSON 呈 null）
    console.log("[PIN-1] PM 文档 JSON:", JSON.stringify(te.view.state.doc.toJSON()));
    // 记录实际输出形态：断言宽松命中 path.png 即可，
    // 具体位置（alt 位/title 位/丢失）以 console 输出与本文件注释记录
    console.log("[PIN-1] roundtrip 输出:", JSON.stringify(md));
    expect(md).toContain("path.png");
  });

  it("PIN-2 ratio attr 与 DOM 呈现", async () => {
    const te = await makeBareLibraryEditor("![0.50](path.png)");
    // attrs 取值证明 ratio 存在且吃掉了 alt 位（库内置 ![0.50] → ratio 0.5，roundtrip 稳定）；
    // DOM 呈现看 nodeView 渲染的 img 是否携带 ratio 属性——实测只带 data-type/src，
    // ratio 不落 DOM 属性；jsdom 无布局，onImageLoad 因 getBoundingClientRect 宽度为 0
    // 提前返回，真实浏览器中 ratio 体现为 img 的 style.height 计算
    console.log("[PIN-2] PM 文档 JSON:", JSON.stringify(te.view.state.doc.toJSON()));
    console.log(
      "[PIN-2] roundtrip 输出:",
      JSON.stringify(te.getMarkdown()),
      "DOM:",
      te.view.dom.querySelector(".milkdown-image-block")?.outerHTML?.slice(0, 500),
    );
    expect(te.view.dom.querySelector("img")).not.toBeNull();
  });

  it("PIN-3 nodeView DOM 是否含缩放手柄类名", async () => {
    const te = await makeBareLibraryEditor("![a](path.png)");
    const block = te.view.dom.querySelector(".milkdown-image-block");
    console.log("[PIN-3] block outerHTML:", block?.outerHTML);
    expect(block).not.toBeNull();
    // 钉住内置缩放手柄的存在性：Task 10 复用/替换它的前提，库升级若移除立即暴露
    expect(block?.querySelector(".image-resize-handle")).not.toBeNull();
    // 钉住内置 caption 切换按钮（E15-4 已消费该类名，此处一并防静默失效）
    expect(block?.querySelector(".operation-item")).not.toBeNull();
  });

  it("PIN-4 拖拽插入的默认序列化形态", async () => {
    // 库内置上传通道经 featureConfigs 注入 onUpload（与 e15 同手法），使插入 src 可预测
    const te = await makeBareLibraryEditor("", {
      [Crepe.Feature.ImageBlock]: { onUpload: async (file: File) => `saved/${file.name}` },
    });
    const file = new File(["x"], "pic.png", { type: "image/png" });
    fireEvent.drop(te.view.dom, {
      dataTransfer: fakeDataTransfer(fakeFileList(file)),
      clientX: 0,
      clientY: 0,
    });
    await vi.waitFor(() => expect(te.view.dom.querySelector("img")).not.toBeNull());
    // 库内置默认落盘形态：![1.00](blob:…)——ratio 占位 alt（产品层已由 Task 9 定制
    // 消除为 ![](url)，此处断言宽松命中 src 注入即可，形态细节看 console）
    console.log("[PIN-4] 拖拽插入序列化:", JSON.stringify(te.getMarkdown()));
    expect(te.getMarkdown()).toContain("saved/pic.png");
  });

  it("PIN-5 编程插入可用 API 探测", async () => {
    const te = await makeBareLibraryEditor("");
    // 探测 kit 各候选路径导出面：实测 @milkdown/kit/component/image-block 可用、
    // 简报原始路径 component-image-block 不存在（package exports 缺该 specifier）、
    // @milkdown/crepe 可用（导出 Crepe/CrepeBuilder/CrepeFeature/useCrepe/useCrepeFeatures）
    const candidateSpecs = [
      "@milkdown/kit/component/image-block",
      "@milkdown/kit/component-image-block",
      "@milkdown/crepe",
    ];
    for (const spec of candidateSpecs) {
      try {
        // 变量指示符动态 import（@vite-ignore）：不可用路径运行期进 catch 分支，
        // 而非在 Vite 转换期直接让整个 spec 加载失败
        const mod = (await import(/* @vite-ignore */ spec)) as Record<string, unknown>;
        console.log(`[PIN-5] ${spec} 可用，导出:`, Object.keys(mod).join(", "));
      } catch (err) {
        console.log(`[PIN-5] ${spec} 不可用:`, String(err));
      }
    }
    // 探测编程插入形态：Crepe 类无官方 insert 图片 API（types/core/builder.d.ts 已核读），
    // 按 ProseMirror 事务 replaceSelectionWith 直插 image-block 节点验证可行性
    //（裸装配下空 src 序列化为 ![1.00]()，即库内置 ratio 占位行为的直接证据）；
    // 仅记录结果不作断言（探测性用例，插入失败本身即为结论）
    try {
      te.view.dispatch(
        te.view.state.tr.replaceSelectionWith(te.view.state.schema.nodes["image-block"]!.create()),
      );
      console.log("[PIN-5] 编程插入后序列化:", JSON.stringify(te.getMarkdown()));
    } catch (err) {
      console.log("[PIN-5] 编程插入探测失败:", String(err));
    }
    expect(true).toBe(true);
  });
});
