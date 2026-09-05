// OutlinePanel 组件用例（05 大纲 Task 6 + Task 8，AC-F17/F18/F19/F20/F22）
//
// 覆盖：层级缩进列表渲染与激活高亮（F17）/ 点击条目透传 revealRange 定位标题
// 文本区间（F18-1）/ 空态文案 / doc·selection 双通道装配语义（F19）/ 滚动通道
// 「scroll 发生时 setActive 按 pickActiveByTop 结果回写」的装配语义 / dispose 与
// mount 严格成对 / 设置镜像加载 / 过滤输入框输入即滤与双空态区分（F21）/
// 右键菜单弹出·click-away 关闭·HCH 滚入视野闪现高亮 / 折叠开关切换持久化 /
// caret 折叠钮交互（F22）/ 空态三分修正（全部折叠隐藏 ≠ 无匹配）。
//
// 边界说明（jsdom 无布局）：findScrollContainer 的 scrollHeight/overflow 判定与
// coordsAtPos 像素度量在 jsdom 中不可真实触发——滚动通道纯判定已由 current-heading.spec
// 覆盖（T5），本文件仅以「内联 overflow-y:auto 容器 + coordsAtPos 桩」钉住装配语义，
// 不做像素断言。editor-manager / reveal-range / settings 全量 mock，不触达真实编辑器。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";

// vi.mock 工厂被提升到 import 之前求值，共享桩状态收拢进 hoisted 容器
// （规避 TDZ，SidebarPanel.spec 同款约束）
const h = vi.hoisted(() => ({
  revealRange: vi.fn(),
  loadSettings: vi.fn(),
  /** updateSettings 桩（AC-F22-2 折叠开关持久化断言） */
  updateSettings: vi.fn(),
  /** 装配层注册的 docUpdated 订阅回调（用例内手动投递模拟事件桥） */
  docCbs: [] as Array<(doc: unknown) => void>,
  /** 装配层注册的 selectionUpdated 订阅回调 */
  selCbs: [] as Array<(sel: unknown) => void>,
  /** getView() 返回值（按用例注入视图桩；undefined = 门面空态） */
  view: undefined as unknown,
  /** getEditor() 返回值（默认非空对象；置 undefined = 编辑器未就绪守卫场景） */
  editor: {} as unknown,
}));

vi.mock("../editor/reveal-range", () => ({
  revealRange: (...a: unknown[]) => h.revealRange(...a),
}));

vi.mock("../editor/editor-manager", () => ({
  editorManager: {
    // revealRange 已 mock：编辑器桩仅需非空即可通过组件守卫（用例可注入 undefined 验守卫）
    getEditor: (): unknown => h.editor,
    getView: (): unknown => h.view,
    subscribeDocUpdated: (cb: (doc: unknown) => void) => {
      h.docCbs.push(cb);
      return () => {
        const i = h.docCbs.indexOf(cb);
        if (i >= 0) h.docCbs.splice(i, 1);
      };
    },
    subscribeSelectionUpdated: (cb: (sel: unknown) => void) => {
      h.selCbs.push(cb);
      return () => {
        const i = h.selCbs.indexOf(cb);
        if (i >= 0) h.selCbs.splice(i, 1);
      };
    },
  },
}));

vi.mock("../../services/settings", () => ({
  loadSettings: (...a: unknown[]) => h.loadSettings(...a),
  updateSettings: (...a: unknown[]) => h.updateSettings(...a),
}));

import OutlinePanel from "./OutlinePanel.vue";
import { useOutlineStore } from "./outline-store";
import type { HeadingInfo } from "../editor/heading-collect";

/** 三级标题夹具（pos 对齐真实 ProseMirror 布局算术：块节点占位 = 文本长 + 开闭标记 2） */
const FIXTURE: HeadingInfo[] = [
  { id: "a", level: 1, text: "A", pos: 0 },
  { id: "b", level: 2, text: "B", pos: 3 },
  { id: "c", level: 3, text: "C", pos: 7 },
];

/**
 * 最小文档桩：collectHeadings 仅消费 descendants 回调的 type/attrs/textContent，
 * 无需构造真实 ProseMirror 树（返回宽对象便于用例侧展开合并 resolve 桩）
 */
