// image-block schema 定制测试（07 Task 9）：alt 保真 roundtrip / zoom title 双向 /
// 空 alt 新插形态（AC-P11-3/4）
//
// 装配方式：makeTestEditor 在 editor-test-utils.ts 注入 markwellImageBlockSchema
// （与产品工厂 create-editor.ts 同源一行 use），全部用例经标准入口获得定制行为；
// 编程插入沿 T1 PIN-5 实证 API（tr.replaceSelectionWith）。
import { editorViewCtx } from "@milkdown/kit/core";
import { describe, expect, it } from "vitest";
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
