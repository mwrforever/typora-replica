import { $, browser, expect } from "@wdio/globals";

/**
 * 10#1 重启补验 E2E（独立 capability，conf.user.json 前置直写由 wdio.conf 配置
 * 加载期完成——应用启动读取早于 mocha 钩子，前置必须先于应用启动落盘）：
 * conf.user.json 配置 `"Always on Top": "Ctrl+Shift+P"` → 应用重启装载 →
 * 快捷键合并数据端到端生效（TASK.md 10#1「菜单装配落地后重启补验端到端」）。
 *
 * 验证语义与深度（实事求是）：
 * - keyBinding 覆盖的端到端可达面 = conf 文件 → Rust read_advanced_settings（注释
 *   剥离解析）→ 前端 settingsStore.advanced → menuShortcutEntries 实时合并
 *   （source=custom、combo=自定义组合串）→ 原生菜单 label 渲染（"窗口置顶\tCtrl+Shift+P"）；
 * - 最后一段（原生菜单 label 渲染）为 OS 层 UI，WebDriver 不可观测——E2E 断言到
 *   菜单构建的直接数据源（menuShortcutEntries 条目）；label 合成文本由
 *   menu-tree.spec.ts（composeMenuLabel/catalogItem，Vitest 100%）与
 *   use-native-menu.spec.ts（菜单装配消费 menuShortcutEntries）覆盖；
 * - 「按 Ctrl+Shift+P 触发置顶」不成立（非缺陷而是设计边界）：菜单项一律不设原生
 *   accelerator（防 OS 层抢键，12 spec 菜单装配红线）、窗口域命令不在编辑器命令
 *   目录（bindMenuShortcut 拒绝注入防双重执行）——窗口域 keyBinding 无按键执行
 *   通路，置顶功能本身的生效面由 window-shell-new-window.e2e.ts 以 IPC 实证。
 *
 * 前置：含 Rust 变更分支先 cargo build（e2e/README.md §0）；npm run dev +
 * tauri-driver 后台运行；wdio.conf 已预置 conf.user.json 的 keyBinding 并在
 * onComplete 还原原字节。
 */
describe("10#1 重启补验：keyBinding 自定义快捷键端到端（conf.user.json → 重启装载）", () => {
  it("conf.user.json 的 Always on Top 覆盖经重启装载进菜单快捷键合并数据（source=custom）", async () => {
    await $("[data-status-bar]").waitForExist({ timeout: 15000 });
    // settingsStore.load() 在 App onMounted 启动链路 await 完成（先于菜单装配），
    // 应用可用时合并数据已就绪；waitUntil 容忍首帧调度抖动
    await browser.waitUntil(
      async () => {
        const entry = await browser.execute(async () => {
          // Vite dev 下同 URL 模块即页面运行中的同一 store 单例（B.2.4 setup store）
          const mod = (await import("/src/features/settings/settings-store.ts")) as unknown as {
            useSettingsStore: () => {
              menuShortcutEntries: Array<{
                commandId: string;
                label: string;
                combo: string;
                source: string;
              }>;
            };
          };
          return mod
            .useSettingsStore()
            .menuShortcutEntries.find((e) => e.commandId === "Always on Top");
        });
        return entry !== undefined && entry.source === "custom";
      },
      { timeout: 8000, timeoutMsg: "keyBinding 覆盖未在时限内进入快捷键合并数据" },
    );
    const entry = await browser.execute(async () => {
      const mod = (await import("/src/features/settings/settings-store.ts")) as unknown as {
        useSettingsStore: () => {
          menuShortcutEntries: Array<{
            commandId: string;
            label: string;
            combo: string;
            source: string;
          }>;
        };
      };
      return mod
        .useSettingsStore()
        .menuShortcutEntries.find((e) => e.commandId === "Always on Top");
    });
    // 自定义组合串覆盖生效（AC-C1-3 自定义优先）：目录默认无快捷键（defaultCombo
    // undefined → combo 空串），custom 值即 conf.user.json 注入
    expect(entry?.combo).toBe("Ctrl+Shift+P");
    expect(entry?.label).toBe("窗口置顶");
    expect(entry?.source).toBe("custom");
  });
});