function fakeDoc(items: HeadingInfo[]): Record<string, unknown> {
  return {
    descendants: (cb: (node: unknown, pos: number) => void): void => {
      for (const item of items) {
        cb(
          {
            type: { name: "heading" },
            attrs: { id: item.id, level: item.level },
            textContent: item.text,
          },
          item.pos,
        );
      }
    },
  };
}

/**
 * 视图桩：state.doc（descendants 供门面重收集、resolve 供 activeIdByPos 祖先上溯——
 * depth=0 令其走前置回退路径）；state.selection.head 供装配层初始高亮判定
 * （默认 0 = 文档起始，FIXTURE 下命中首标题 a）；coordsAtPos 按 pos 映射视口 top
 * （滚动通道度量桩）；dom 作为 findScrollContainer 起点。
 * @param opts.docItems 文档标题集合；tops pos→视口 top 映射；dom 挂载宿主元素；
 *                      head 光标偏移（初始高亮判定消费，默认文档起始）
 */
function makeView(opts: {
  docItems: HeadingInfo[];
  tops?: Record<number, number>;
  dom?: HTMLElement;
  head?: number;
}): unknown {
  return {
    state: {
      doc: {
        ...fakeDoc(opts.docItems),
        // resolve 桩：深度恒 0 → activeIdByPos 跳过祖先上溯，走「pos 前最近标题」回退
        resolve: (): { depth: number } => ({ depth: 0 }),
      },
      // 选区桩：pullFromFacade 初始高亮判定消费 selection.head（挂载/标签切换语义）
      selection: { head: opts.head ?? 0 },
    },
    coordsAtPos: (pos: number): { top: number } => ({ top: opts.tops?.[pos] ?? 0 }),
    dom: opts.dom ?? document.createElement("div"),
  };
}

