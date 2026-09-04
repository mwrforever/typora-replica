// 编辑器实例管理服务：单例生命周期 + 文档存取 + 只读切换（跨模块接口，100% 覆盖）
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Crepe } from "@milkdown/crepe";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import type { Selection } from "@milkdown/kit/prose/state";
import { makeTestEditor } from "../../test/editor-test-utils";
import { showMermaidMenu } from "./mermaid/mermaid-menu";
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

  it("P1-1 destroy 拒绝（插件清理抛错）不毒化后续 create", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await editorManager.create("内容");
    // 模拟 milkdown #cleanup 聚合中某插件 cleanup 抛错 → destroy() 返回拒绝的 promise
    const crepe = editorManager.getCrepe()!;
    vi.spyOn(crepe, "destroy").mockImplementationOnce(() =>
      Promise.reject(new Error("cleanup boom")),
    );
    editorManager.destroy();
    // 销毁拒绝被 catch 兜底：后续 create 在 await pendingDestroy 处不被拒绝阻断
    await expect(editorManager.create("新内容")).resolves.toBeUndefined();
    expect(editorManager.getMarkdown()).toBe("新内容");
    // 连续 create 交替（destroy 拒绝路径重复出现）仍不毒化
    const crepe2 = editorManager.getCrepe()!;
    vi.spyOn(crepe2, "destroy").mockImplementationOnce(() => Promise.reject(new Error("boom 2")));
    editorManager.destroy();
    await expect(editorManager.create("第三份")).resolves.toBeUndefined();
    expect(editorManager.getMarkdown()).toBe("第三份");
    errorSpy.mockRestore();
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

  it("destroy 关闭已打开的图片删除菜单（07 T11 移交，不残留 body 挂载）", async () => {
    await editorManager.create("# 标题");
    // 模拟菜单打开状态：图片删除菜单由 delete-image 弹于 body（showImageMenu 为模块
    // 私有，与 FIX-10 图表菜单同款手法直挂同类名验证销毁路径的 closeImageMenu 调用）
    const menu = document.createElement("div");
    menu.className = "markwell-image-menu";
    document.body.appendChild(menu);
    expect(document.querySelector(".markwell-image-menu")).not.toBeNull();
    editorManager.destroy();
    // 销毁路径同步关闭图片菜单，不残留至下一次任意点击
    expect(document.querySelector(".markwell-image-menu")).toBeNull();
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

  it("adopt 切换实例先解绑旧实例事件桥：旧实例变更不再投递（04 多标签）", async () => {
    const received: string[] = [];
    const unsubscribe = editorManager.subscribeMarkdownUpdated((md) => received.push(md));
    const a = await makeTestEditor("实例A");
    const b = await makeTestEditor("实例B");
    editorManager.adopt(a.crepe);
    // 门面切换：B 接管后旧实例 A 的事件桥必须解绑（否则 A 残留监听继续向订阅集合投递）
    editorManager.adopt(b.crepe);
    expect(editorManager.getCrepe()).toBe(b.crepe);
    // 旧实例 A 触发 markdownUpdated：底层 listener 无法移除，但解绑标记应阻断投递
    a.view.dispatch(a.view.state.tr.insertText("追加"));
    // 新实例 B 触发：事件桥正常投递（证明订阅集合完好、仅旧实例被解绑）
    b.view.dispatch(b.view.state.tr.insertText("追加"));
    await new Promise((r) => setTimeout(r, 600));
    expect(received.some((md) => md.includes("实例B"))).toBe(true);
    expect(received.some((md) => md.includes("实例A"))).toBe(false);
    unsubscribe();
    await editorManager.destroy();
  });

  it("getMarkdownFor 按实例取内容：非激活实例 FM 回写 + 激活实例正文（04 多标签）", async () => {
    const a = await makeTestEditor("# A 正文");
    const b = await makeTestEditor("# B 正文");
    editorManager.adopt(a.crepe, "title: A");
    // 门面切换至 B（无 FM）：getMarkdownFor 仍可取 A 完整内容（FM 原样回写）
    editorManager.adopt(b.crepe);
    expect(editorManager.getMarkdownFor(a.crepe, "title: A")).toBe("---\ntitle: A\n---\n# A 正文");
    expect(editorManager.getMarkdownFor(b.crepe, null)).toBe("# B 正文");
    // 门面 getMarkdown 与激活实例的 getMarkdownFor 同构
    expect(editorManager.getMarkdown()).toBe("# B 正文");
  });

  it("getMarkdownFor 的 serialize 转换器生效（与 getMarkdown 同构）", async () => {
    const a = await makeTestEditor("# A 正文");
    editorManager.adopt(a.crepe, "title: A");
    editorManager.setDocumentTransformers({
      serialize: (body) => `${body}\n尾部标注`,
    });
    expect(editorManager.getMarkdownFor(a.crepe, "title: A")).toBe(
      "---\ntitle: A\n---\n# A 正文\n尾部标注",
    );
    editorManager.setDocumentTransformers({});
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

  describe("subscribeDocUpdated / subscribeSelectionUpdated（05 大纲消费口）", () => {
    it("文档变更后经防抖收到 doc 对象，取消订阅后不再收到", async () => {
      await editorManager.create("# 标题\n\n正文");
      const received: ProseMirrorNode[] = [];
      const off = editorManager.subscribeDocUpdated((doc) => received.push(doc));
      const view = editorManager.getView()!;
      // “# 标题\n\n正文” doc 尺寸 8（heading 贡献 4 + 段落贡献 4）：pos 6 位于段落文本节点内部（“正”之后）
      view.dispatch(view.state.tr.insertText("更", 6));
      // 防抖总窗口 = listener 内置 200ms + 事件桥 200ms，等 600ms 保证触发（沿用本文件真实计时器惯例）
      await new Promise((r) => setTimeout(r, 600));
      expect(received.length).toBeGreaterThan(0);
      expect(received[received.length - 1].textContent).toContain("更");
      // 幂等：二次取消不抛错
      off();
      off();
      view.dispatch(view.state.tr.insertText("再", 7));
      await new Promise((r) => setTimeout(r, 600));
      expect(received.length).toBe(1); // 取消后不再投递
    });

    it("选区变更即时回调（无防抖），adopt 切换实例后事件来自新实例", async () => {
      await editorManager.create("# A");
      const selections: Selection[] = [];
      const off = editorManager.subscribeSelectionUpdated((s) => selections.push(s));
      const oldView = editorManager.getView()!;
      // “# A” doc 尺寸 3（heading 内容 1 + 开闭各 1）：pos 2 为标题内容末端，触发选区变更
      oldView.dispatch(oldView.state.tr.setSelection(TextSelection.create(oldView.state.doc, 2)));
      expect(selections.length).toBeGreaterThan(0); // 即时，不等计时器

      // 门面切换到外部创建的实例（makeTestEditor 返回 { crepe }）：旧实例编辑不再投递
      const external = await makeTestEditor("## 外部标题");
      editorManager.adopt(external.crepe);
      const countBefore = selections.length;
      // 旧实例仍存活但桥已解绑：在其标题末尾插入字符（pos 2 合法），不应投递
      oldView.dispatch(oldView.state.tr.insertText("x", 2));
      await new Promise((r) => setTimeout(r, 600));
      expect(selections.length).toBe(countBefore);

      const newView = editorManager.getView()!;
      // “## 外部标题” doc 尺寸 6（标题文本 4 字 + 开闭各 1）：pos 5 为标题内容末端，触发选区变更
      newView.dispatch(newView.state.tr.setSelection(TextSelection.create(newView.state.doc, 5)));
      expect(selections.length).toBeGreaterThan(countBefore);
      off();
    });

    it("adopt 后立即补发当前快照：doc/selection 订阅者各收到一次新实例状态（晚挂号广播）", async () => {
      // 业务背景：大纲面板可见时 Ctrl+N 新建标签，装配层 nextTick 拉取命中的仍是
      // 旧实例，订阅方无从得知门面已切换——adopt 必须同步补发当前快照，
      // 保证「订阅语义 = 激活标签当前状态流」在实例切换边界可靠成立
      const docs: ProseMirrorNode[] = [];
      const selections: Selection[] = [];
      const offDoc = editorManager.subscribeDocUpdated((doc) => docs.push(doc));
      const offSel = editorManager.subscribeSelectionUpdated((s) => selections.push(s));
      // 外部创建的实例直接 adopt（EditorPage 装配路径）：全程不派发任何事务，
      // 排除事件桥常规投递干扰——回调只能来自 adopt 的快照补发本身
      const external = await makeTestEditor("## 快照标题");
      editorManager.adopt(external.crepe);
      expect(docs).toHaveLength(1);
      expect(docs[0].textContent).toContain("快照标题");
      expect(selections).toHaveLength(1);
      // 快照即新实例当前选区对象（emit 直传引用，无拷贝）
      expect(selections[0]).toBe(external.view.state.selection);
      offDoc();
      offSel();
    });

    it("未就绪实例 adopt 不抛错且不广播（getView 抛错容错跳过）", async () => {
      // 业务背景：EditorPage 经 @milkdown/vue 工厂回调 adopt 时 create 可能尚未完成，
      // 此刻 Editor.action 访问 ctx 直接抛——快照广播必须容错跳过、不阻断 adopt 主链路
      // （EditorPage.spec 组件域 4 用例为端到端回归证据，此处用最小骨架钉住门面语义）
      const unready = {
        // 未 action-ready：create 未完成时 action 抛错（milkdown Editor.action 守卫行为）
        editor: {
          action: (): never => {
            throw new Error("editor not ready");
          },
        },
        // 事件桥登记入口桩：仅要求可挂载（真实链路由集成层 create 后触发）；
        // 零参函数可安全承接 on(listener) 的回调实参
        on: (): void => {},
        // destroy 桩：收尾 editorManager.destroy() 需要可调用的异步销毁
        destroy: (): Promise<void> => Promise.resolve(),
      } as unknown as Crepe;
      const docs: ProseMirrorNode[] = [];
      const selections: Selection[] = [];
      const offDoc = editorManager.subscribeDocUpdated((doc) => docs.push(doc));
      const offSel = editorManager.subscribeSelectionUpdated((s) => selections.push(s));
      // adopt 主链路不受未就绪影响：引用照常登记，广播静默跳过
      expect(() => editorManager.adopt(unready)).not.toThrow();
      expect(editorManager.getCrepe()).toBe(unready);
      expect(docs).toHaveLength(0);
      expect(selections).toHaveLength(0);
      offDoc();
      offSel();
    });
  });
});
