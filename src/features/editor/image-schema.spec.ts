// image-block schema 定制测试（07 Task 9）：alt 保真 roundtrip / zoom title 双向 /
// 空 alt 新插形态（AC-P11-3/4）
//
// 装配方式：makeTestEditor 在 editor-test-utils.ts 注入 markwellImageBlockSchema
// （与产品工厂 create-editor.ts 同源一行 use），全部用例经标准入口获得定制行为；
// 编程插入沿 T1 PIN-5 实证 API（tr.replaceSelectionWith）。
import { editorViewCtx } from "@milkdown/kit/core";
import { fireEvent } from "@testing-library/dom";
import { describe, expect, it, vi } from "vitest";
import { makeTestEditor, type TestEditor } from "../../test/editor-test-utils";

describe("image-block schema 定制（07）", () => {
  it("AC-P11-3 alt 原样往返（非 ![1.00] 形态）", async () => {
    const te = await makeTestEditor("![描述](path.png)");
    expect(te.getMarkdown()).toContain("![描述](path.png)");
  });

  it("AC-P11-3 多次保存（双重 roundtrip）alt 仍保真", async () => {
    // 「打开后任意次保存」等价于序列化产物再次喂回编辑器后不漂移
    const first = await makeTestEditor("![描述](path.png)");
    const once = first.getMarkdown();
    const second = await makeTestEditor(once);
    expect(second.getMarkdown()).toBe(once);
  });

  it("zoom title 解析进 ratio 且序列化还原", async () => {
    const te = await makeTestEditor('![a](p.png "zoom:0.50")');
    expect(te.getMarkdown()).toBe('![a](p.png "zoom:0.50")');
  });

  it("ratio=1 不产出 title", async () => {
    const te = await makeTestEditor("![a](p.png)");
    expect(te.getMarkdown()).toBe("![a](p.png)");
  });

  it("真实 title 不被误判为 zoom 且 roundtrip 保真", async () => {
    const te = await makeTestEditor('![a](p.png "画册")');
    expect(te.getMarkdown()).toBe('![a](p.png "画册")');
  });

  it("非数字旧 ratio 形态 ![1.00](p) 的兼容读取（历史文档 alt 不复活为乱码）", async () => {
    // 旧 Crepe 落盘 ![0.50](p)：alt 位是数字。定制后 parse 应识别「纯 ratio 形态」
    // 并迁移到 zoom title；无法可靠区分「真 alt 恰为数字」——按 Typora 语义数字
    // alt 无意义，接受迁移（PR 披露）
    const te = await makeTestEditor("![0.50](p.png)");
    expect(te.getMarkdown()).toBe('![](p.png "zoom:0.50")');
  });

  it("新插图片（粘贴/拖拽）落盘空 alt 形态 ![](path)", async () => {
    // spec P2：粘贴图片 alt 为空（用户实测#3 对齐 Typora）；经 onUpload 返回 src 后
    // schema 序列化不得给新节点补默认 alt/ratio 文本
    const te = await makeTestEditorWithInsertedImage("saved/pic.png");
    expect(te.getMarkdown()).toContain("![](saved/pic.png)");
  });

  it("缩放 attr 锁定两位小数落盘（0.75 → zoom:0.75）且 caption 写 alt 位", async () => {
    // 编程构造 caption + ratio≠0 节点：模拟缩放手柄 pointerup setAttr("ratio") 后
    // 的下一次保存形态——caption 必须落在 alt 位、比例挂 zoom title 命名空间
    const te = await makeTestEditor("");
    te.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const nodeType = view.state.schema.nodes["image-block"];
      view.dispatch(
        view.state.tr.replaceSelectionWith(
          nodeType.create({ src: "p.png", caption: "图注", ratio: 0.75 }),
        ),
      );
    });
    // 编程插入的 image-block 节点后随一个空段落（T1 PIN-4），序列化尾部多一换行，
    // trim 后做全等断言以聚焦 alt/title 位形态本身
    expect(te.getMarkdown().trim()).toBe('![图注](p.png "zoom:0.75")');
  });

  it("编辑器内 DOM 粘贴图片块 title 经 parseDOM 存活（审查 A 回归）", async () => {
    // 编辑器内复制/拖拽图片块的 HTML 产物经 toDOM 平铺含 rawTitle；粘贴走 parseDOM
    // 链，getAttrs 必须读回 rawTitle 否则 title 在编辑器内流转一次即静默丢失。
    // ratio=1 场景（title 位无 zoom 占用）下 rawTitle 应原样还原到 markdown title 位
    const te = await makeTestEditor("");
    // jsdom 无 DataTransfer 构造入口（沿 e15 spec 手法以普通对象充当），
    // getData 返回带 rawTitle 属性的图片块 HTML，files 置空避免误入文件上传路径
    fireEvent.paste(te.view.dom, {
      clipboardData: {
        files: { length: 0, item: () => null },
        types: ["text/html"],
        getData: (type: string) =>
          type === "text/html"
            ? '<div><img data-type="image-block" src="p.png" caption="a" ratio="1" rawTitle="画册"></div>'
            : "",
      },
    });
    await vi.waitFor(() => expect(te.getMarkdown().trim()).toBe('![a](p.png "画册")'));
  });

  it('组合形态 ![0.75](p.png "图注") 数字 alt 迁移后图注让位 zoom（现状固化）', async () => {
    // 旧版文档数字 alt 与真实 title 并存时，title 位双语义无法同时落盘（信息论固有限制）：
    // 缩放比例优先占用 title 位，rawTitle 无处安放即随首次保存静默丢失。本用例固化该
    // 现状取舍（PR 披露项）：数字 alt 无业务含义故迁移 ratio，真实图注文本让位于缩放保真；
    // 若需保住此类图注，须在 title 位之外另立存储通道，超出本模块契约范围
    const te = await makeTestEditor('![0.75](p.png "图注")');
    expect(te.getMarkdown()).toBe('![](p.png "zoom:0.75")');
  });

  it("parseDOM 读回守卫：入参非 HTMLElement 时按约定抛类型错误", async () => {
    // jsdom 真实粘贴链路恒传入 HTMLElement，守卫分支不可达；以裸对象直调 getAttrs
    // 钉住该防御分支——非 DOM 节点必须显式抛错而非静默产出 undefined attrs
    const te = await makeTestEditor("");
    expect(() => getImageBlockSpec(te).getAttrs({})).toThrow();
  });

  it("parseDOM 读回缺属性回落：src/caption/rawTitle 回落空串、ratio 回落 1", async () => {
    // 编辑器内流转的剪贴板/拖拽 DOM 可能被裁剪掉部分属性：四项读回必须逐项回落
    // 默认值而非 undefined 入档（ratio 缺失回落 1 保证图片默认可见高度）
    const te = await makeTestEditor("");
    const attrs = getImageBlockSpec(te).getAttrs(document.createElement("img"));
    expect(attrs).toEqual({ src: "", caption: "", ratio: 1, rawTitle: "" });
  });

  it("parseMarkdown 收窄脏 mdast 字段：url/alt/title 非 string 一律空串防脏数据入档", async () => {
    // mdast 字段经索引签名访问均为 unknown（生产注释明示的防脏收窄）：合法 markdown
    // 解析产物三字段恒为 string，脏值分支须经受控对象直调 runner 钉住——
    // 三字段全非法时应走「常规形态」兜底支路且不产生 undefined attr
    const te = await makeTestEditor("");
    const nodeType = getImageBlockSpec(te).nodeType;
    const added: unknown[] = [];
    // 桩 ParserState.addNode 捕获 addNode(type, attrs) 落参
    const fakeState = { addNode: (_type: unknown, attrs: unknown) => void added.push(attrs) };
    nodeType.spec.parseMarkdown.runner(
      fakeState as never,
      { url: 42, alt: null, title: undefined } as never,
      nodeType,
    );
    expect(added).toEqual([{ src: "", caption: "", ratio: 1, rawTitle: "" }]);
  });

  it("toMarkdown 防御序列化：非法 ratio 回落 1、caption/rawTitle/src 非 string 收窄空串", async () => {
    // ratio attr 可能被外部置为非法值（生产注释明示「防御序列化出 zoom:NaN」）：
    // NaN 钉 isFinite 失败回落支路、负数钉 >0 失败回落支路——两路均不得产出 zoom title；
    // caption/rawTitle/src 的 typeof 收窄同理经脏 attr 直调钉住
    const te = await makeTestEditor("");
    const runner = getImageBlockSpec(te).nodeType.spec.toMarkdown.runner;
    const images: unknown[][] = [];
    let closed = false;
    // 桩 SerializerState 三步编排，捕获 image 行落参
    const fakeState = {
      openNode: () => {},
      addNode: (...args: unknown[]) => void images.push(args),
      closeNode: () => {
        closed = true;
      },
    };
    runner(
      fakeState as never,
      { attrs: { ratio: NaN, caption: 123, rawTitle: null, src: {} } } as never,
    );
    // 全脏场景：ratio 回落 1 后 title 位取 rawTitle 收窄结果空串，无 zoom 残留
    expect(images[0]).toEqual(["image", undefined, undefined, { title: "", url: "", alt: "" }]);
    runner(
      fakeState as never,
      { attrs: { ratio: -0.5, caption: "图注", rawTitle: "画册", src: "p.png" } } as never,
    );
    // 合法字段透传场景：负数 ratio 回落 1 → 真实 title 原样回写（不产出 zoom）
    expect(images[1]).toEqual([
      "image",
      undefined,
      undefined,
      { title: "画册", url: "p.png", alt: "图注" },
    ]);
    expect(closed).toBe(true);
  });
});

