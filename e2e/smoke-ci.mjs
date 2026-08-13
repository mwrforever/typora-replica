// CI 冒烟测试脚本（WebDriver 在 CI 环境不可用时的降级验证方案）
//
// 背景：GitHub Actions 的 WebView2 150.x 与 msedgedriver 的自动化握手存在
// 环境兼容问题（DevToolsActivePort 会话创建失败），完整 WebDriver E2E 保留在
// 本地执行（npm run test:e2e）。本脚本通过 CDP 协议直接驱动应用，覆盖与
// WebDriver 冒烟用例相同的验证目标：
//   1. 应用可启动、WebView2 正常初始化
//   2. 前端页面成功渲染（脚手架主标题存在）
//   3. 前端 → Rust 命令调用链路可用（greet 命令往返）
//
// 前置条件：应用已带 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=0
// 启动（WebView2 会自动写 DevToolsActivePort 文件到 user data 目录）。
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

// 应用 user data 目录（与 tauri identifier 对应，见 tauri.conf.json）
const APP_DATA_DIR = `${process.env.LOCALAPPDATA}\\com.markwell.app`;

// DevToolsActivePort 候选路径：WebView2 不同版本写文件的位置有差异
// （本地 151 写在 EBWebView 下，CI 的 150 可能写别处），全部轮询
const PORT_FILE_CANDIDATES = [
  `${APP_DATA_DIR}\\EBWebView\\DevToolsActivePort`,
  `${APP_DATA_DIR}\\DevToolsActivePort`,
  `${process.env.TEMP}\\DevToolsActivePort`,
];

/** 断言失败时输出错误并退出（退出码 1 表示冒烟失败） */
function fail(message) {
  console.error(`[冒烟失败] ${message}`);
  process.exit(1);
}

/** 轮询等待 DevToolsActivePort 文件在任一候选路径出现（最多 60 秒） */
async function waitForPortFile() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    for (const candidate of PORT_FILE_CANDIDATES) {
      if (existsSync(candidate)) return candidate;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(
    `等待 DevToolsActivePort 文件超时，候选路径均未出现文件：\n  ${PORT_FILE_CANDIDATES.join("\n  ")}`,
  );
}

/** 通过 CDP WebSocket 执行一次 Runtime.evaluate，返回结果 JSON */
function evaluate(ws, id, expression, awaitPromise = false) {
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === id) {
        ws.removeEventListener("message", onMessage);
        resolve(msg.result);
      }
    };
    ws.addEventListener("message", onMessage);
    ws.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise, returnByValue: true },
      }),
    );
    setTimeout(() => reject(new Error(`CDP 执行超时: ${expression}`)), 30_000);
  });
}

// ── 主流程 ─────────────────────────────────────────────────────
console.log("[冒烟] 等待 WebView2 DevTools 端口...");
const portFile = await waitForPortFile();
console.log(`[冒烟] DevToolsActivePort 文件: ${portFile}`);

const [port] = (await readFile(portFile, "utf8")).trim().split("\n");
console.log(`[冒烟] DevTools 端口: ${port}`);

// 获取页面 target（应用加载 vite dev server 的页面）
let pageTarget;
try {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  pageTarget = targets.find((t) => t.type === "page");
} catch (err) {
  fail(`CDP HTTP 接口不可用: ${err.message}`);
}
if (!pageTarget) fail("未找到页面 target（前端未加载）");
console.log(`[冒烟] 页面 target: ${pageTarget.url}`);

// 连接页面 target 的 WebSocket 会话
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", () => reject(new Error("CDP WebSocket 连接失败")), { once: true });
});

// 验证 1：前端页面渲染（脚手架主标题存在）
const h1Result = await evaluate(ws, 1, `document.querySelector("h1")?.textContent ?? ""`);
if (h1Result?.result?.value !== "Welcome to Tauri + Vue") {
  fail(`前端渲染断言失败：h1 内容为 "${h1Result?.result?.value}"`);
}
console.log("[冒烟] ✓ 窗口启动并渲染前端页面");

// 验证 2：前端 → Rust 命令链路（greet 命令往返）
// 直接断言 invoke 返回值（Rust 侧拼接结果）——CDP 调用不经过 Vue 组件，
// 页面 DOM 不会更新，因此以命令返回值本身作为链路证据
const greetResult = await evaluate(
  ws,
  2,
  `(async () => {
    try {
      return await window.__TAURI_INTERNALS__.invoke("greet", { name: "CI-Smoke" });
    } catch (err) {
      return "ERR: " + err;
    }
  })()`,
  true,
);
if (greetResult?.result?.value?.includes("Hello, CI-Smoke!")) {
  console.log("[冒烟] ✓ greet 命令链路可用（前端 invoke → Rust → 前端渲染）");
} else {
  fail(`greet 链路断言失败：返回 "${greetResult?.result?.value}"`);
}

ws.close();
console.log("[冒烟] 全部通过 ✅");
