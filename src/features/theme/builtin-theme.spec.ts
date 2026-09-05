// 内置主题钉桩（08 T1/T8）：Crepe 变量全集、rem 字号基准、双选择器作用域。
// 直读资产文件断言（mermaid-menu.spec 先例）；防库/资产升级静默漂移。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Crepe 变量 23 个全集（17 色 + --crepe-base-font-size + 3 字体 + 2 阴影；
    spec/调研沿 Crepe 官方「22」口径漏计 base-font-size——实现按实际 23 个断言，D8-①） */
const CREPE_VARS = [
  "--crepe-color-background",
  "--crepe-color-on-background",
  "--crepe-color-surface",
  "--crepe-color-surface-low",
  "--crepe-color-on-surface",
  "--crepe-color-on-surface-variant",
  "--crepe-color-outline",
  "--crepe-color-primary",
  "--crepe-color-secondary",
  "--crepe-color-on-secondary",
  "--crepe-color-inverse",
  "--crepe-color-on-inverse",
  "--crepe-color-inline-code",
  "--crepe-color-error",
  "--crepe-color-hover",
  "--crepe-color-selected",
  "--crepe-color-inline-area",
  "--crepe-base-font-size",
  "--crepe-font-title",
  "--crepe-font-default",
  "--crepe-font-code",
  "--crepe-shadow-1",
  "--crepe-shadow-2",
];

const THEMES = ["markwell-light.css", "markwell-dark.css"] as const;

describe("内置主题资产钉桩", () => {
  for (const file of THEMES) {
    const css = readFileSync(resolve("src-tauri/assets/themes", file), "utf8");

    it(`${file} 覆盖 Crepe 变量全集（23 个变量，D8-① 口径）`, () => {
      for (const name of CREPE_VARS) {
        expect(css).toContain(name);
      }
    });

    it(`${file} 基准字号为 rem（AC-T8-2：字号偏好调整时全文字号跟随的前提）`, () => {
      expect(css).toMatch(/--crepe-base-font-size:\s*1rem/);
    });

    it(`${file} 无 px 字号声明（rem 链路完整性）`, () => {
      expect(css).not.toMatch(/font-size:\s*\d+(\.\d+)?px/);
    });

    it(`${file} 采用双选择器作用域（D-4：主题段须能覆盖 crepe-overrides 暗色默认段）`, () => {
      expect(css).toMatch(/^\.milkdown,\s*\n\.markwell-dark \.milkdown \{/m);
    });

    it(`${file} 无外部 @import（离线完整性，主题经 asset 协议加载）`, () => {
      expect(css).not.toMatch(/@import/);
    });
  }

  it("亮暗两套主题内容独立（非复制品）", () => {
    const light = readFileSync(resolve("src-tauri/assets/themes/markwell-light.css"), "utf8");
    const dark = readFileSync(resolve("src-tauri/assets/themes/markwell-dark.css"), "utf8");
    expect(light).not.toBe(dark);
    expect(light).toContain("#ffffff"); // 亮色底
    expect(dark).toContain("#101418"); // 暗色底
  });
});
