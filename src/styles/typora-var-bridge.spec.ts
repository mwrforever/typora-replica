// src/styles/typora-var-bridge.spec.ts
// Typora 变量映射兜底层钉桩（spec §3 兼容策略，尽力而为）：作用域/核心映射/
// 回退值形态/加载顺序。直读文件断言（mermaid-menu.spec 先例）。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve("src/styles/typora-var-bridge.css"), "utf8");
const mainTs = readFileSync(resolve("src/main.ts"), "utf8");

describe("Typora 变量映射兜底层", () => {
  it("作用域为 .milkdown 单选择器（特异性低于主题双选择器段，不抢主题层）", () => {
    expect(css).toMatch(/^\.milkdown \{/m);
    expect(css).not.toContain(".markwell-dark");
  });

  it("官方常用变量核心映射钉桩", () => {
    expect(css).toContain("--crepe-color-background: var(--bg-color,");
    expect(css).toContain("--crepe-color-on-background: var(--text-color,");
    expect(css).toContain("--crepe-color-primary: var(--primary-color,");
    expect(css).toContain("--crepe-color-outline: var(--border-color,");
    expect(css).toContain("--crepe-color-inline-code: var(--code-color,");
    expect(css).toContain("--crepe-color-surface-low: var(--side-bar-bg-color,");
  });

  it("全部映射行带字面量回退值（Typora 变量未定义时回落，与 crepe-overrides 亮色同值）", () => {
    const lines = css.split("\n").filter((l) => l.trim().startsWith("--crepe-"));
    expect(lines.length).toBeGreaterThan(10);
    for (const line of lines) {
      expect(line).toMatch(/var\(--[a-z-]+,\s*#\w+\)/);
    }
  });

  it("加载顺序：crepe-overrides（基础层）之后静态引入（主题 link 之前的映射层位置）", () => {
    const overrides = mainTs.indexOf("./styles/crepe-overrides.css");
    const bridge = mainTs.indexOf("./styles/typora-var-bridge.css");
    expect(overrides).toBeGreaterThan(-1);
    expect(bridge).toBeGreaterThan(overrides);
  });
});
