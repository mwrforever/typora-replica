// 编辑器实例管理服务：单例生命周期 + 文档存取 + 只读切换（跨模块接口，100% 覆盖）
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTestEditor } from "../test/editor-test-utils";
import { showMermaidMenu } from "../features/editor/mermaid/mermaid-menu";
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

  it("destroy 后挂载根元素从文档移除", async () => {
    const childIndex = document.body.childNodes.length;
    await editorManager.create("根元素");
    // create 向 body 追加的第一个节点即挂载根元素（Crepe 内部结构均在其子树内）
    const root = document.body.childNodes[childIndex] as HTMLElement;
    expect(root).toBeInstanceOf(HTMLDivElement);
    editorManager.destroy();
    // 挂载根 div 必须由 destroy 自行移除，不得残留 document.body
    expect(root.isConnected).toBe(false);
    expect(document.body.contains(root)).toBe(false);
  });

  it("FIX-10 destroy 关闭已打开的图表右键菜单（不残留 body 挂载）", async () => {
    await editorManager.create("# 标题");
    // 模拟菜单打开状态：菜单 div 挂载于 body（真实链路为 contextmenu 处理器弹出）
    showMermaidMenu("<svg></svg>", 0, 0);
    expect(document.querySelector(".markwell-mermaid-menu")).not.toBeNull();
    editorManager.destroy();
    // 销毁路径主动关闭菜单，不残留至下一次任意点击（菜单关闭路径不含销毁钩子）
    expect(document.querySelector(".markwell-mermaid-menu")).toBeNull();
  });

  it("连续 create 两次无重叠（先完成旧实例销毁再创建新实例）", async () => {
    await editorManager.create("第一份");
    const afterFirst = document.body.querySelectorAll("div").length;
    await editorManager.create("第二份");
    // 第二次 create 应先完成旧实例销毁：div 数量与单实例时持平（无残留、无重叠挂载）
    expect(document.body.querySelectorAll("div").length).toBe(afterFirst);
    expect(editorManager.getMarkdown()).toBe("第二份");
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
      parse: (doc) => doc.replace("标题", "正文"),
    });
    await editorManager.create("# 标题");
    expect(editorManager.getMarkdown()).toBe("# 正文");
    editorManager.setDocumentTransformers({});
  });

  it("getView 未创建返回 undefined，创建后返回编辑器视图", async () => {
    expect(editorManager.getView()).toBeUndefined();
    await editorManager.create("视图");
    expect(editorManager.getView()).toBeDefined();
  });

  it("adopt 接管外部编辑器后 getCrepe/getMarkdown 可用", async () => {
    // Vue 集成层自行 create 的编辑器：文档已解析，adopt 仅登记引用
    const test = await makeTestEditor("# 采用");
    editorManager.adopt(test.crepe);
    expect(editorManager.getCrepe()).toBe(test.crepe);
    expect(editorManager.getEditor()).toBe(test.crepe.editor);
    expect(editorManager.getMarkdown()).toBe("# 采用");
  });

  it("adopt 后 destroy 清空实例引用（挂载根元素由 Vue 集成层持有）", async () => {
    const test = await makeTestEditor("内容");
    editorManager.adopt(test.crepe);
    editorManager.destroy();
    expect(editorManager.getCrepe()).toBeUndefined();
    expect(editorManager.getEditor()).toBeUndefined();
    expect(editorManager.getMarkdown()).toBe("");
  });

  it("内建 Front Matter 剥离：create 含 FM 文档后 getMarkdown 原样回写", async () => {
    const md = "---\ntitle: 测试\n---\n# 正文";
    await editorManager.create(md);
    expect(editorManager.getMarkdown()).toBe(md);
  });

  it("内建 Front Matter 不影响无 FM 文档", async () => {
    await editorManager.create("# 纯正文");
    expect(editorManager.getMarkdown()).toBe("# 纯正文");
  });

  it("destroy 清空内建 Front Matter：随后 create 无 FM 文档不残留回写", async () => {
    await editorManager.create("---\ntitle: x\n---\n# 甲");
    editorManager.destroy();
    await editorManager.create("# 乙");
    expect(editorManager.getMarkdown()).toBe("# 乙");
  });

  it("adopt 携带 FM 内文后 getMarkdown 回写（EditorPage 装配路径）", async () => {
    const test = await makeTestEditor("# 采用正文");
    editorManager.adopt(test.crepe, "title: 元数据");
    expect(editorManager.getMarkdown()).toBe("---\ntitle: 元数据\n---\n# 采用正文");
  });

  it("内建 FM 剥离优先于外部 parse：转换器只作用于剥离后的正文", async () => {
    editorManager.setDocumentTransformers({
      parse: (doc) => doc.replace("正文", "转换后"),
    });
    await editorManager.create("---\ntitle: x\n---\n# 正文");
    expect(editorManager.getMarkdown()).toBe("---\ntitle: x\n---\n# 转换后");
    editorManager.setDocumentTransformers({});
  });

  it("外部 serialize 与内建 FM 并存：转换器作用于正文后 FM 原样回写", async () => {
    await editorManager.create("---\ntitle: 测试\n---\n# 正文");
    editorManager.setDocumentTransformers({
      serialize: (body) => `${body}\n尾部标注`,
    });
    expect(editorManager.getMarkdown()).toBe("---\ntitle: 测试\n---\n# 正文\n尾部标注");
    editorManager.setDocumentTransformers({});
  });

  it("subscribeMarkdownUpdated：创建后事件桥分发，重建后订阅仍生效", async () => {
    const received: string[] = [];
    const unsubscribe = editorManager.subscribeMarkdownUpdated((md) => received.push(md));
    await editorManager.create("初始");
    // 触发 markdownUpdated（防抖 300ms + listener 内置 200ms = 500ms 全链路）
    const view = editorManager.getView()!;
    view.dispatch(view.state.tr.insertText("追加"));
    await new Promise((r) => setTimeout(r, 600));
    expect(received.length).toBeGreaterThan(0);
    // 取消订阅后不再收到
    unsubscribe();
    view.dispatch(view.state.tr.insertText("再追加"));
    const countAfterUnsub = received.length;
    await new Promise((r) => setTimeout(r, 600));
    expect(received.length).toBe(countAfterUnsub);
    await editorManager.destroy();
  });

  it("create 并发让位：后发 create 生效，先发实例不挂载（in-flight 守卫）", async () => {
    // 两次 create 不等待：第二个的 seq 使第一个让位（防事件桥错挂废弃实例）
    const p1 = editorManager.create("第一份");
    const p2 = editorManager.create("第二份");
    await Promise.all([p1, p2]);
    expect(editorManager.getMarkdown()).toBe("第二份");
    await editorManager.destroy();
  });

  it("create 并发让位：等待销毁期间被更新的 create 取代则让位（销毁等待守卫）", async () => {
    // 预置已创建实例：首次 create 的 destroy() 产生真实异步销毁（pendingDestroy 非空），
    // 第二次 create 在其等待期间递增 seq——守卫 1 使先发 create 让位不创建
    await editorManager.create("旧实例");
    const p1 = editorManager.create("第一份");
    const p2 = editorManager.create("第二份");
    await Promise.all([p1, p2]);
    expect(editorManager.getMarkdown()).toBe("第二份");
    await editorManager.destroy();
  });

  it("create 并发让位：创建期间被更新的 create 取代则让位（事件桥守卫）", async () => {
    // 先完成一次 create 清空 pendingDestroy 与残留销毁流程，使先发 create 直达创建阶段
    await editorManager.create("占位");
    const p1 = editorManager.create("第一份");
    // MutationObserver 观察 body 子节点：p1 越过守卫 1 建出挂载根时即刻（微任务）唤醒——
    // 不依赖定时器粒度，保证 p2 在 p1 仍 await crepe.create() 时递增 seq（守卫 2 让位）
    const rootAppeared = new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        observer.disconnect();
        resolve();
      });
      observer.observe(document.body, { childList: true });
    });
    await rootAppeared;
    // 此刻 p1 正 await crepe.create()：p2 递增 seq 并销毁其 crepe——守卫 2 使 p1 让位不再挂事件桥
    const p2 = editorManager.create("第二份");
    await Promise.all([p1, p2]);
    expect(editorManager.getMarkdown()).toBe("第二份");
    await editorManager.destroy();
  });

  it("adopt 后 markdownUpdated 事件桥分发到订阅者（adopt 路径）", async () => {
    const received: string[] = [];
    const unsubscribe = editorManager.subscribeMarkdownUpdated((md) => received.push(md));
    const test = await makeTestEditor("采用");
    editorManager.adopt(test.crepe);
    test.view.dispatch(test.view.state.tr.insertText("追加"));
    await new Promise((r) => setTimeout(r, 600));
    expect(received.length).toBeGreaterThan(0);
    unsubscribe();
    await editorManager.destroy();
  });

  it("insertMarkdown 向编辑器视图 dispatch 插入文本（F7 插入链路）", async () => {
    await editorManager.create("初始内容");
    // 复用既有 view 实例：dispatch 加 spy，断言载荷事务携带 insertText 方法
    const view = editorManager.getView();
    const dispatch = vi.spyOn(view!, "dispatch");
    editorManager.insertMarkdown("[readme.md](readme.md)");
    expect(dispatch).toHaveBeenCalledTimes(1);
    const tr = dispatch.mock.calls[0][0] as { insertText?: (t: string) => unknown };
    expect(typeof tr.insertText).toBe("function");
  });

  it("insertMarkdown 未创建实例时静默 no-op", () => {
    editorManager.destroy();
    expect(() => editorManager.insertMarkdown("x")).not.toThrow();
  });
});
