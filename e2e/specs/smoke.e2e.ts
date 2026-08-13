import { $, expect } from "@wdio/globals";

/**
 * 应用冒烟测试（E2E）
 *
 * 验证最小可运行闭环：
 *   1. Tauri 窗口能启动并加载前端
 *   2. 前端 → Rust 命令调用链路可用（脚手架 greet 示例）
 * 后续功能模块的 E2E 用例在此基础上按模块扩展。
 */
describe("应用冒烟测试", () => {
  it("窗口正常启动并渲染脚手架页面", async () => {
    // 等待页面主标题出现，说明 WebView 已成功加载前端
    const heading = await $("h1");
    await expect(heading).toBeDisplayed();
    await expect(heading).toHaveText("Welcome to Tauri + Vue");
  });

  it("greet 命令链路可用（前端 invoke → Rust → 前端渲染）", async () => {
    // 在输入框填写名称并提交，验证 Rust 命令返回值能渲染回页面
    const input = await $("#greet-input");
    await input.setValue("MarkWell");

    const submitBtn = await $("button[type=submit]");
    await submitBtn.click();

    // 断言页面末尾的问候语（Rust 侧拼接后返回），包含匹配
    const greetMsg = await $("main p:last-of-type");
    await expect(greetMsg).toHaveText("Hello, MarkWell!", { containing: true });
  });
});
