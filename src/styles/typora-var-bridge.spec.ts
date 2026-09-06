// src/styles/typora-var-bridge.spec.ts
// Typora 变量映射兜底层钉桩（spec §3 兼容策略，尽力而为）：宿主为 crepe-overrides.css
// 尾部映射段（2026-09-06 用户裁决 D-9(b)：并入以恢复宪法 A.1.2.11/B.1 全局样式
// 两文件白名单，独立文件已删除）。断言：作用域/核心映射/回退值形态/文件内层序/
// 独立文件与 import 不复活。直读文件断言（mermaid-menu.spec 先例）。
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const overridesCss = readFileSync(resolve("src/styles/crepe-overrides.css"), "utf8");
const mainTs = readFileSync(resolve("src/main.ts"), "utf8");

// 映射段锚点：crepe-overrides.css 尾部段头注释（段定位与层序断言的基准）
const BRIDGE_ANCHOR = "Typora 变量映射兜底层";
const bridgeSegment = overridesCss.slice(overridesCss.indexOf(BRIDGE_ANCHOR));

describe("Typora 变量映射兜底层（并入 crepe-overrides.css 尾部）", () => {
  it("映射段存在于 crepe-overrides.css 且位于基础段/暗色段之后（文件内层序=原独立文件静态引入顺序）", () => {
    expect(overridesCss).toContain(BRIDGE_ANCHOR);
    const darkAnchor = ".markwell-dark .milkdown {";
    expect(overridesCss.indexOf(BRIDGE_ANCHOR)).toBeGreaterThan(overridesCss.indexOf(darkAnchor));
  });

  it("独立文件与 main.ts import 不复活（死文件零容忍：白名单恢复两文件格局）", () => {
    expect(existsSync(resolve("src/styles/typora-var-bridge.css"))).toBe(false);
    expect(mainTs).not.toContain("typora-var-bridge.css");
  });

  it("作用域为 .milkdown 单选择器（特异性低于主题双选择器段，不抢主题层）", () => {
    expect(bridgeSegment).toMatch(/^\.milkdown \{/m);
    expect(bridgeSegment).not.toContain(".markwell-dark");
  });

  it("官方常用变量核心映射钉桩", () => {
    expect(bridgeSegment).toContain("--crepe-color-background: var(--bg-color,");
    expect(bridgeSegment).toContain("--crepe-color-on-background: var(--text-color,");
    expect(bridgeSegment).toContain("--crepe-color-primary: var(--primary-color,");
    expect(bridgeSegment).toContain("--crepe-color-outline: var(--border-color,");
    expect(bridgeSegment).toContain("--crepe-color-inline-code: var(--code-color,");
    expect(bridgeSegment).toContain("--crepe-color-surface-low: var(--side-bar-bg-color,");
  });

  it("映射段全部映射行带字面量回退值（Typora 变量未定义时回落，与亮色段同值）", () => {
    const lines = bridgeSegment.split("\n").filter((l) => l.trim().startsWith("--crepe-"));
    expect(lines.length).toBeGreaterThan(10);
    for (const line of lines) {
      expect(line).toMatch(/var\(--[a-z-]+,\s*#\w+\)/);
    }
  });
});