/**
 * 组合 helper：装配定制 schema 的编辑器并编程插入指定 src 的 image-block（沿 PIN-5 结论）
 * @param src 新插图标的存盘地址（onUpload 返回值形态，如 saved/pic.png）
 * @returns 与 makeTestEditor 一致的 TestEditor 句柄（view/getMarkdown 可用）
 */
async function makeTestEditorWithInsertedImage(src: string): Promise<TestEditor> {
  const te = await makeTestEditor("");
  te.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const nodeType = view.state.schema.nodes["image-block"];
    if (!nodeType) throw new Error("image-block 节点类型不存在：定制 schema 未装配");
    // 编程插入（T1 PIN-5 实证 API）：缺省 caption/ratio 走 schema 默认值，
    // 序列化必须产出空 alt 形态（对齐 Typora 新插落盘）
    view.dispatch(view.state.tr.replaceSelectionWith(nodeType.create({ src })));
  });
  return te;
}

/**
 * 直调 helper：取定制 schema 装配后的节点类型与 parseDOM 属性读回函数。
 * @param te 已装配定制 schema 的测试编辑器句柄
 * @returns nodeType：ProseMirror 节点类型（parseMarkdown/toMarkdown runner 挂其 spec）；
 *          getAttrs：parseDOM 首规则的属性读回函数（接受任意对象，非 DOM 入参由生产守卫抛错）
 */
function getImageBlockSpec(te: TestEditor) {
  const nodeType = te.view.state.schema.nodes["image-block"];
  // 与 makeTestEditorWithInsertedImage 同款装配断言：schema 未注入即快速失败
  if (!nodeType) throw new Error("image-block 节点类型不存在：定制 schema 未装配");
  // NodeSpec.parseDOM 在 prosemirror-model 类型中为可选字段，索引前须收窄；
  // 缺失时走下方结构漂移守卫快速失败
  const rawGetAttrs = nodeType.spec.parseDOM?.[0]?.getAttrs;
  if (!rawGetAttrs || !(rawGetAttrs instanceof Function)) {
    throw new Error("parseDOM 首规则缺 getAttrs：定制 schema 结构漂移");
  }
  return {
    nodeType,
    // 生产签名收窄为 HTMLElement；直调场景放宽入参，交由生产守卫抛错
    getAttrs: (dom: object): Record<string, unknown> =>
      (rawGetAttrs as (d: HTMLElement) => Record<string, unknown>)(dom as HTMLElement),
  };
}
