// 04 P0 集成回归：两实例并存，销毁其一/切换门面后，另一实例事件桥与序列化不受影响
import { afterEach, describe, expect, it } from "vitest";
import { editorManager } from "./editor-manager";
import { destroyTestEditors, makeTestEditor } from "../../test/editor-test-utils";

describe("多实例隔离（04 P0 回归）", () => {
  // 收尾统一销毁：destroyTestEditors 内部已有 try/catch，用例内显式 destroy 后
  // 此处二次销毁安全；editorManager 单例跨用例存活，须显式 destroy 还原空态
  afterEach(async () => {
    await destroyTestEditors();
    editorManager.destroy();
  });

  it("销毁实例 A 后，B 的 markdownUpdated 订阅仍持续投递", async () => {
    const a = await makeTestEditor("# A 文档");
    const b = await makeTestEditor("# B 文档");
    editorManager.adopt(a.crepe, null);
    editorManager.adopt(b.crepe, null);
    const received: string[] = [];
    const unsubscribe = editorManager.subscribeMarkdownUpdated((md) => received.push(md));
    // 销毁 A（其事件桥应被定向清理，不影响 B）
    await a.crepe.destroy();
    b.insertText("x");
    // 等待 markdownUpdated 防抖全链路 500ms（listener 内置 200ms + 事件桥 300ms），
    // 留 100ms 余量避免 jsdom 环境计时抖动
    await new Promise((r) => setTimeout(r, 600));
    unsubscribe();
    expect(received.length).toBeGreaterThan(0);
    expect(received[received.length - 1]).toContain("B 文档");
  });

  it("门面切到 B 后，getMarkdownFor 仍能取到 A 的完整内容（含 FM 回写）", async () => {
    const mdA = "---\ntitle: 甲\n---\n# A 正文";
    const a = await makeTestEditor("# A 正文");
    const b = await makeTestEditor("# B 正文");
    // FM 参数为剥离定界符后的内文（adopt/getMarkdownFor 锁定契约，定界符由回写逻辑补全）
    editorManager.adopt(a.crepe, "title: 甲");
    editorManager.adopt(b.crepe, null);
    expect(editorManager.getMarkdownFor(a.crepe, "title: 甲")).toBe(mdA);
    expect(editorManager.getMarkdownFor(b.crepe, null)).toBe("# B 正文");
    expect(editorManager.getMarkdown()).toBe("# B 正文");
  });
});