describe("OutlinePanel（AC-F17/F18/F19）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    h.revealRange.mockClear();
    h.loadSettings.mockReset().mockResolvedValue({ outline: { collapsible: false } });
    h.docCbs.length = 0;
    h.selCbs.length = 0;
    h.view = undefined;
    h.editor = {};
  });

  it("渲染 store.headings 为层级缩进列表，激活项带高亮类（AC-F17）", async () => {
    h.view = makeView({ docItems: FIXTURE });
    const wrapper = mount(OutlinePanel);
    await flushPromises(); // watch immediate → nextTick → 门面拉取重建
    const store = useOutlineStore();
    expect(store.headings.map((x) => x.id)).toEqual(["a", "b", "c"]); // 装配层已从门面拉取
    store.setActive("b");
    await nextTick();
    const items = wrapper.findAll("[data-outline-item]");
    expect(items).toHaveLength(3);
    expect(items[1]!.classes()).toContain("outline-panel__item--active");
    // DOMWrapper 泛型为 Element，内联样式断言收窄到 HTMLElement（jsdom 可解析 style 绑定）
    expect((items[2]!.element as HTMLElement).style.paddingLeft).toBe("32px"); // (3-1)*16
    wrapper.unmount();
  });

  it("挂载后按当前选区初始判定高亮（pullFromFacade 初始高亮回归钉）", async () => {
    // 光标预置在 B 标题文本区间内（B pos=3，文本自 pos+1=4 起）：resolve 桩无标题祖先，
    // activeIdByPos 前置回退取最近前序标题 b（即 activeIdByPos([a,b,c], doc, 4) = "b"）。
    // 钉住终审 Important-2 新行为——挂载即按当前选区高亮；移除 pullFromFacade 的
    // 初始判定行后挂载期无任何 setActive 来源，本断言即红
    h.view = makeView({ docItems: FIXTURE, head: 4 });
    const wrapper = mount(OutlinePanel);
    await flushPromises(); // watch immediate → nextTick → 门面拉取 + 初始高亮判定
    expect(useOutlineStore().activeHeadingId).toBe("b");
    wrapper.unmount();
  });

  it("点击条目调 revealRange 定位标题文本区间（AC-F18-1）", async () => {
    h.view = makeView({ docItems: FIXTURE });
    const wrapper = mount(OutlinePanel);
    await flushPromises();
    const bPos = 3;
    await wrapper.findAll("[data-outline-item]")[1]!.trigger("click");
    // 编辑器实例 + B 文本区间 [pos+1, pos+1+len)：定位标题文本而非节点边界
    expect(h.revealRange).toHaveBeenCalledWith(expect.anything(), bPos + 1, bPos + 1 + "B".length);
    wrapper.unmount();
  });

  it("编辑器未就绪时点击条目静默跳过（jumpTo 空守卫）", async () => {
    // 门面 getEditor 返回 undefined（编辑器实例尚未挂号）：点击不得外呼 revealRange
    h.view = makeView({ docItems: FIXTURE });
    h.editor = undefined;
    const wrapper = mount(OutlinePanel);
    await flushPromises();
    await wrapper.findAll("[data-outline-item]")[0]!.trigger("click");
    expect(h.revealRange).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("空文档显示空态文案（AC-F21-3 前置形态）", async () => {
    h.view = makeView({ docItems: [] });
    const wrapper = mount(OutlinePanel);
    await flushPromises();
    expect(wrapper.find("[data-outline-list]").exists()).toBe(false);
    expect(wrapper.find(".outline-panel__empty").text()).toBe("（无标题）");
    wrapper.unmount();
  });

  it("docUpdated 投递驱动列表重建（结构通道装配）", async () => {
    h.view = makeView({ docItems: FIXTURE });
    const wrapper = mount(OutlinePanel);
    await flushPromises();
    // 升格前置：激活条目置为 c（当前列表中存在）——重算后 c 消失，
    // 使「悬空高亮复位」断言具备鉴别力（否则对 undefined 初值恒真）
    useOutlineStore().setActive("c");
    // 编辑删除了 C：事件桥投递新文档 → 列表收敛为 A/B
    for (const cb of h.docCbs) cb(fakeDoc(FIXTURE.slice(0, 2)));
    await nextTick();
    expect(wrapper.findAll("[data-outline-item]")).toHaveLength(2);
    expect(useOutlineStore().activeHeadingId).toBeUndefined(); // 悬空高亮随重算复位
    wrapper.unmount();
  });

  it("selectionUpdated 投递驱动当前标题高亮（编辑通道装配，AC-F19-2）", async () => {
    // 标题前移出 pos=0（前置段落占位），使「光标位于全部标题之前」可构造
    const offset: HeadingInfo[] = [
      { id: "a", level: 1, text: "A", pos: 10 },
      { id: "b", level: 2, text: "B", pos: 13 },
      { id: "c", level: 3, text: "C", pos: 17 },
    ];
    h.view = makeView({ docItems: offset });
    const wrapper = mount(OutlinePanel);
    await flushPromises();
    // 光标 head=15（B 区间内）：resolve 桩无标题祖先 → 前置回退取最近标题 b
    for (const cb of h.selCbs) cb({ head: 15 });
    await nextTick();
    expect(useOutlineStore().activeHeadingId).toBe("b");
    // 光标移到所有标题之前 → 高亮清除
    for (const cb of h.selCbs) cb({ head: 3 });
    await nextTick();
    expect(useOutlineStore().activeHeadingId).toBeUndefined();
    wrapper.unmount();
  });

  it("滚动通道：scroller scroll 事件按 pickActiveByTop 结果回写 setActive（AC-F19-3 装配）", async () => {
    // 可滚动容器链：view.dom 的父级带内联 overflow-y:auto（findScrollContainer 判定命中）
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    document.body.appendChild(scroller);
    const dom = document.createElement("div");
    scroller.appendChild(dom);
    // jsdom getBoundingClientRect 恒零矩形 → 阈值 top = 0；
    // tops 桩令「最后一个 top ≤ 0」为 b（a=5 越阈、b=-3 达标、c=20 越阈）
    h.view = makeView({ docItems: FIXTURE, tops: { 1: 5, 4: -3, 8: 20 }, dom });
    const wrapper = mount(OutlinePanel);
    await flushPromises(); // attachScroll 已挂监听
    expect(wrapper.findAll("[data-outline-item]")).toHaveLength(3);
    scroller.dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(useOutlineStore().activeHeadingId).toBe("b");
    // 卸载后滚动监听成对解除：再投递不回写
    wrapper.unmount();
    useOutlineStore().setActive(undefined);
    scroller.dispatchEvent(new Event("scroll"));
    expect(useOutlineStore().activeHeadingId).toBeUndefined();
    scroller.remove();
  });

  it("卸载触发 dispose：双通道订阅成对解除", async () => {
    h.view = makeView({ docItems: FIXTURE });
    const wrapper = mount(OutlinePanel);
    await flushPromises();
    expect(h.docCbs).toHaveLength(1);
    expect(h.selCbs).toHaveLength(1);
    wrapper.unmount();
    expect(h.docCbs).toHaveLength(0);
    expect(h.selCbs).toHaveLength(0);
  });

  it("卸载竞态防护：nextTick 挂起期间 dispose → 续延早退不幽灵写不重挂监听", async () => {
    // 可滚动容器链就绪：若无防护，挂起续延会在 dispose 之后经 attachScroll
    // 在此容器重挂 scroll 监听（新实例 detachScroll 只能解自己的闭包，该监听成泄漏）
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    document.body.appendChild(scroller);
    const dom = document.createElement("div");
    scroller.appendChild(dom);
    const addSpy = vi.spyOn(scroller, "addEventListener");
    h.view = makeView({ docItems: FIXTURE, dom });
    const wrapper = mount(OutlinePanel);
    // 刻意不 flush：watch 回调仍挂起在 await nextTick()；此刻先卸载（dispose 抢跑）
    wrapper.unmount();
    await flushPromises(); // 挂起续延恢复——防护生效则在此早退
    const store = useOutlineStore();
    expect(store.headings).toHaveLength(0); // pullFromFacade 未幽灵写共享 store
    expect(addSpy).not.toHaveBeenCalled(); // attachScroll 未在 dispose 后重挂监听
    // 兜底口径：即便误有事件投递也无监听可回写
    scroller.dispatchEvent(new Event("scroll"));
    expect(store.activeHeadingId).toBeUndefined();
    scroller.remove();
  });

  it("onMounted 加载设置镜像 collapsible（持久化值回落覆盖 store 默认 Flat）", async () => {
    h.loadSettings.mockResolvedValue({ outline: { collapsible: true } });
    h.view = makeView({ docItems: FIXTURE });
    const wrapper = mount(OutlinePanel);
    await flushPromises();
    expect(useOutlineStore().collapsible).toBe(true);
    wrapper.unmount();
  });

  it("loadSettings reject 不阻塞渲染（catch 兜底回落默认 Flat）", async () => {
    h.loadSettings.mockRejectedValue(new Error("store 不可用"));
    h.view = makeView({ docItems: FIXTURE });
    const wrapper = mount(OutlinePanel);
    await flushPromises();
    expect(wrapper.findAll("[data-outline-item]")).toHaveLength(3);
    expect(useOutlineStore().collapsible).toBe(false);
    wrapper.unmount();
  });

  it("输入即滤；无匹配显示专属空态；清空恢复（AC-F21-1/2/3）", async () => {
    h.view = makeView({ docItems: FIXTURE });
    const wrapper = mount(OutlinePanel);
    await flushPromises();
    // 输入非空即滤（v-model 经可写计算代理写穿 setFilter）：A/B/C 仅 B 命中子串
    const input = wrapper.find("[data-outline-filter]");
    await input.setValue("B");
    expect(wrapper.findAll("[data-outline-item]")).toHaveLength(1);
    // 有标题但零命中 → 与「无标题」区分的专属空态文案
    await input.setValue("不存在词");
    expect(wrapper.find(".outline-panel__empty").text()).toBe("无匹配标题");
    // 清空过滤词恢复全量三条
    await input.setValue("");
    expect(wrapper.findAll("[data-outline-item]")).toHaveLength(3);
    wrapper.unmount();
  });

  it("门面空态（视图未就绪）主动拉取清空大纲", async () => {
    const wrapper = mount(OutlinePanel); // h.view = undefined
    await flushPromises();
    expect(wrapper.find(".outline-panel__empty").exists()).toBe(true);
    wrapper.unmount();
  });
});

