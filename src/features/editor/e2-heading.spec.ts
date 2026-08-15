// E2 标题：`# ` 输入规则 / 非严格模式宽容 / Ctrl+1~6、Ctrl+0、Ctrl+=、Ctrl+- 级别控制
// 注：makeTestEditor 以 markdown 解析建树——`### 三级` 解析后文档仅含文本「三级」，
// 标题内容坐标为 1~2（标题节点 [0,4)），brief 原用例 (4,4) 为文档末端深度 0 位置，
// findParentNode 无法命中标题，故光标统一修正为 (2,2)（标题文本行尾，语义仍为「光标在标题内」）。
import { describe, expect, it } from "vitest";
import { makeTestEditor } from "../../test/editor-test-utils";

describe("E2 标题", () => {
  it("AC-E2-1 行首输入 `# ` + 文字按 Enter 渲染为 H1", async () => {
    const te = await makeTestEditor();
    te.insertText("# 标题一");
    te.press("Enter");
    expect(te.view.dom.querySelector("h1")?.textContent).toBe("标题一");
  });

  it("AC-E2-2 `###Header`（无空格）按 Enter 渲染为 H3（非严格模式宽容）", async () => {
    const te = await makeTestEditor();
    te.insertText("###Header");
    te.press("Enter");
    expect(te.view.dom.querySelector("h3")?.textContent).toBe(
      "###Header".replace(/^#+/, "") || "###Header",
    );
  });

  it("FIX-4 代码跨度内 `###Header` 不被宽松 ATX 规则吞：Enter 回落内置拆段", async () => {
    const te = await makeTestEditor();
    // 反引号键入时内置规则把内容转为 inlineCode mark（反引号被消费），
    // 无 code mark 守卫时 Enter 的拟输入链会把整段转为标题（`###` 被拉出当标题前缀）
    te.insertText("`###Header`");
    te.press("Enter");
    // 判别点：不产生标题（代码跨度文本保持原样、Enter 回落内置拆段）
    expect(te.view.dom.querySelector("h1,h2,h3,h4,h5,h6")).toBeNull();
    expect(te.view.state.doc.childCount).toBe(2);
    expect(te.view.state.doc.child(0).type.name).toBe("paragraph");
    expect(te.view.state.doc.child(0).textContent).toBe("###Header");
  });

  it("AC-E2-3 选中文本按 Ctrl+2 成为 H2 标题", async () => {
    const te = await makeTestEditor("成为标题");
    te.setSelection(0, 4);
    te.press("2", { ctrl: true });
    expect(te.view.dom.querySelector("h2")?.textContent).toBe("成为标题");
  });

  it("AC-E2-4 H3 光标在行内 Ctrl+= 升级为 H2，Ctrl+- 降回 H3", async () => {
    const te = await makeTestEditor("### 三级");
    // 光标置于标题文本内（标题内容「三级」坐标为 1~2）
    te.setSelection(2, 2);
    te.press("=", { ctrl: true });
    expect(te.view.dom.querySelector("h2")?.textContent).toBe("三级");
    te.press("-", { ctrl: true });
    expect(te.view.dom.querySelector("h3")?.textContent).toBe("三级");
  });

  it("AC-E2-5 H1 按 Ctrl+= 保持 H1 不变（无越界级别）", async () => {
    const te = await makeTestEditor("# 一级");
    te.setSelection(2, 2);
    te.press("=", { ctrl: true });
    expect(te.view.dom.querySelector("h1")?.textContent).toBe("一级");
    expect(te.view.dom.querySelector("h0")).toBeNull();
  });

  it("AC-E2-6 任意标题按 Ctrl+0 转为普通段落", async () => {
    const te = await makeTestEditor("### 三级");
    te.setSelection(2, 2);
    te.press("0", { ctrl: true });
    expect(te.view.dom.querySelector("h3")).toBeNull();
    expect(te.view.dom.querySelector("p")?.textContent).toBe("三级");
  });

  // ── 以下为 keymaps.ts 标题键位分支全覆盖补充用例（brief Step 4 要求断言 level 循环、
  // 钳制与回落分支）──

  it("补充覆盖 Ctrl+1~6 逐级切换全部生效（覆盖 Mod-1~6 全部键位注册路径）", async () => {
    const te = await makeTestEditor("标题文本");
    te.setSelection(0, 4);
    // 6 → 1 逐级切换，每级断言对应标题标签存在
    for (let level = 6; level >= 1; level--) {
      te.press(String(level), { ctrl: true });
      expect(te.view.dom.querySelector(`h${level}`)?.textContent).toBe("标题文本");
    }
  });

  it("补充覆盖 H6 按 Ctrl+- 保持 H6 不变（降级方向钳制不越界）", async () => {
    const te = await makeTestEditor("###### 六级");
    te.setSelection(2, 2);
    te.press("-", { ctrl: true });
    expect(te.view.dom.querySelector("h6")?.textContent).toBe("六级");
    expect(te.view.dom.querySelector("h7")).toBeNull();
  });

  it("补充覆盖 非标题上下文 Ctrl+= 返回 false 不消费按键（文档保持段落）", async () => {
    const te = await makeTestEditor("普通段落");
    te.setSelection(2, 2);
    te.press("=", { ctrl: true });
    te.press("-", { ctrl: true });
    // 非标题回落：不产生任何标题，段落原样保留
    expect(te.view.dom.querySelectorAll("h1,h2,h3,h4,h5,h6")).toHaveLength(0);
    expect(te.view.dom.querySelector("p")?.textContent).toBe("普通段落");
  });
});
