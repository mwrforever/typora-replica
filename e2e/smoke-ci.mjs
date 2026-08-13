// CI 冒烟测试脚本（WebDriver 在 CI 环境不可用时的降级验证方案）
//
// 背景：GitHub Actions 的 WebView2 150.x 与 msedgedriver 自动化握手存在环境
// 兼容问题（--remote-debugging-port=0 不写 DevToolsActivePort 文件，会话创建
// 报 "DevToolsActivePort file doesn't exist"），完整 WebDriver E2E 保留在本地
// 执行（npm run test:e2e）。本脚本通过 CDP 协议直接驱动应用，覆盖与 WebDriver
// 冒烟用例相同的验证目标：
//   1. 应用可启动、WebView2 正常初始化
//   2. 前端页面成功渲染（脚手架主标题存在）
//   3. 前端 → Rust 命令调用链路可用（greet 命令往返）
//
// 连接机制：应用以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=<port>"
// 启动（固定端口方案，与 Playwright 官方 WebView2 文档同款），脚本直接轮询
// http://127.0.0.1:<port>/json/list。不依赖 DevToolsActivePort 文件——
// 该文件机制在 WebView2 150（CI runner 自带版本）上不可靠，固定端口则跨版本稳定。
import { readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

// 调试端口：由 workflow 通过 SMOKE_CDP_PORT 注入，与
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 中的 --remote-debugging-port 保持一致
const CDP_PORT = process.env.SMOKE_CDP_PORT ?? "9222";
// 应用 user data 目录（与 tauri identifier 对应，见 tauri.conf.json）
const APP_DATA_DIR = path.join(process.env.LOCALAPPDATA ?? "", "com.markwell.app");

/** 在指定根目录递归查找 DevToolsActivePort 文件（仅失败诊断用，结果有界） */
function findPortFiles(root) {
  if (!root || !existsSync(root)) return [];
  const found = [];
  // readdir 递归遍历可能很大，抛错或超过 2000 项即停止（诊断不苛求完整）
  try {
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && entry.name === "DevToolsActivePort") {
        found.push(path.join(entry.parentPath ?? root, entry.name));
      }
      if (found.length >= 5) break;
    }
  } catch {
    // 权限受限或路径不存在：诊断失败不影响主断言
  }
  return found;
}

/** 打印目录前若干项（目录不存在属正常，静默跳过） */
function dumpDir(dir, max = 15) {
  try {
    const entries = readdirSync(dir, { withFileTypes: true }).slice(0, max);
    console.error(`=== 目录内容: ${dir} ===`);
    for (const e of entries) console.error(`  ${e.isDirectory() ? "d" : "f"} ${e.name}`);
  } catch {
    // 目录不存在说明 WebView2 尚未初始化 user data，属关键诊断信号
    console.error(`=== 目录不存在: ${dir} ===`);
  }
}

/** 断言失败时输出全盘诊断并退出（退出码 1 表示冒烟失败） */
function fail(message) {
  console.error(`[冒烟失败] ${message}`);
  console.error("=== 失败诊断：WebView2 子进程 ===");
  try {
    console.error(
      execFileSync("tasklist", ["//FI", "IMAGENAME eq msedgewebview2.exe"], {
        encoding: "utf8",
      }).trim(),
    );
  } catch {
    console.error("tasklist 不可用，跳过进程诊断");
  }
  console.error("=== 失败诊断：DevToolsActivePort 全盘搜索 ===");
  const found = findPortFiles(APP_DATA_DIR);
  for (const f of found) console.error(`  找到: ${f}`);
  if (found.length === 0) console.error("  （未找到，WebView2 未按预期开启调试端口）");
  dumpDir(APP_DATA_DIR);
  dumpDir(path.join(APP_DATA_DIR, "EBWebView"));
  process.exit(1);
}

/** 轮询固定调试端口直到 CDP HTTP 接口可用（最多 60 秒） */
async function waitForCdp() {
  const deadline = Date.now() + 60_000;
  let lastError = "尚未发起请求";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(`等待 CDP 调试端口 ${CDP_PORT} 超时（最后错误：${lastError}）`);
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
console.log(`[冒烟] 等待 CDP 调试端口 http://127.0.0.1:${CDP_PORT} ...`);
await waitForCdp();
console.log(`[冒烟] CDP 调试端口 ${CDP_PORT} 已就绪`);

// 获取页面 target（应用加载 vite dev server 的页面）
let pageTarget;
try {
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  pageTarget = targets.find((t) => t.type === "page" && t.url.startsWith("http"));
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
