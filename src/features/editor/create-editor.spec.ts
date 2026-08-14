// Crepe 工厂自验证：覆盖 onUpload 注入分支（07 图片模块的配置入口）+ GFM 下划线序列化处理器分支
import { describe, expect, it } from "vitest";
import { makeTestEditor } from "../../test/editor-test-utils";
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

  it("尾随空格且含特殊字符的文本不绕开 safe 转义链", () => {
    // 反引号等特殊字符必须完整交付 safe 处理，否则落盘重新解析会改变结构
    const { captured } = runTextHandler("a `b` ", " ", " ");
    expect(captured).toBe("a `b` ");
  });

  it("尾随空格 + 反引号文本落盘往返一致（不产生代码跨度）", async () => {
    const te = await makeTestEditor();
    // 事务直插绕过输入规则，构造含反引号与尾随空格的字面文本节点
    te.view.dispatch(te.view.state.tr.insertText("a `b` ", te.view.state.selection.from));
    const md = te.getMarkdown();
    // 落盘需保持反引号转义：重新解析后不产生代码跨度，且再次落盘为定点（内容一致）
    const reparsed = await makeTestEditor(md);
    expect(reparsed.view.dom.querySelector("code")).toBeNull();
    expect(reparsed.getMarkdown()).toBe(md);
  });

  /**
   * 直跑 text 处理器：以「尾随空格编码仿真」的 safe() 冒充序列化状态，
   * 复刻 mdast-util-to-markdown 的 unsafe 规则 {character: ' ', after: '[\r\n]'}：
   * 输入以字面空格结尾时把最后一个空格编码为 &#x20;，其余输入原样返回
   * （上下文判断省略——换行上下文由各用例入参保证，避免测试替身引入未覆盖分支）。
   * 供硬换行保护分支（AC-E1-3）的单测观察还原行为。
   * @param value 文本节点内容
   * @param before 序列化上下文前导字符（缺省即行首）
   * @param after 序列化上下文后继字符（缺省即行尾）
   */
  const runTextHandlerWithEncodedTrailingSpace = (
    value: string,
    before?: string,
    after?: string,
  ) => {
    let captured = "";
    const fakeState = {
      safe: (input: string) => {
        captured = input;
        // 仅尾随字面空格被编码（制表符不命中该规则，与真实 safe() 一致）
        return / $/.test(input) ? input.slice(0, -1) + "&#x20;" : input;
      },
    };
    const handler = markwellRemarkHandlers.text!;
    const out = handler(
      { type: "text", value },
      undefined,
      fakeState as never,
      { before, after } as never,
    );
    return { out, captured };
  };

  it("硬换行保护：尾随空格后随换行上下文时还原被编码的空白（不产出 &#x20;）", () => {
    const { out } = runTextHandlerWithEncodedTrailingSpace("foo  ", " ", "\n");
    // safe() 会把最后一个空格编码为 &#x20;，处理器须还原为原始空格（AC-E1-3 语法载体）
    expect(out).toBe("foo  ");
    expect(out).not.toContain("&#x20;");
  });

  it("硬换行保护：无尾随空白时输出与 safe() 完全一致（不做还原）", () => {
    const { out, captured } = runTextHandlerWithEncodedTrailingSpace("a b", " ", "\n");
    expect(out).toBe("a b");
    expect(out).toBe(captured);
  });

  it("硬换行保护：尾随制表符后随换行上下文时保持原始制表符（不被改写）", () => {
    const { out } = runTextHandlerWithEncodedTrailingSpace("foo\t", " ", "\n");
    // 真实 safe() 的空白规则只命中字面空格，制表符不经编码；
    // 处理器亦不得对尾随制表符做任何改写（还原条件不成立，原样返回）
    expect(out).toBe("foo\t");
  });

  it("硬换行保护：单个尾随空格不还原（保留 &#x20; 编码，往返不丢字符）", () => {
    const { out } = runTextHandlerWithEncodedTrailingSpace("foo ", " ", "\n");
    // 行尾单空格不是硬换行语法，CommonMark 解析会将其剥离；
    // 必须保留字符引用编码才能往返保住该空格（对应落盘往返一致用例）
    expect(out).toBe("foo&#x20;");
  });
});
