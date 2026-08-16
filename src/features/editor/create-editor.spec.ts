// Crepe 工厂自验证：覆盖 onUpload 注入分支（07 图片模块的配置入口）+ GFM 下划线序列化处理器分支
import { Crepe } from "@milkdown/crepe";
import { codeBlockConfig } from "@milkdown/kit/component/code-block";
import { editorViewCtx } from "@milkdown/kit/core";
import { describe, expect, it, vi } from "vitest";
import { makeTestEditor } from "../../test/editor-test-utils";
import { createMarkwellEditor, markwellRemarkHandlers } from "./create-editor";
import { closeMermaidMenu } from "./mermaid/mermaid-menu";

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

describe("createMarkwellEditor 工厂（E21 mermaid 接线）", () => {
  it("CodeMirror renderPreview 注入 mermaid 钩子：非图表语言回落缺省 prev，图表右键弹出菜单", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const crepe = createMarkwellEditor(root, "", {
      // 调用方提供 CodeMirror 特性配置但不提供 renderPreview → 回落代码块默认空实现
      crepeConfig: { featureConfigs: { [Crepe.Feature.CodeMirror]: {} } },
    });
    // 创建编辑器：触发特性 config 回调与 $prose 插件工厂（renderPreview 链在此组装）
    await crepe.create();
    // 读取生效的 codeBlockConfig：renderPreview 链 = latex → mermaid → 缺省空实现
    const config = crepe.editor.action((ctx) => ctx.get(codeBlockConfig.key));
    // 非图表语言经 mermaid 钩子回落到缺省 prev（返回 null，不渲染预览）
    expect(config.renderPreview("js", "const a = 1", vi.fn())).toBeNull();
    // contextmenu 插件：编辑器 DOM 内图表容器右键弹出自定义菜单（handleDOMEvents 接线）
    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx));
    const chart = document.createElement("div");
    chart.className = "markwell-mermaid-svg";
    chart.innerHTML = "<svg></svg>";
    view.dom.appendChild(chart);
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 5,
      clientY: 6,
    });
    chart.dispatchEvent(event);
    expect(document.querySelector(".markwell-mermaid-menu")?.textContent).toContain("另存为 SVG");
    closeMermaidMenu();
    // 移除测试注入的裸节点并等一帧：让 ProseMirror 的 DOM 变更观察器先完成 flush
    //（jsdom 下外部 DOM 变更的 flush 若与销毁时序竞争，会在 ctx 拆除后查询占位符
    // 配置而抛 contextNotFound；等待一帧后 flush 在 ctx 存活期完成，销毁干净）
    chart.remove();
    await new Promise((r) => setTimeout(r, 0));
    await crepe.destroy();
  });

  it("调用方提供的 CodeMirror renderPreview 被 mermaid 钩子链式包裹（非图表语言透传）", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const customPrev = vi.fn(() => "<div>custom</div>");
    const crepe = createMarkwellEditor(root, "", {
      crepeConfig: {
        featureConfigs: { [Crepe.Feature.CodeMirror]: { renderPreview: customPrev } },
      },
    });
    await crepe.create();
    const config = crepe.editor.action((ctx) => ctx.get(codeBlockConfig.key));
    // 非图表语言：mermaid 钩子透传给调用方自定义 prev，证明链式包裹生效
    expect(config.renderPreview("js", "const a = 1", vi.fn())).toBe("<div>custom</div>");
    expect(customPrev).toHaveBeenCalledWith("js", "const a = 1", expect.any(Function));
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

  it("字面 U+E000 与哨兵碰撞防护：私有区字面字符不被改写为下划线", () => {
    // 字面 U+E000 若与下划线哨兵同值混入，还原阶段会被统一替换为 `_`（静默数据损坏）；
    // 处理器须先映射为第二占位、还原时逆序恢复为原字符
    expect(runTextHandler("a\uE000b", " ", " ").out).toBe("a\uE000b");
    // 与单词内下划线混合：哨兵还原为 `_` 的同时字面 U+E000 原样保留
    expect(runTextHandler("wow_great\uE000stuff", " ", " ").out).toBe("wow_great\uE000stuff");
    // 行内多处字面 U+E000 均按原字符还原（不产生多余下划线）
    expect(runTextHandler("\uE000x\uE000", " ", " ").out).toBe("\uE000x\uE000");
  });

  it("P1-4 字面 U+E001 不被还原链误替换为 U+E000（字面 PUA 字符静默变异防护）", () => {
    // 修复前：字面 U+E001 与「字面 U+E000 占位」同值，还原阶段被无条件替换为
    // U+E000 且每次保存交替、永不复原（静默数据损坏）
    expect(runTextHandler("a\uE001b", " ", " ").out).toBe("a\uE001b");
    // 与字面 U+E000、单词内下划线混合：三者各自原样保留、互不误伤
    expect(runTextHandler("wow_great\uE000x\uE001y", " ", " ").out).toBe("wow_great\uE000x\uE001y");
    // 行内多处字面 U+E001 均按原字符还原
    expect(runTextHandler("\uE001a\uE001", " ", " ").out).toBe("\uE001a\uE001");
  });

  it("P1-4 字面 U+E001 落盘往返一致（getMarkdown 后原字符保留）", async () => {
    const te = await makeTestEditor();
    // 字面 U+E001 与「字面 U+E000 占位」同值，若被还原链误伤会静默变为 U+E000
    te.view.dispatch(
      te.view.state.tr.insertText("wow_great\uE000x\uE001y", te.view.state.selection.from),
    );
    const md = te.getMarkdown();
    expect(md).toBe("wow_great\uE000x\uE001y");
    // 重新解析再落盘为定点（U+E001 不再被改写）
    const reparsed = await makeTestEditor(md);
    expect(reparsed.getMarkdown()).toBe(md);
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

  it("字面 U+E000 落盘往返一致（getMarkdown 后原字符保留、无多余下划线）", async () => {
    const te = await makeTestEditor();
    // 构造含字面 U+E000 与单词内下划线的文本：U+E000 与下划线哨兵同值，
    // 若被哨兵还原链误伤会被静默替换为 `_`（一次性不可逆数据损坏）
    te.view.dispatch(
      te.view.state.tr.insertText("wow_great\uE000stuff", te.view.state.selection.from),
    );
    const md = te.getMarkdown();
    // 字面 U+E000 原样保留、单词内下划线不转义，均无多余字符
    expect(md).toBe("wow_great\uE000stuff");
    // 重新解析再落盘为定点（无字符引用/多余下划线累积）
    const reparsed = await makeTestEditor(md);
    expect(reparsed.getMarkdown()).toBe(md);
  });

  /**
   * 直跑 text 处理器：以「尾随空格编码仿真」的 safe() 冒充序列化状态，
   * 复刻 mdast-util-to-markdown 的 unsafe 规则 {character: ' ', after: '[\r\n]'}：
   * 输入以字面空格结尾时把最后一个空格编码为 &#x20;，其余输入原样返回
   * （上下文判断省略——换行上下文由各用例入参保证，避免测试替身引入未覆盖分支）。
   * 供硬换行保护分支（AC-E1-3 / FIX-5）的单测观察还原行为。
   * @param value 文本节点内容
   * @param before 序列化上下文前导字符（缺省即行首）
   * @param after 序列化上下文后继字符（缺省即行尾）
   * @param siblingTypes 文本节点之后紧邻的兄弟节点类型（如 ["break"] 表示硬换行上下文；
   * 缺省即段尾——无后续节点）
   */
  const runTextHandlerWithEncodedTrailingSpace = (
    value: string,
    before?: string,
    after?: string,
    siblingTypes: string[] = [],
  ) => {
    // 文本节点与父节点必须共享同一引用：handler 以 parent.children.indexOf(node)
    // 判定后继兄弟（FIX-5 还原上下文），新对象字面量会使 indexOf 恒为 -1
    const node = { type: "text", value };
    const parent =
      siblingTypes.length > 0
        ? { type: "paragraph", children: [node, ...siblingTypes.map((type) => ({ type }))] }
        : undefined;
    let captured = "";
    const fakeState = {
      safe: (input: string) => {
        captured = input;
        // 仅尾随字面空格被编码（制表符不命中该规则，与真实 safe() 一致）
        return / $/.test(input) ? input.slice(0, -1) + "&#x20;" : input;
      },
    };
    const handler = markwellRemarkHandlers.text!;
    // parent 为测试替身（结构不满足 mdast Parents 联合类型的字面量 type 约束），
    // 与 fakeState 同策略经 never 断言收窄（handler 仅读取 children/indexOf）
    const out = handler(node, parent as never, fakeState as never, { before, after } as never);
    return { out, captured };
  };

  it("硬换行保护：文本后随硬换行节点（mdast break 兄弟）时还原被编码的空白", () => {
    // FIX-5 限定还原上下文：仅文本后紧邻 break 节点（其序列化 "\\\n" 构成硬换行语法载体）
    // 才还原 safe() 编码的尾随空白（AC-E1-3 语法载体）
    const { out } = runTextHandlerWithEncodedTrailingSpace("foo  ", " ", "\n", ["break"]);
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

  it("FIX-5 段尾多空格（无后续 break 节点）不还原尾随空白（保留 &#x20; 编码）", () => {
    const { out } = runTextHandlerWithEncodedTrailingSpace("foo  ", " ", "\n");
    // 段尾两空格不是硬换行语法载体：旧还原条件会把它变回字面空格落盘，
    // 重解析时被 CommonMark 行尾剥离规则吃掉（静默数据丢失）；
    // 保留「字面空格 + &#x20; 编码」组合才能往返保住两个空白字符
    expect(out).toBe("foo &#x20;");
  });

  it("FIX-5 段尾多空格落盘往返不丢字符（字面空格 + &#x20; 编码组合保住两空格）", async () => {
    const te = await makeTestEditor();
    // 事务直插绕过输入规则，构造段尾两空格的字面文本节点（未按 Enter）
    te.view.dispatch(te.view.state.tr.insertText("abc  ", te.view.state.selection.from));
    const md = te.getMarkdown();
    // 段尾多空格非硬换行载体：safe() 编码最后一个空格为 &#x20;、前一个保持字面
    //（修复前还原为字面空格落盘，重解析被 CommonMark 行尾剥离规则吃掉）
    expect(md).toBe("abc &#x20;");
    // 往返：字面空格 + 字符引用组合在重解析时两空格完整保留，再次落盘为定点
    const reparsed = await makeTestEditor(md);
    expect(reparsed.view.state.doc.textContent).toBe("abc  ");
    expect(reparsed.getMarkdown()).toBe("abc &#x20;");
  });
});

describe("lowerLanguageCodeBlockSchema（E6-4 落盘小写归一化 + latex 扩展委托链接）", () => {
  it("$$ 数学块落盘保持 $$...$$ 形态（委托 prev 链中的 latex 扩展，不得产出 ```latex）", async () => {
    const te = await makeTestEditor("$$\nE=mc^2\n$$");
    const md = te.getMarkdown();
    // latex feature 的落盘格式是 $$ 围栏；若被小写归一化扩展覆盖，会以 ```latex
    // 落盘，重载后解析回普通代码块，数学块格式被静默摧毁
    expect(md).not.toContain("```latex");
    expect(md).toBe("$$\nE=mc^2\n$$");
  });

  it("空数学块（无文本子节点）落盘保持 $$ 围栏（math 输出空值分支）", async () => {
    const te = await makeTestEditor("$$\n$$");
    // 空 math 值不产生文本子节点，序列化走 firstChild 缺省分支，仍须 $$ 形态
    expect(te.getMarkdown()).toBe("$$\n$$");
  });

  it("大写语言名 ```JS 落盘归一化为 ```js（小写归一化仍生效）", async () => {
    const te = await makeTestEditor("```JS\nconst a = 1;\n```");
    expect(te.getMarkdown()).toBe("```js\nconst a = 1;\n```");
  });
});
