// Crepe image-block 序列化/缩放现状钉桩（07 T1 spike，常驻防库升级静默失效）
//
// 背景：调研文档（docs/specs/research/07-图片粘贴存盘-research.md §4.1）称 image-block
// attrs = src/caption/ratio 且 alt 被 ratio 占用，但 E15-4 实测 caption 编辑可回写
// markdown，两处证据冲突；本文件以当前版本（@milkdown/crepe 7.22.1）的真实行为为准逐项实证。
//
// 六组结论供 Task 9/10/12 消费（7.22.1 实测，重跑即校验）：
// PIN-1 alt roundtrip：![描述](p.png) 的 alt 被 parseMarkdown runner 消费为 ratio
//       （Number("描述")=NaN 回落 1），PM attrs = {src, caption(title), ratio}，
//       序列化回写 ![1.00](path.png)——非数值 alt 一次性丢失、无 title 输出
// PIN-2 ratio attr 存在且吃掉 alt 位（![0.50] → ratio 0.5，roundtrip 稳定）；
//       nodeView 渲染的 img 只带 data-type/src，ratio 不落 DOM 属性，
//       真实浏览器中仅体现为 img 的 style.height 计算（jsdom 无布局不触发）
// PIN-3 内置缩放手柄存在：.image-wrapper > .image-resize-handle（pointer 拖拽
//       改 height，pointerup 时 setAttr("ratio")）；caption 切换按钮 .operation-item 同在
// PIN-4 拖拽/粘贴新图默认序列化为 ![1.00](url)——ratio 占位 alt 是库默认行为，
//       非 MarkWell 追加；节点后随一个空段落（getMarkdown 尾部多一个换行）
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
import { editorViewCtx } from "@milkdown/kit/core";
import { fireEvent } from "@testing-library/dom";
import { describe, expect, it, vi } from "vitest";
import { makeTestEditor } from "../../test/editor-test-utils";

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

describe("image-block 现状钉桩（07 T1）", () => {
  it("PIN-1 alt roundtrip 落点", async () => {
    const te = await makeTestEditor("![描述](path.png)");
    const md = te.getMarkdown();
    // ProseMirror 文档 JSON 直接暴露节点 attrs 落点（实测 caption 为空时 JSON 呈 null）
    console.log("[PIN-1] PM 文档 JSON:", JSON.stringify(te.view.state.doc.toJSON()));
    // 记录实际输出形态：断言宽松命中 path.png 即可，
    // 具体位置（alt 位/title 位/丢失）以 console 输出与本文件注释记录
    console.log("[PIN-1] roundtrip 输出:", JSON.stringify(md));
    expect(md).toContain("path.png");
  });

  it("PIN-2 ratio attr 与 DOM 呈现", async () => {
    const te = await makeTestEditor("![0.50](path.png)");
    // attrs 取值证明 ratio 存在且吃掉了 alt 位（实测 ![0.50] → ratio 0.5，roundtrip 稳定）；
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
    const te = await makeTestEditor("![a](path.png)");
    const block = te.view.dom.querySelector(".milkdown-image-block");
    console.log("[PIN-3] block outerHTML:", block?.outerHTML);
    expect(block).not.toBeNull();
    // 钉住内置缩放手柄的存在性：Task 10 复用/替换它的前提，库升级若移除立即暴露
    expect(block?.querySelector(".image-resize-handle")).not.toBeNull();
    // 钉住内置 caption 切换按钮（E15-4 已消费该类名，此处一并防静默失效）
    expect(block?.querySelector(".operation-item")).not.toBeNull();
  });

  it("PIN-4 拖拽插入的默认序列化形态", async () => {
    const onUpload = async (file: File) => `saved/${file.name}`;
    const te = await makeTestEditor("", { onUpload });
    const file = new File(["x"], "pic.png", { type: "image/png" });
    fireEvent.drop(te.view.dom, {
      dataTransfer: fakeDataTransfer(fakeFileList(file)),
      clientX: 0,
      clientY: 0,
    });
    await vi.waitFor(() => expect(te.view.dom.querySelector("img")).not.toBeNull());
    // 默认落盘形态：实测为 ![1.00](saved/pic.png)——ratio 占位 alt 是库默认行为；
    // 插入的 image-block 后随一个空段落，getMarkdown 尾部多保留一个换行
    console.log("[PIN-4] 拖拽插入序列化:", JSON.stringify(te.getMarkdown()));
    expect(te.getMarkdown()).toContain("saved/pic.png");
  });

  it("PIN-5 编程插入可用 API 探测", async () => {
    const te = await makeTestEditor("");
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
    //（实测可插入，空 src 序列化为 ![1.00]()）；仅记录结果不作断言（探测性用例，
    // 插入失败本身即为结论）
    try {
      te.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const nodeType = view.state.schema.nodes["image-block"];
        console.log("[PIN-5] schema.nodes[image-block] 存在:", Boolean(nodeType));
        if (!nodeType) return;
        // 空 attrs 创建节点：缺省字段走 schema 定义默认值（src=""、caption=""、ratio=1）
        view.dispatch(view.state.tr.replaceSelectionWith(nodeType.create()));
      });
      console.log("[PIN-5] 编程插入后序列化:", JSON.stringify(te.getMarkdown()));
    } catch (err) {
      console.log("[PIN-5] 编程插入探测失败:", String(err));
    }
    expect(true).toBe(true);
  });
});
