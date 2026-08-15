// 编辑器测试基座：补齐 jsdom 缺失的浏览器 API（CodeMirror 6/ProseMirror 依赖）
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/vue";
import { afterEach } from "vitest";

// IntersectionObserver：Crepe 代码块懒初始化依赖，测试环境恒视为可见。
// observe() 时立即以 isIntersecting=true 回调：真实浏览器在元素进入视口后异步回调，
// 桩同步触发使 CodeMirror 在节点视图创建时即刻初始化（E6 代码围栏用例依赖）。
class IntersectionObserverStub {
  constructor(private callback: IntersectionObserverCallback) {}

  observe(target: Element) {
    // 立即上报「可见」，等价真实观察器首次进入视口的上报
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
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

// document.elementFromPoint：jsdom 未实现；Milkdown block 插件的指针悬停
//（BlockService.mousemoveCallback）依赖其反查命中元素，E8 表格工具栏悬停模拟触发，
// 测试环境无布局，恒返回 null（无命中目标）
if (!document.elementFromPoint) {
  document.elementFromPoint = function () {
    return null;
  } as unknown as typeof document.elementFromPoint;
}

afterEach(async () => {
  // 销毁本用例创建的编辑器实例并卸载 Vue 组件。
  // 延迟导入 editor-test-utils：setup 阶段若静态导入会提前求值编辑器模块链
  //（editor-test-utils → 各插件 → services），使测试文件内 vi.mock（如 E14 对
  // external-open）无法作用于已求值模块；延迟到用例结束再导入时模块已被测试
  // 文件按 mock 求值并缓存，销毁语义不变。
  const { destroyTestEditors } = await import("./editor-test-utils");
  destroyTestEditors();
  cleanup();
});
