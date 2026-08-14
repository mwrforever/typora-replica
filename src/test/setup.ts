// 编辑器测试基座：补齐 jsdom 缺失的浏览器 API（CodeMirror 6/ProseMirror 依赖）
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/vue";
import { afterEach } from "vitest";
import { destroyTestEditors } from "./editor-test-utils";

// IntersectionObserver：Crepe 代码块懒初始化依赖，测试环境恒视为可见
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
// @ts-expect-error jsdom 无原生实现，测试环境注入桩
globalThis.IntersectionObserver = IntersectionObserverStub;

// ResizeObserver：CodeMirror 测量依赖
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub;

// matchMedia：部分插件查询暗色偏好
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

// Range.getClientRects：CodeMirror 光标测量依赖，jsdom 返回空矩形
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function () {
    return [] as unknown as DOMRectList;
  };
}

// Range.getBoundingClientRect：jsdom 的 Range 同样未实现，
// ProseMirror 虚拟光标插件（prosemirror-virtual-cursor）测量光标位置时依赖，返回零矩形即可
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = function () {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    } as unknown as DOMRect;
  };
}

// Element.scrollIntoView：jsdom 未实现（revealRange 滚动定位测试需要 spy 目标），注入空实现
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

afterEach(() => {
  // 销毁本用例创建的编辑器实例并卸载 Vue 组件
  destroyTestEditors();
  cleanup();
});
