import { $, $$, browser, expect } from "@wdio/globals";

/**
 * 应用冒烟测试（E2E）
 *
 * 验证编辑器最小闭环（spec 4 测试策略：挂载 / 输入规则 / 快捷键）：
 *   1. Tauri 窗口启动并加载前端
 *   2. Milkdown Crepe 编辑器真实挂载并渲染初始文档
 *   3. `# ` 输入规则实时生成标题（键入路径冒烟）
 *   4. Ctrl+B 快捷键加粗选中文字（键位路径冒烟）
 * 用例串行共享同一应用实例（单窗口），后两条在前两条基础上追加内容。
 */
describe("应用冒烟测试", () => {
  it("窗口正常启动并挂载 Milkdown 编辑器", async () => {
    // 等待编辑器根容器出现（Crepe 异步创建完成）
    const editor = await $(".milkdown");
    await expect(editor).toBeDisplayed();
  });

  it("初始文档渲染为标题", async () => {
    // 02 起 E2E 恒以 --reopen-file 预置 fixture 启动（wdio.conf 预置），
    // 初始文档即 fixture 内容（旧「欢迎使用 MarkWell」随 01 默认空文档方案移除）
    const heading = await $(".milkdown h1");
    await expect(heading).toHaveText("启动测试");
  });

  it("语法输入规则冒烟：输入 # 空格生成标题", async () => {
    // 点击编辑区获得焦点（点击空白处时 ProseMirror 将光标就近落至文末）
    const editor = await $(".milkdown .ProseMirror");
    await editor.click();
    // 光标移至行尾后回车另起新行，键入 `# ` 触发 Crepe 输入规则把段落转为标题
    // （wdio v9 browser.keys 会把命名键映射为 WebDriver unicode 键，如 "End"→\uE010、"Enter"→\uE007）
    await browser.keys(["End", "Enter", "#", " ", "冒烟标题"]);
    // 断言规则本体：新增 h1 出现（初始标题 + 规则生成共 2 个），且新 h1 自身含「冒烟标题」。
    // 只断言文本出现对规则回归是真空的——`# ` 不转标题时以普通段落「# 冒烟标题」落入测试仍会误绿
    const h1s = await $$(".milkdown h1");
    await expect(h1s).toBeElementsArrayOfSize(2);
    await expect(h1s[1]).toHaveText(expect.stringContaining("冒烟标题"));
  });

  it("快捷键冒烟：Ctrl+B 加粗选中文字", async () => {
    const editor = await $(".milkdown .ProseMirror");
    await editor.click();
    // 光标先移至行尾再回车另起新行，键入待加粗文本（与输入规则场景同款定位模式）
    await browser.keys(["End", "Enter", "加粗测试"]);
    // Shift+Home 从行尾向左选中整行（原生行首选择 + ProseMirror 选区同步）；
    // 不用 Ctrl+A 全选——实测会把初始标题一并加粗，首个 strong 断言会落到标题文本上
    await browser.keys(["Shift", "Home"]);
    // Ctrl+B 加粗选中文本（keymap Mod-b）
    await browser.keys(["Control", "b"]);
    const strong = await $(".milkdown strong");
    await expect(strong).toHaveText(expect.stringContaining("加粗测试"));
  });
});
