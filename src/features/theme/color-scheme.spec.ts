// src/features/theme/color-scheme.spec.ts
// 系统色系监视（08 spec T5 明暗源）：即时求值 + change 订阅 + 退订。
// setup.ts 的 matchMedia 恒 false 桩不满足本模块——逐用例覆盖可控桩。
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentSystemDark, watchSystemColorScheme } from "./color-scheme";

type Listener = (event: { matches: boolean }) => void;

/** 安装可控 matchMedia 桩，返回触发器与监听计数 */
function installMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  const mql = {
    matches: initial,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  };
  const original = window.matchMedia;
  window.matchMedia = vi.fn(() => mql) as unknown as typeof window.matchMedia;
  return {
    fire(matches: boolean) {
      mql.matches = matches;
      listeners.forEach((l) => l({ matches }));
    },
    listenerCount: () => listeners.size,
    restore() {
      window.matchMedia = original;
    },
  };
}

describe("color-scheme 系统色系监视", () => {
  const handles: ReturnType<typeof installMatchMedia>[] = [];
  afterEach(() => {
    for (const h of handles.splice(0)) h.restore();
  });

  it("currentSystemDark 即时求值 true/false 两态", () => {
    const h = installMatchMedia(true);
    handles.push(h);
    expect(currentSystemDark()).toBe(true);
    h.fire(false);
    expect(currentSystemDark()).toBe(false);
  });

  it("订阅 change 回调携带最新色系（AC-T5-1 事件源）", () => {
    const h = installMatchMedia(false);
    handles.push(h);
    const onChange = vi.fn();
    watchSystemColorScheme(onChange);
    h.fire(true);
    expect(onChange).toHaveBeenCalledWith(true);
    h.fire(false);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("退订后不再回调（监听泄漏防护）", () => {
    const h = installMatchMedia(false);
    handles.push(h);
    const onChange = vi.fn();
    const unsubscribe = watchSystemColorScheme(onChange);
    expect(h.listenerCount()).toBe(1);
    unsubscribe();
    expect(h.listenerCount()).toBe(0);
    h.fire(true);
    expect(onChange).not.toHaveBeenCalled();
  });
});
