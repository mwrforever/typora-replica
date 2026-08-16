import { $, browser, expect } from "@wdio/globals";
import { writeFileSync } from "node:fs";
import path from "node:path";

/**
 * 文件树 E2E（03 模块，spec §4 测试策略）
 *
 * 前置：wdio.conf 以 --reopen-file=e2e/.fixtures/opening.md 启动，
 * 侧栏目录 = fixture 父目录（e2e/.fixtures，F1-2 父目录加载）。
 * 覆盖：新建→重命名→删除→外部变更自动刷新（回收站恢复由 trash crate 保证，
 * E2E 断言删除后树中消失；回收站 GUI 操作不可自动化，人工验证）。
 */
describe("文件树 E2E", () => {
  it("侧栏文件树显示 fixture 目录内容", async () => {
    const tree = await $(".file-tree");
    await expect(tree).toBeDisplayed();
    const item = await tree.$(".file-tree-item--file");
    await expect(item).toHaveText(expect.stringContaining("opening.md"));
  });

  it("右键新建文件：内联输入回车创建并出现在树中", async () => {
    const tree = await $(".file-tree");
    // 空白处右键 → 新建文件（内联输入由 FileTreeMenu 渲染）
    await tree.click({ button: "right" });
    const menu = await $(".file-tree-menu");
    await expect(menu).toBeDisplayed();
    await menu.$('[data-menu="new-file"]').click();
    const input = await menu.$(".file-tree-menu__inline input");
    await input.setValue("e2e-new.md");
    await browser.keys("Enter");
    // 防抖窗口后树自动刷新（新建动作自身触发 refresh）
    await browser.pause(500);
    await expect(tree).toHaveText(expect.stringContaining("e2e-new.md"));
  });

  it("右键 Duplicate：生成 {原名} copy.md", async () => {
    const tree = await $(".file-tree");
    // 选择器值不加引号：wdio v9 的 CSS→XPath 转换会把引号并入 contains 查询串导致恒不命中
    const target = await tree.$(".file-tree-item--file*=opening.md");
    await target.click({ button: "right" });
    const menu = await $(".file-tree-menu");
    await menu.$('[data-menu="duplicate"]').click();
    await browser.pause(500);
    await expect(tree).toHaveText(expect.stringContaining("opening copy.md"));
  });

  it("右键删除：文件从树中消失（trash 回收站）", async () => {
    const tree = await $(".file-tree");
    const target = await tree.$(".file-tree-item--file*=e2e-new.md");
    await target.click({ button: "right" });
    const menu = await $(".file-tree-menu");
    await menu.$('[data-menu="delete"]').click();
    await browser.pause(500);
    await expect(tree).not.toHaveText(expect.stringContaining("e2e-new.md"));
  });

  it("外部写入文件：自动刷新出现在树中（AC-F5-1）", async () => {
    const fixture = path.join(process.cwd(), "e2e/.fixtures", "external-watch.md");
    writeFileSync(fixture, "# 外部新增\n", "utf8");
    await browser.pause(1200); // 300ms 防抖 + 重扫余量
    const tree = await $(".file-tree");
    await expect(tree).toHaveText(expect.stringContaining("external-watch.md"));
  });
});
