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

// DragEvent/ClipboardEvent：jsdom 未实现这两个事件构造器，而 Crepe 上传插件按
// `event instanceof DragEvent / ClipboardEvent` 判定拖拽/粘贴事件类型（E15 用例依赖）。
// 桩以 jsdom 已有的 MouseEvent/Event 为基类补全 dataTransfer/clipboardData 载荷
//（DataTransfer 本体 jsdom 亦未实现，事件载荷由测试侧普通对象提供，见 e15-image.spec）
if (typeof window.DragEvent !== "function") {
  class DragEventStub extends MouseEvent {
    readonly dataTransfer: DataTransfer | null;

    constructor(type: string, init: DragEventInit = {}) {
      super(type, init);
      this.dataTransfer = init.dataTransfer ?? null;
    }
  }
  window.DragEvent = DragEventStub as unknown as typeof DragEvent;
}
if (typeof window.ClipboardEvent !== "function") {
  class ClipboardEventStub extends Event {
    readonly clipboardData: DataTransfer | null;

    constructor(type: string, init: ClipboardEventInit = {}) {
      super(type, init);
      this.clipboardData = init.clipboardData ?? null;
    }
  }
  window.ClipboardEvent = ClipboardEventStub as unknown as typeof ClipboardEvent;
}

// URL.createObjectURL：jsdom 未实现（jsdom issue #3136），而 Crepe 图片上传缺省路径
//（未注入 onUpload 时）以它生成 blob URL 占位（E15 AC-E15-3 缺省回落依赖）。
// 桩返回确定性 blob 伪 URL，真实 WebView 原生支持不受影响。
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = ((file: Blob) =>
    `blob:mock/${(file as File).name ?? "file"}`) as typeof URL.createObjectURL;
}

afterEach(
  async () => {
    // 销毁本用例创建的编辑器实例并卸载 Vue 组件。
    // 延迟导入 editor-test-utils：setup 阶段若静态导入会提前求值编辑器模块链
    //（editor-test-utils → 各插件 → services），使测试文件内 vi.mock（如 E14 对
    // external-open）无法作用于已求值模块；延迟到用例结束再导入时模块已被测试
    // 文件按 mock 求值并缓存，销毁语义不变。
    const { destroyTestEditors } = await import("./editor-test-utils");
    // await 销毁：Editor.destroy 为异步流程，需等 DOM 清理完成再断言（destroyTestEditors 已改 async）
    await destroyTestEditors();
    cleanup();
  },
  // 纯函数类 spec（如 html-sanitize）不静态导入编辑器链，本钩子承担其首次冷加载；
  // v8 覆盖率插桩下的冷转换可能超过默认 10s 钩子超时（新增文件后首跑实测超时），
  // 放宽到 60s 保证单文件聚焦运行在冷启动机器上稳定通过
  60_000,
);