describe("OutlinePanel 右键菜单与折叠（AC-F20/F22）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    h.revealRange.mockClear();
    h.loadSettings.mockReset().mockResolvedValue({ outline: { collapsible: false } });
    h.updateSettings.mockReset().mockResolvedValue({});
    h.docCbs.length = 0;
    h.selCbs.length = 0;
    h.view = undefined;
    h.editor = {};
  });

  /** 挂载已就绪面板：门面视图桩注入三级标题夹具并 flush 装配链 */
  async function mountReady(): Promise<ReturnType<typeof mount>> {
    h.view = makeView({ docItems: FIXTURE });
    const wrapper = mount(OutlinePanel);
    await flushPromises();
    return wrapper;
  }

  it("右键空白处弹菜单，Highlight Current Header 将激活条目滚入视野并闪现高亮（AC-F20-1）", async () => {
    const wrapper = await mountReady();
    useOutlineStore().setActive("b");
    await nextTick();

    // 右键列表空白区：自绘菜单弹出（原生菜单由 preventDefault 阻止）
    await wrapper.find("[data-outline-list]").trigger("contextmenu", { clientX: 10, clientY: 10 });
    expect(wrapper.find("[data-outline-menu]").exists()).toBe(true);

    // jsdom 未实现 scrollIntoView 且实例上无该成员（spyOn 需既有属性）→ 实例直挂桩
    const activeEl = wrapper.find(".outline-panel__item--active").element as HTMLElement;
    const scrollSpy = vi.fn();
    activeEl.scrollIntoView = scrollSpy;

    // 假定时器钉住高亮闪现时长（reveal-range 同款 1200ms）
    vi.useFakeTimers();
    try {
      await wrapper.find("[data-outline-menu-hch]").trigger("click");
      expect(scrollSpy).toHaveBeenCalledWith({ block: "center" });
      // 动作后菜单关闭 + 高亮类即时生效
      expect(wrapper.find("[data-outline-menu]").exists()).toBe(false);
      expect(activeEl.classList.contains("markwell-reveal-highlight")).toBe(true);
      vi.advanceTimersByTime(1200);
      expect(activeEl.classList.contains("markwell-reveal-highlight")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    wrapper.unmount();
  });

  it("无激活条目时 Highlight Current Header 静默返回不抛错", async () => {
    const wrapper = await mountReady();
    // 初始判定语义（05 终审 Important-2）：挂载即按当前选区高亮（head=0 → 命中 a），
    // 本用例构造「无高亮」前置须显式清除，验证 HCH 在无目标时的静默路径
    useOutlineStore().setActive(undefined);
    expect(useOutlineStore().activeHeadingId).toBeUndefined();
    await wrapper.find("[data-outline-list]").trigger("contextmenu", { clientX: 10, clientY: 10 });
    await wrapper.find("[data-outline-menu-hch]").trigger("click");
    // 无目标不闪现高亮，菜单照常关闭
    expect(wrapper.find(".markwell-reveal-highlight").exists()).toBe(false);
    expect(wrapper.find("[data-outline-menu]").exists()).toBe(false);
    wrapper.unmount();
  });

  it("点击面板其他区域关闭右键菜单，卸载时监听成对解除（click-away）", async () => {
    const wrapper = await mountReady();
    await wrapper.find("[data-outline-list]").trigger("contextmenu", { clientX: 10, clientY: 10 });
    expect(wrapper.find("[data-outline-menu]").exists()).toBe(true);
    // document 级一次性 click 关闭
    document.dispatchEvent(new Event("click"));
    await nextTick();
    expect(wrapper.find("[data-outline-menu]").exists()).toBe(false);
    // 卸载兜底解除：document 上不再残留 click 监听登记
    const removeSpy = vi.spyOn(document, "removeEventListener");
    wrapper.unmount();
    expect(removeSpy.mock.calls.some(([type]) => type === "click")).toBe(true);
    removeSpy.mockRestore();
  });

  it("菜单切换可折叠并持久化设置（AC-F22-2）", async () => {
    const wrapper = await mountReady();
    await wrapper.find("[data-outline-list]").trigger("contextmenu", { clientX: 10, clientY: 10 });
    const collapseItem = () => wrapper.find("[data-outline-menu-collapse]");
    // 默认 Flat → 勾选态为空；点击后 store 翻转并持久化增量 patch
    expect(collapseItem().text()).not.toContain("✓");
    await collapseItem().trigger("click");
    expect(useOutlineStore().collapsible).toBe(true);
    expect(h.updateSettings).toHaveBeenCalledWith({ outline: { collapsible: true } });
    expect(wrapper.find("[data-outline-menu]").exists()).toBe(false); // 动作后关菜单
    // 重开菜单勾选态出现 ✓；再次点击切回 Flat 并持久化 false（往返覆盖）
    await wrapper.find("[data-outline-list]").trigger("contextmenu", { clientX: 10, clientY: 10 });
    expect(collapseItem().text()).toContain("✓");
    await collapseItem().trigger("click");
    expect(useOutlineStore().collapsible).toBe(false);
    expect(h.updateSettings).toHaveBeenCalledWith({ outline: { collapsible: false } });
    wrapper.unmount();
  });

  it("折叠态下父条目显示切换钮且点击只切折叠不触发跳转（AC-F22-2 交互）", async () => {
    const wrapper = await mountReady();
    const store = useOutlineStore();
    store.setCollapsible(true);
    await nextTick();
    // A(1)→B(2)→C(3)：A、B 有子级各带 caret；C 为叶子无 caret。
    // 注意父级判定取全量序列——A 自身被折叠后仍须保留 caret 作为展开入口
    const carets = wrapper.findAll("[data-outline-caret]");
    expect(carets).toHaveLength(2);
    // 点击首个 caret（A）：toggleCollapsed 生效但不触发条目跳转（@click.stop 生效）
    await carets[0]!.trigger("click");
    expect(h.revealRange).not.toHaveBeenCalled();
    expect(store.collapsedIds.has("a")).toBe(true);
    // 折叠裁剪联动：A 子树隐藏仅剩根条目，且 A 的 caret 不消失（可再展开）
    expect(wrapper.findAll("[data-outline-item]")).toHaveLength(1);
    expect(wrapper.findAll("[data-outline-caret]")).toHaveLength(1);
    await wrapper.findAll("[data-outline-caret]")[0]!.trigger("click");
    expect(store.collapsedIds.size).toBe(0);
    expect(wrapper.findAll("[data-outline-item]")).toHaveLength(3);
    wrapper.unmount();
  });

  it("折叠根标题后列表仅剩存活的根条目，不误显任何空态（空态三分修正）", async () => {
    const wrapper = await mountReady();
    const store = useOutlineStore();
    store.setCollapsible(true);
    store.toggleCollapsed("a"); // 折叠唯一根标题 → 子树 B/C 隐藏
    await nextTick();
    // 根条目在 store 裁剪算法下恒存活（首条目入栈前祖先栈为空，「全部折叠隐藏」
    // 在当前 store 语义下不可达）→ 必须渲染列表而非任何空态文案（防回退 length 边界）
    expect(store.visibleHeadings.map((x) => x.id)).toEqual(["a"]);
    expect(wrapper.find("[data-outline-list]").exists()).toBe(true);
    expect(wrapper.find(".outline-panel__empty").exists()).toBe(false);
    wrapper.unmount();
  });

  it("过滤零命中判定先于折叠兜底空态：显示「无匹配标题」而非「无可见标题」", async () => {
    const wrapper = await mountReady();
    // 开启折叠后触发零命中：钉住新空态链的分支次序（过滤词判定先于「无可见标题」）
    useOutlineStore().setCollapsible(true);
    const input = wrapper.find("[data-outline-filter]");
    await input.setValue("不存在词");
    expect(wrapper.find(".outline-panel__empty").text()).toBe("无匹配标题");
    wrapper.unmount();
  });
});
