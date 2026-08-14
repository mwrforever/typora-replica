// Crepe 工厂自验证：覆盖 onUpload 注入分支（07 图片模块的配置入口）+ GFM 下划线序列化处理器分支
import { describe, expect, it } from "vitest";
import { createMarkwellEditor, markwellRemarkHandlers } from "./create-editor";

describe("createMarkwellEditor 工厂", () => {
  it("onUpload 回调注入 ImageBlock 特性配置（构造不抛错）", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const onUpload = async (file: File) => `mock:${file.name}`;
    const crepe = createMarkwellEditor(root, "# 工厂", { onUpload });
    expect(crepe).toBeDefined();
    // 未 create 的实例直接 destroy 收尾，不遗留异步状态
    await crepe.destroy();
  });
});

describe("markwellRemarkHandlers.text（GFM 单词内下划线不转义）", () => {
  /** 单词内下划线哨兵占位符（与 create-editor.ts 内部一致，私有区字符） */
  const SENTINEL = "\uE000";

  /**
   * 直跑 text 处理器：以原样返回的 safe() 冒充序列化状态，
   * 通过捕获「交给 safe 的待转义文本」观察哪些 `_` 被哨兵保护
   * @param value 文本节点内容
   * @param before 序列化上下文前导字符（缺省即行首）
   * @param after 序列化上下文后继字符（缺省即行尾）
   */
  const runTextHandler = (value: string, before?: string, after?: string) => {
    let captured = "";
    let out = "";
    const fakeState = {
      safe: (input: string) => {
        captured = input;
        return input;
      },
    };
    const handler = markwellRemarkHandlers.text!;
    out = handler(
      { type: "text", value },
      undefined,
      fakeState as never,
      {
        before,
        after,
      } as never,
    );
    return { out, captured };
  };

  it("单词内下划线以哨兵暂代（不进入默认转义链）", () => {
    const { out, captured } = runTextHandler("wow_great_stuff", " ", " ");
    // 两个单词内下划线均被哨兵保护，未留下字面 `_` 交 safe 转义
    expect(captured).not.toContain("_");
    expect(captured.split(SENTINEL)).toHaveLength(3);
    // 哨兵还原后输出与原文一致
    expect(out).toBe("wow_great_stuff");
  });

  it("行首 `_` 前为空白或标点时保留默认转义（可开启强调）", () => {
    // 前为空白：左 flanking 成立，`_` 必须转义
    expect(runTextHandler("_x", " ", " ").captured).not.toContain(SENTINEL);
    // 前为标点：左 flanking 成立
    expect(runTextHandler("_x", "(", " ").captured).not.toContain(SENTINEL);
  });

  it("行首上下文缺省视为行首，`_` 保留默认转义", () => {
    expect(runTextHandler("_x", undefined, " ").captured).not.toContain(SENTINEL);
  });

  it("行尾 `_` 后为空白或标点时保留默认转义（可闭合强调）", () => {
    // 后为空白：右 flanking 成立
    expect(runTextHandler("x_", " ", " ").captured).not.toContain(SENTINEL);
    // 后为标点：右 flanking 成立
    expect(runTextHandler("x_", " ", ")").captured).not.toContain(SENTINEL);
  });

  it("行尾上下文缺省视为行尾，`_` 保留默认转义", () => {
    expect(runTextHandler("x_", " ", undefined).captured).not.toContain(SENTINEL);
  });

  it("`_` 后随空白且前为行首时不构成强调，以哨兵保护", () => {
    expect(runTextHandler("_", undefined, " ").captured).toContain(SENTINEL);
  });

  it("前为空白且后为行尾的 `_` 不构成强调，以哨兵保护", () => {
    expect(runTextHandler("_", " ", undefined).captured).toContain(SENTINEL);
  });

  it("纯尾随空格文本直接返回原文（保留尾部空格，不经 safe 转义链）", () => {
    const { out, captured } = runTextHandler("foo  ", " ", " ");
    expect(out).toBe("foo  ");
    expect(captured).toBe("");
  });
});
