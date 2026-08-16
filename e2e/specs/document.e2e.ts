// 02 文档管理 E2E 冒烟：打开（--reopen-file）→ 编辑 → 自动保存落盘
//
// 链路验证：启动参数打开 fixture → 编辑器显示内容 → 输入追加 → 停笔防抖
// （1s + 事件桥 500ms）后文件内容更新（自动保存写盘）。
// 重启恢复链路由前端单测覆盖（resolveLaunch/草稿心跳），E2E 重启留 12 窗口外壳。
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect } from "@wdio/globals";

/** fixture 路径（与 wdio.conf 预置一致） */
const fixturePath = path.join(process.cwd(), "e2e/.fixtures/opening.md");

describe("文档管理：打开 → 编辑 → 自动保存", () => {
  it("启动参数打开的文件渲染到编辑器", async () => {
    // 标题「启动测试」经 Crepe 渲染为 h1
    const heading = await $("h1");
    await heading.waitForExist({ timeout: 15000 });
    expect(await heading.getText()).toBe("启动测试");
  });

  it("编辑输入后自动保存写盘（停笔防抖 1s + 事件桥 500ms）", async () => {
    // 点击可编辑区获得焦点（容器 .milkdown 中心可能落在非编辑区域导致键入丢失，
    // 与 smoke 同款定位模式，实测可聚焦）
    const editor = await $(".milkdown .ProseMirror");
    await editor.click();
    // 追加段落（键盘输入触发 markdownUpdated 链路）
    await browser.keys(["End", "Enter", "自动保存验证输入", "Enter"]);
    // 等待防抖（1s）+ 事件桥（500ms）+ 写盘余量
    await browser.pause(3500);
    const content = readFileSync(fixturePath, "utf8");
    expect(content).toContain("自动保存验证输入");
  });
});
