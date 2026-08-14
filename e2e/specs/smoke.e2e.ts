import { $, expect } from "@wdio/globals";

/**
 * 应用冒烟测试（E2E）
 *
 * 验证编辑器最小闭环：
 *   1. Tauri 窗口启动并加载前端
 *   2. Milkdown Crepe 编辑器真实挂载并渲染初始文档
 * 输入规则与快捷键冒烟在 Task 22 追加。
 */
describe("应用冒烟测试", () => {
  it("窗口正常启动并挂载 Milkdown 编辑器", async () => {
    // 等待编辑器根容器出现（Crepe 异步创建完成）
    const editor = await $(".milkdown");
    await expect(editor).toBeDisplayed();
  });

  it("初始文档渲染为标题", async () => {
    const heading = await $(".milkdown h1");
    await expect(heading).toHaveText("欢迎使用 MarkWell");
  });
});
