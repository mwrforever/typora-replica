// Find 面板组件用例（Find 态）：find-controller 全量 mock，store 走真实 Pinia
//
// editor-manager 轻桩（OutlinePanel.spec 同款约束）：组件 closePanel 仅消费
// getView()?.focus()，返回 undefined 即可走通 optional chain，不触达真实编辑器链。
import { beforeEach, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";

// vi.mock 工厂被提升到 import 之前求值，共享桩状态收拢进 hoisted 容器
// （vitest 同路径 mock 以最后注册为准：新增导出必须并入本文件唯一工厂，禁止用例内重复注册）
const h = vi.hoisted(() => ({
  controllerDispose: vi.fn(),
  navigateNext: vi.fn(),
  navigatePrev: vi.fn(),
  replaceOne: vi.fn(),
  replaceAll: vi.fn(),
}));
vi.mock("./find-controller", () => ({
  useFindController: () => ({ dispose: h.controllerDispose }),
  navigateNext: (...a: unknown[]) => h.navigateNext(...a),
  navigatePrev: (...a: unknown[]) => h.navigatePrev(...a),
  replaceOneInView: (...a: unknown[]) => h.replaceOne(...a),
  replaceAllInView: (...a: unknown[]) => h.replaceAll(...a),
}));

vi.mock("../editor/editor-manager", () => ({
  editorManager: {
    // 关闭回焦走 optional chain：undefined = 门面空态，安全通过
    getView: (): undefined => undefined,
  },
}));

import FindReplacePanel from "./FindReplacePanel.vue";
import { useSearchStore } from "./search-store";

// 桩跨用例共享：每例清零调用记录，保证 toHaveBeenCalledOnce 断言只计本例行为
beforeEach(() => {
  setActivePinia(createPinia());
  h.controllerDispose.mockClear();
  h.navigateNext.mockClear();
  h.navigatePrev.mockClear();
  h.replaceOne.mockClear();
  h.replaceAll.mockClear();
});

async function openPanel() {
  const store = useSearchStore();
  const wrapper = mount(FindReplacePanel, { attachTo: document.body });
  store.toggleFind(); // 或直接置字段
  await nextTick();
  return { store, wrapper };
}

it("默认不渲染浮层；打开后出现且查询框自动聚焦（AC-F24-1）", async () => {
  const store = useSearchStore();
  const wrapper = mount(FindReplacePanel, { attachTo: document.body });
  expect(wrapper.find("[data-find-panel]").exists()).toBe(false);
  store.toggleFind();
  await nextTick();
  // 聚焦在 watch 回调内部二次 nextTick 后执行（微任务序：测试先于 watch 续体恢复），
  // 需再等一拍才能断言 activeElement
  await nextTick();
  const input = wrapper.find("[data-find-input]");
  expect(input.exists()).toBe(true);
  expect(document.activeElement).toBe(input.element);
  wrapper.unmount();
  expect(h.controllerDispose).toHaveBeenCalled(); // 装配与组件生命周期成对
});

it("计数文案四态：n/m、0 匹配 0/0、非法正则与空匹配专属提示（AC-F24-2/6、AC-F25-5 呈现）", async () => {
  const { store, wrapper } = await openPanel();
  store.setQuery("词");
  store.setStatus("ok");
  store.applyCounts(10, 2);
  await nextTick();
  expect(countText()).toBe("3/10");
  store.applyCounts(0, 0);
  await nextTick();
  expect(countText()).toBe("0/0");
  store.setStatus("invalid-regex");
  await nextTick();
  expect(countText()).toBe("无效正则");
  store.setStatus("matches-empty"); // Task 5 审查补遗：零长匹配拒绝态的专属文案
  await nextTick();
  expect(countText()).toBe("无法搜索：正则可匹配空串");
  wrapper.unmount();
});

/** 计数文案读取助手（data-find-count 文本；attachTo 挂载直查 document） */
function countText(): string {
  return document.querySelector("[data-find-count]")?.textContent ?? "";
}

it("v-model 回写 store.setQuery；Enter/Shift+Enter 分发导航", async () => {
  const { store, wrapper } = await openPanel();
  await wrapper.find("[data-find-input]").setValue("新词");
  expect(store.query).toBe("新词");
  await wrapper.find("[data-find-input]").trigger("keydown", { key: "Enter" });
  expect(h.navigateNext).toHaveBeenCalledOnce();
  await wrapper.find("[data-find-input]").trigger("keydown", { key: "Enter", shiftKey: true });
  expect(h.navigatePrev).toHaveBeenCalledOnce();
  wrapper.unmount();
});

it("上一处/下一处/关闭按钮分发；关闭后浮层消失", async () => {
  const { store, wrapper } = await openPanel();
  await wrapper.find("[data-find-next]").trigger("click");
  await wrapper.find("[data-find-prev]").trigger("click");
  expect(h.navigateNext).toHaveBeenCalledOnce();
  expect(h.navigatePrev).toHaveBeenCalledOnce();
  await wrapper.find("[data-find-close]").trigger("click");
  expect(store.visible).toBe(false);
  expect(wrapper.find("[data-find-panel]").exists()).toBe(false);
  wrapper.unmount();
});

it("三开关按钮切换 active 类与 store 字段", async () => {
  const { store, wrapper } = await openPanel();
  await wrapper.find("[data-toggle-case]").trigger("click");
  expect(store.caseSensitive).toBe(true);
  expect(wrapper.find("[data-toggle-case]").classes()).toContain("find-panel__toggle--active");
  await wrapper.find("[data-toggle-word]").trigger("click");
  await wrapper.find("[data-toggle-regexp]").trigger("click");
  expect(store.wholeWord && store.regexp).toBe(true);
  wrapper.unmount();
});

it("replace 模式渲染替换行：输入回写 store.replacement", async () => {
  const { store, wrapper } = await openPanel();
  store.toggleReplace();
  await nextTick();
  const input = wrapper.find("[data-replace-input]");
  expect(input.exists()).toBe(true);
  await input.setValue("$2@$1");
  expect(store.replacement).toBe("$2@$1");
  wrapper.unmount();
});

it("「替换」「全部」点击分发 controller 命令；非法正则态禁用（AC-F25-5 UI 面）", async () => {
  const { store, wrapper } = await openPanel();
  store.toggleReplace();
  store.setQuery("词");
  store.setStatus("ok");
  await nextTick();
  const oneBtn = wrapper.find("[data-replace-one]");
  const allBtn = wrapper.find("[data-replace-all]");
  expect(oneBtn.attributes("disabled")).toBeUndefined();
  await oneBtn.trigger("click");
  expect(h.replaceOne).toHaveBeenCalledOnce();
  await allBtn.trigger("click");
  expect(h.replaceAll).toHaveBeenCalledOnce();

  store.setStatus("invalid-regex"); // 非法态：禁用且点击不生效
  await nextTick();
  expect(oneBtn.attributes("disabled")).toBeDefined();
  expect(allBtn.attributes("disabled")).toBeDefined();
  await oneBtn.trigger("click");
  expect(h.replaceOne).toHaveBeenCalledOnce(); // 次数不增
  wrapper.unmount();
});
