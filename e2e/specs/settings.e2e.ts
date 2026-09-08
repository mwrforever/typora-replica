// 10 偏好设置 E2E：面板开合（Ctrl+,）/ 7 分区导航 / 面板内 Ctrl+F 过滤 / 设置项改-还原式持久化。
// 跨重启持久化为本地手验项（CI 冒烟不含——披露 11）；用例内切换的设置一律还原，避免污染真实偏好。
import { expect } from "@wdio/globals";

describe("10 偏好设置面板", () => {
  it("Ctrl+, 打开面板并显示 7 分区导航（AC-S1-1）", async () => {
    await browser.keys(["Control", ","]);
    const navItems = await $$('[data-testid="settings-nav"] [data-testid="settings-nav-item"]');
    expect(navItems.length).toBe(7);
    expect(await navItems[0]!.getText()).toBe("General");
  });

  it("Ctrl+F 过滤设置项（AC-S1-2）", async () => {
    await browser.keys(["Control", "f"]);
    const input = await $('[data-testid="settings-search-input"]');
    await input.setValue("行内数学");
    // 搜索态出现命中结果行（class 稳定于 SettingsPanel.vue 的结果列表）；
    // 逐元素 getText 收集（outline.e2e 同款 for...of 形态，规避 .map 不可迭代形态）
    await browser.waitUntil(async () => (await $$(".settings-hits__item")).length > 0, {
      timeoutMsg: "搜索态未出现命中结果行",
    });
    const texts: string[] = [];
    for (const hit of await $$(".settings-hits__item")) {
      texts.push(await hit.getText());
    }
    expect(texts.some((t) => t.includes("行内数学公式"))).toBe(true);
  });

  it("切换设置并还原，重开面板值保留（AC-S1-3 面板内持久化面）", async () => {
    // 关闭 → 导航到 Markdown（导航区第 6 项，li 序）→ 切换行内数学 → 关闭 → 重开核对 → 还原
    await browser.keys(["Escape"]);
    await browser.keys(["Control", ","]);
    const markdownNav = await $('[data-testid="settings-nav"] li:nth-child(6) button');
    await markdownNav.click();
    const row = await $('[data-testid="setting-row-markdown.inline-math"] input[type="checkbox"]');
    const before = await row.isSelected();
    await row.click();
    const after = await row.isSelected();
    expect(after).toBe(!before);
    // 重开面板值保留（store 快照持久化链路）
    await browser.keys(["Escape"]);
    await browser.keys(["Control", ","]);
    const rowReopened = await $(
      '[data-testid="setting-row-markdown.inline-math"] input[type="checkbox"]',
    );
    expect(await rowReopened.isSelected()).toBe(!before);
    // 还原（避免污染真实偏好）
    await rowReopened.click();
    await browser.keys(["Escape"]);
  });
});
