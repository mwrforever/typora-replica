import { $, browser, expect } from "@wdio/globals";

/**
 * 图片显示链路 E2E（07 spec §3 非功能：proxyDomURL + convertFileSrc + assetProtocol
 * scope + CSP 全链端到端）
 *
 * 启动形态：capability 以系统临时目录 markwell-e2e-image/doc.md（引用同目录 pic.png）
 * 经 --reopen-file 打开——currentDir 即图片所在目录，应用挂载时触发 allow_asset_directory
 * 动态授权。fixture 落盘在 wdio.conf.ts 配置加载期完成（早于本文件加载）。
 *
 * 断言链：
 *   1. 编辑器内 image-block 的 img.src 被 local-image-view 观察器改写为 asset 协议 URL
 *      （--use-localhost 形态为 http://asset.localhost/...，Task 7 显示解析链路生效）；
 *   2. img.naturalWidth === 1：图片真实解码成功 = 动态授权 + CSP img-src + asset
 *      协议响应全链路通。
 *
 * 注：简报建议的 executeScript fetch(assetUrl) 断言改用 naturalWidth——fetch 走 CSP
 * connect-src 指令（本项目放行面为 img-src），可能因策略未放行而假红；naturalWidth
 * 才是真实渲染路径（<img> 加载解码）的证据，且不受额外指令影响。
 */
describe("图片显示链路（07 asset 协议端到端）", () => {
  it("打开含本地图片的文档 → src 解析为 asset 协议且图片真实解码", async () => {
    // 等待编辑器挂载（Crepe 异步创建完成）
    const editor = await $(".milkdown");
    await expect(editor).toBeDisplayed();

    // markdown ![](pic.png) 渲染为 image-block 块节点内的 img（PIN-3 实证 DOM 形态）
    const img = await $("div.milkdown-image-block img");
    await img.waitForExist({ timeout: 15000 });

    // 观察器把原始相对 src 改写为 asset 协议 URL 存在异步窗口（IPC 解析 + 授权），
    // 以 waitUntil 轮询消除竞态
    await browser.waitUntil(
      async () => {
        const src = await img.getAttribute("src");
        return typeof src === "string" && src.startsWith("http://asset.localhost/");
      },
      { timeout: 15000, timeoutMsg: "img.src 未在超时内解析为 asset 协议 URL" },
    );
    const src = (await img.getAttribute("src")) as string;
    expect(src.startsWith("http://asset.localhost/")).toBe(true);

    // 端到端可访问性证据：naturalWidth 为实际解码宽度（fixture 为 1x1 png）；
    // 授权缺失/CSP 拦截/协议 403 任一环节断链都会使解码失败（naturalWidth=0）
    const naturalWidth = await browser.execute(() => {
      const el = document.querySelector("div.milkdown-image-block img");
      return el instanceof HTMLImageElement ? el.naturalWidth : -1;
    });
    expect(naturalWidth).toBe(1);
  });
});
