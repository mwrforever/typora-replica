// OutlinePanel 组件用例（05 大纲 Task 6，AC-F17/F18/F19）
//
// 覆盖：层级缩进列表渲染与激活高亮（F17）/ 点击条目透传 revealRange 定位标题
// 文本区间（F18-1）/ 空态文案 / doc·selection 双通道装配语义（F19）/ 滚动通道
// 「scroll 发生时 setActive 按 pickActiveByTop 结果回写」的装配语义 / dispose 与
// mount 严格成对 / 设置镜像加载 / 过滤输入框输入即滤与双空态区分（F21）。
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
  /** 装配层注册的 docUpdated 订阅回调（用例内手动投递模拟事件桥） */
  docCbs: [] as Array<(doc: unknown) => void>,
  /** 装配层注册的 selectionUpdated 订阅回调 */
  selCbs: [] as Array<(sel: unknown) => void>,
  /** getView() 返回值（按用例注入视图桩；undefined = 门面空态） */
  view: undefined as unknown,
}));

vi.mock("../editor/reveal-range", () => ({
  revealRange: (...a: unknown[]) => h.revealRange(...a),
}));

vi.mock("../editor/editor-manager", () => ({
  editorManager: {
    // revealRange 已 mock：编辑器桩仅需非空即可通过组件守卫
    getEditor: (): unknown => ({}),
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
 * depth=0 令其走前置回退路径）；coordsAtPos 按 pos 映射视口 top（滚动通道度量桩）；
 * dom 作为 findScrollContainer 起点。
 * @param opts.docItems 文档标题集合；tops pos→视口 top 映射；dom 挂载宿主元素
 */
function makeView(opts: {
  docItems: HeadingInfo[];
  tops?: Record<number, number>;
  dom?: HTMLElement;
}): unknown {
  return {
    state: {
      doc: {
        ...fakeDoc(opts.docItems),
        // resolve 桩：深度恒 0 → activeIdByPos 跳过祖先上溯，走「pos 前最近标题」回退
        resolve: (): { depth: number } => ({ depth: 0 }),
      },
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
    expect(items[1].classes()).toContain("outline-panel__item--active");
    // DOMWrapper 泛型为 Element，内联样式断言收窄到 HTMLElement（jsdom 可解析 style 绑定）
    expect((items[2].element as HTMLElement).style.paddingLeft).toBe("32px"); // (3-1)*16
    wrapper.unmount();
  });

  it("点击条目调 revealRange 定位标题文本区间（AC-F18-1）", async () => {
    h.view = makeView({ docItems: FIXTURE });
    const wrapper = mount(OutlinePanel);
    await flushPromises();
    const bPos = 3;
    await wrapper.findAll("[data-outline-item]")[1].trigger("click");
    // 编辑器实例 + B 文本区间 [pos+1, pos+1+len)：定位标题文本而非节点边界
    expect(h.revealRange).toHaveBeenCalledWith(expect.anything(), bPos + 1, bPos + 1 + "B".length);
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
