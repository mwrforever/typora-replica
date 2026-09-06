import { $, browser, expect } from "@wdio/globals";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * 08 主题 E2E（计划核定链路：启动注入 → 变量真实生效 → 热刷新重挂）。
 * 菜单链路（AC-T1-1 菜单展示 / AC-T2-1 按钮触发 / AC-T5-1 系统切换）依赖
 * 10/12 模块 UI，未落地——验证层级降级 Vitest（PR 披露清单附录 A）。
 * 前置：①Rust 侧变更后先 cargo build（application 指 debug 产物）；
 *      ②本地系统为亮色（默认激活 markwell-light；CI 不跑 wdio——C.5 冒烟为进程级）；
 *      ③用例写真实主题目录（identifier com.markwell.app），finally 必须还原；
 *      ④settings.theme 组已由 wdio.conf 配置加载期重置为默认并在 onComplete 还原
 *        （D8-②：themeStore.init 仅启动读一次设置，重置必须先于应用启动落盘 store 文件）。
 */
// 真实主题目录（应用数据目录）
const themesDir = path.join(process.env.APPDATA ?? "", "com.markwell.app", "themes");
const lightCssPath = path.join(themesDir, "markwell-light.css");

/** 从主题 CSS 文本提取 --crepe-color-background 值（热刷新哨兵比对用） */
function backgroundOf(css: string): string {
  const m = css.match(/--crepe-color-background:\s*(#[0-9a-fA-F]{6})/);
  if (!m) throw new Error("主题文件缺少 --crepe-color-background");
  return m[1];
}

/** 读编辑器根上当前生效的背景变量（主题真实生效的直接证据） */
async function computedBackground(): Promise<string> {
  return browser.execute(() =>
    getComputedStyle(document.querySelector(".milkdown")!)
      .getPropertyValue("--crepe-color-background")
      .trim(),
  );
}

describe("08 主题链路", () => {
  it("启动后注入内置亮色主题且变量真实生效（AC-T1-2 服务端段实证）", async () => {
    await $(".milkdown"); // 等前端完全加载（编辑器挂载）
    const link = await $("#markwell-theme-link");
    await expect(link).toExist();
    const href = await link.getAttribute("href");
    expect(href).toContain("markwell-light.css"); // 默认亮色主题（settings 默认值）
    expect(href).toMatch(/^http:\/\/asset\.localhost\//); // asset 协议（CSP 已放行）
    expect(href).toContain("?t="); // 注入即带缓存戳
    // 内置主题已预置到真实数据目录（setup 钩子产物，D-1）
    const css = readFileSync(lightCssPath, "utf8");
    // 主题变量真实生效：计算值与主题文件定义一致（非 crepe-overrides 兜底态推测）
    expect(await computedBackground()).toBe(backgroundOf(css));
  });

  it("热刷新：修改激活主题文件 → link 以新 ?t= 重挂且变量更新（AC-T3-2）", async () => {
    const link = await $("#markwell-theme-link");
    const initialHref = await link.getAttribute("href");
    const original = readFileSync(lightCssPath, "utf8");
    try {
      // 哨兵色与默认 #ffffff 可区分且满足 #rrggbb 形态
      const sentinel = "#010203";
      const modified = original.replace(
        /--crepe-color-background:\s*#[0-9a-fA-F]{6}/,
        `--crepe-color-background: ${sentinel}`,
      );
      writeFileSync(lightCssPath, modified, "utf8");
      // watch_themes(100ms 合并) → 前端 300ms 防抖 → link 重挂，8s 上限留足时序余量
      await browser.waitUntil(
        async () => (await $("#markwell-theme-link").getAttribute("href")) !== initialHref,
        { timeout: 8000, timeoutMsg: "热刷新未重挂主题 link" },
      );
      expect(await link.getAttribute("href")).not.toBe(initialHref);
      // 样式真实更新（非仅 href 变化）
      await browser.waitUntil(async () => (await computedBackground()) === sentinel, {
        timeout: 5000,
        timeoutMsg: "主题变量未随热刷新更新",
      });
    } finally {
      // 还原内置主题文件（预置逻辑「缺失才写」，必须由测试自行恢复）
      writeFileSync(lightCssPath, original, "utf8");
    }
  });
});
