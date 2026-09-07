// 09 导入导出 E2E：HTML 导出产物验证 + PDF 导出冒烟
//
// 触发方式：无菜单 UI（归 12），经 browser.executeAsync 动态 import dev server
// 模块（URL 字面量 /src/features/export/xxx.ts）直调装配接口；destinationPath
// 指向固定产物路径绕开另存对话框。产物断言在 Node 侧执行。
//
// 时序设计：executeAsync 仅回传「调用已发起」——模块加载失败立即报错，导出
// promise 挂在 window 哨兵上继续异步执行，产物等待走 Node 侧轮询。原因：导出
// 管线（主题 CSS 读取 / 隐藏 WebView2 打印）时长不可控，浏览器端长等待受
// WebDriver script 超时约束；失败诊断信息经哨兵回读，避免盲红。
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { browser, expect } from "@wdio/globals";

/** 导出装配模块的 dev server URL（浏览器端动态 import 入口） */
const HTML_EXPORT_MODULE = "/src/features/export/html-export.ts";
const PDF_EXPORT_MODULE = "/src/features/export/pdf-export.ts";

/** 产物输出目录（e2e/.fixtures 已被 .gitignore 覆盖，CI/本地均可写） */
const outDir = path.join(process.cwd(), "e2e/.fixtures/export-out");
const htmlPath = path.join(outDir, "e2e-export.html");
const pdfPath = path.join(outDir, "e2e-export.pdf");

/** 产物落盘轮询上限（打印管线为异步 COM 流程，30s 覆盖冷启动） */
const ARTIFACT_POLL_ROUNDS = 60;
const ARTIFACT_POLL_INTERVAL_MS = 500;

/** 导出结果哨兵（浏览器端回写，Node 侧仅用于失败诊断） */
interface ExportSentinel {
  ok: boolean;
  error?: string;
}

/**
 * 在浏览器端触发导出（动态 import 直调装配接口，destinationPath 直落盘）
 *
 * executeAsync 只等待模块加载与调用发起：模块加载失败经 done 报错立即返回，
 * 导出 promise 的成败后续回写 window 哨兵（done 返回后仍继续执行，promise
 * 已挂 .catch 不产生未处理拒绝）。
 * @param fnName 装配模块的导出函数名（exportHtml / exportPdf，同签名）
 * @param moduleUrl dev server 模块 URL
 * @param target 产物直落盘绝对路径（绕开另存对话框）
 * @returns 触发结果：ok = 调用已成功发起；error = 模块加载/函数缺失原因
 */
async function triggerExport(
  fnName: "exportHtml" | "exportPdf",
  moduleUrl: string,
  target: string,
): Promise<ExportSentinel> {
  return browser.executeAsync(
    (fnName: string, moduleUrl: string, target: string, done: (result: ExportSentinel) => void) => {
      const sentinel = window as unknown as { __mwExportE2E?: ExportSentinel };
      sentinel.__mwExportE2E = undefined;
      import(moduleUrl)
        .then((mod) => {
          const run = (mod as unknown as Record<string, (options: unknown) => Promise<unknown>>)[
            fnName
          ];
          if (typeof run !== "function") throw new Error(`模块缺导出函数 ${fnName}`);
          run({ destinationPath: target, fileNameBase: "e2e-export" })
            .then(() => {
              sentinel.__mwExportE2E = { ok: true };
            })
            .catch((error: unknown) => {
              sentinel.__mwExportE2E = { ok: false, error: String(error) };
            });
          // 调用已发起即回传：产物等待交给 Node 侧轮询
          done({ ok: true });
        })
        .catch((error: unknown) => done({ ok: false, error: String(error) }));
    },
    fnName,
    moduleUrl,
    target,
  );
}

/** Node 侧轮询产物文件落盘（文件出现即导出管线完成） */
async function waitForArtifact(target: string): Promise<boolean> {
  for (let i = 0; i < ARTIFACT_POLL_ROUNDS; i++) {
    if (existsSync(target)) return true;
    await browser.pause(ARTIFACT_POLL_INTERVAL_MS);
  }
  return existsSync(target);
}

/** 读回浏览器端导出哨兵（仅在产物未落盘时的失败诊断通道） */
async function readSentinel(): Promise<ExportSentinel | undefined> {
  return browser.execute(
    () => (window as unknown as { __mwExportE2E?: ExportSentinel }).__mwExportE2E,
  );
}

describe("09 导入导出", () => {
  before(() => {
    // 清理上一轮残留产物：文件存在性是本轮断言证据，必须从零开始
    mkdirSync(outDir, { recursive: true });
    rmSync(htmlPath, { force: true });
    rmSync(pdfPath, { force: true });
  });

  it("HTML 导出产物含内嵌样式与标题（AC-X1-1）", async () => {
    // 等编辑器真正就绪再交互：导出管线依赖 editorManager 已 adopt 的视图，
    // 元素出现早于 create/adopt 完成（document.e2e 同款 h1 就绪锚点 + 结算余量）
    await (await $("h1")).waitForExist({ timeout: 15000 });
    // 编辑器输入保证非空文档（smoke/document 同款定位与键入惯例）
    const editor = await $(".milkdown .ProseMirror");
    await editor.click();
    await browser.keys(["End", "Enter", "导出验证段落", "Enter"]);
    // 键入落进文档后才触发导出（组合键入偶发未插入时轮询重试一次）
    await browser.waitUntil(
      async () => {
        if ((await editor.getText()).includes("导出验证段落")) return true;
        await editor.click();
        await browser.keys("导出验证段落");
        return (await editor.getText()).includes("导出验证段落");
      },
      { timeout: 10000, interval: 1000, timeoutMsg: "键入文本未进入编辑器" },
    );

    const started = await triggerExport("exportHtml", HTML_EXPORT_MODULE, htmlPath);
    expect(started?.ok).toBe(true);
    if (!(await waitForArtifact(htmlPath))) {
      throw new Error(`HTML 产物未在时限内落盘（哨兵：${JSON.stringify(await readSentinel())}）`);
    }
    // 产物内容断言：完整 HTML 文档 + 内嵌样式（AC-X1-1）+ 编辑内容落进产物
    const html = readFileSync(htmlPath, "utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<style>");
    expect(html).toContain("导出验证段落");
  });

  it("PDF 导出冒烟（AC-X2-1 产物存在且 %PDF 头）", async () => {
    const started = await triggerExport("exportPdf", PDF_EXPORT_MODULE, pdfPath);
    expect(started?.ok).toBe(true);
    if (!(await waitForArtifact(pdfPath))) {
      throw new Error(`PDF 产物未在时限内落盘（哨兵：${JSON.stringify(await readSentinel())}）`);
    }
    // PDF 头字节校验（%PDF- 魔数；二进制内容完整性由 Rust 侧单测覆盖）
    const head = readFileSync(pdfPath).subarray(0, 5).toString("latin1");
    expect(head.startsWith("%PDF-")).toBe(true);
  });
});
