// 编辑器实例管理服务：单例生命周期 + 文档存取 + 只读切换（跨模块接口，100% 覆盖）
import { afterEach, describe, expect, it } from "vitest";
import { editorManager } from "./editor-manager";

describe("编辑器实例管理", () => {
  // 单例跨用例存活，收尾统一销毁并还原转换器，避免用例间状态泄漏
  afterEach(() => {
    editorManager.setDocumentTransformers({});
    editorManager.destroy();
  });

  it("create 后 getMarkdown 返回文档内容", async () => {
    await editorManager.create("# 标题");
    expect(editorManager.getMarkdown()).toBe("# 标题");
  });

  it("create 前 getMarkdown 返回空串（未创建不崩溃）", () => {
    expect(editorManager.getMarkdown()).toBe("");
  });

  it("destroy 后实例为空且可再次 create", async () => {
    await editorManager.create("内容");
    editorManager.destroy();
    expect(editorManager.getEditor()).toBeUndefined();
    await editorManager.create("新内容");
    expect(editorManager.getMarkdown()).toBe("新内容");
  });

  it("setReadonly 切换编辑器只读状态", async () => {
    await editorManager.create("只读测试");
    editorManager.setReadonly(true);
    expect(editorManager.getCrepe()?.readonly).toBe(true);
    editorManager.setReadonly(false);
    expect(editorManager.getCrepe()?.readonly).toBe(false);
  });

  it("setReadonly 未创建时静默忽略（不崩溃）", () => {
    expect(() => editorManager.setReadonly(true)).not.toThrow();
  });

  it("setDocumentTransformers 注册的序列化器参与 getMarkdown 输出", async () => {
    await editorManager.create("# 正文");
    editorManager.setDocumentTransformers({
      serialize: (body) => `---\ntitle: x\n---\n${body}`,
    });
    expect(editorManager.getMarkdown()).toBe("---\ntitle: x\n---\n# 正文");
    // 清理：还原转换器避免影响其他用例
    editorManager.setDocumentTransformers({});
  });

  it("setDocumentTransformers 注册的解析器参与 create 入文", async () => {
    editorManager.setDocumentTransformers({
      parse: (doc) => doc.replace(/^---\ntitle: x\n---\n/, ""),
    });
    await editorManager.create("---\ntitle: x\n---\n# 正文");
    expect(editorManager.getMarkdown()).toBe("# 正文");
    editorManager.setDocumentTransformers({});
  });

  it("getView 未创建返回 undefined，创建后返回编辑器视图", async () => {
    expect(editorManager.getView()).toBeUndefined();
    await editorManager.create("视图");
    expect(editorManager.getView()).toBeDefined();
  });
});
