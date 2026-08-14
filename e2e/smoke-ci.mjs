// CI 冒烟测试脚本（确定性验证版）
//
// 背景：CI runner 镜像自带 WebView2 150.0.4078.105 存在微软上游回归——宿主进程
// 提权时 CDP 调试端口静默不监听（WebView2Feedback#5639），且固定版本运行库不理会
// 调试参数环境变量、注册表策略注入亦不生效（详见 git 历史与 e2e/README.md），
// CDP 直连方案在 CI 环境不可行。本地（WebView2 151、非提权）则完全正常。
//
// 本脚本改以进程/网络层证据做确定性验证，覆盖三项目标：
//   1. 应用进程启动并保持存活
//   2. WebView2 正常初始化（子进程存活 + user data 目录建立）
//   3. 前端页面真实加载（WebView2 进程与 vite dev server 建立持久连接）
// 完整 CDP E2E（编辑器挂载冒烟）保留在本地执行（npm run test:e2e）。
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

// 应用 user data 目录（与 tauri identifier 对应，见 tauri.conf.json）
const APP_DATA_DIR = path.join(process.env.LOCALAPPDATA ?? "", "com.markwell.app");
// 前端 dev server 端口（与 tauri.conf.json 的 devUrl 一致）
const VITE_PORT = "1420";

/** 断言失败时输出诊断并退出（退出码 1 表示冒烟失败） */
function fail(message) {
  console.error(`[冒烟失败] ${message}`);
  console.error("=== 失败诊断：进程列表 ===");
  try {
    console.error(
      execFileSync("tasklist", ["/FI", "IMAGENAME eq typora-replica.exe", "/FO", "LIST"], {
        encoding: "utf8",
      }).trim(),
    );
  } catch {
    // tasklist 不可用不影响诊断输出
  }
  console.error("=== 失败诊断：netstat 端口 1420 ===");
  try {
    console.error(
      execFileSync("netstat", ["-ano"], { encoding: "utf8" })
        .split(/\r?\n/)
        .filter((l) => l.includes(`:${VITE_PORT}`))
        .join("\n"),
    );
  } catch {
    // netstat 不可用不影响诊断输出
  }
  process.exit(1);
}

/**
 * 轮询直到条件满足（最多 60 秒）
 * @param {() => boolean} predicate 条件谓词
 * @param {string} description 失败提示中的等待目标描述
 */
async function waitFor(predicate, description) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(`等待超时：${description}`);
}

/**
 * 查询当前 netstat 中与 vite dev server 建立持久连接的 WebView2 进程 PID 列表
 * （页面加载后 HMR WebSocket 与 HTTP keep-alive 均表现为 ESTABLISHED 连接）
 */
function webview2PidsConnectedToVite() {
  // 构建 PID → 进程名 映射（tasklist CSV 输出）
  let pidToName = new Map();
  try {
    const rows = execFileSync("tasklist", ["/FO", "CSV", "/NH"], {
      encoding: "utf8",
    }).split(/\r?\n/);
    for (const row of rows) {
      const m = row.match(/^"([^"]+)","(\d+)"/);
      if (m) pidToName.set(m[2], m[1]);
    }
  } catch {
    return [];
  }
  // netstat 中凡与 vite 端口建立连接的 msedgewebview2.exe 进程即为前端已加载证据
  const pids = new Set();
  try {
    const lines = execFileSync("netstat", ["-ano"], { encoding: "utf8" }).split(/\r?\n/);
    for (const line of lines) {
      if (!line.includes(`:${VITE_PORT}`) || !line.includes("ESTABLISHED")) continue;
      const pid = line.trim().split(/\s+/).pop();
      if (pidToName.get(pid) === "msedgewebview2.exe") pids.add(pid);
    }
  } catch {
    // netstat 失败按无连接处理，由外层等待逻辑兜底
  }
  return [...pids];
}

// ── 主流程 ─────────────────────────────────────────────────────
console.log("[冒烟] 等待应用进程启动...");
await waitFor(
  () =>
    execFileSync("tasklist", ["/FI", "IMAGENAME eq typora-replica.exe", "/NH"], {
      encoding: "utf8",
    }).includes("typora-replica.exe"),
  "应用进程未启动（typora-replica.exe）",
);
console.log("[冒烟] ✓ 应用进程存活");

console.log("[冒烟] 等待 WebView2 初始化...");
await waitFor(
  () =>
    execFileSync("tasklist", ["/FI", "IMAGENAME eq msedgewebview2.exe", "/NH"], {
      encoding: "utf8",
    }).includes("msedgewebview2.exe") && existsSync(path.join(APP_DATA_DIR, "EBWebView")),
  "WebView2 未初始化（子进程未出现或 user data 目录未建立）",
);
console.log("[冒烟] ✓ WebView2 已初始化（子进程存活 + user data 目录建立）");

console.log("[冒烟] 等待前端页面加载（WebView2 ↔ vite 持久连接）...");
await waitFor(
  () => webview2PidsConnectedToVite().length > 0,
  `WebView2 进程未与 vite 端口 ${VITE_PORT} 建立连接（前端未加载）`,
);
console.log("[冒烟] ✓ 前端页面已由 WebView2 真实加载");

console.log("[冒烟] 全部通过 ✅");
