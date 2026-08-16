// launch-behavior：启动行为决策单元测试（F14 全过 + F1-3 异常路径，100% 覆盖）
import { describe, expect, it } from "vitest";
import { resolveLaunch } from "./launch-behavior";
import type { AppSettings } from "./settings";

/** 构造测试设置（默认 restore-folder） */
function makeSettings(over: Partial<AppSettings> = {}): AppSettings {
  return {
    autoSave: { enabled: true, timerMinutes: 5 },
    defaultLineEnding: "lf",
    launch: { mode: "restore-folder", customPath: "", ...over.launch },
    ...over,
  };
}

const existsAll = async () => true;
const existsNone = async () => false;

describe("启动行为决策（F14）", () => {
  it("restore-folder 模式恢复上次文件夹（AC-F14-1）", async () => {
    const s = makeSettings({
      launch: { mode: "restore-folder", customPath: "", lastFolder: "C:/docs" },
    });
    const d = await resolveLaunch({ new: false }, s, existsAll);
    expect(d).toEqual({ action: "open-folder", path: "C:/docs" });
  });

  it("restore-both 模式恢复文件夹并重开上次文件（AC-F14-2）", async () => {
    const s = makeSettings({
      launch: {
        mode: "restore-both",
        customPath: "",
        lastFolder: "C:/docs",
        lastFile: "C:/docs/a.md",
      },
    });
    const d = await resolveLaunch({ new: false }, s, existsAll);
    // restoreFolder=true：App 层需先恢复上次文件夹为侧栏目录（F14-2 语义）
    expect(d).toEqual({ action: "open-file", path: "C:/docs/a.md", restoreFolder: true });
  });

  it("--new 覆盖设置：restore-folder 也新建（AC-F14-3）", async () => {
    const s = makeSettings({
      launch: { mode: "restore-folder", customPath: "", lastFolder: "C:/docs" },
    });
    const d = await resolveLaunch({ new: true }, s, existsAll);
    expect(d.action).toBe("new");
  });

  it("恢复目标不存在回退新建并提示（AC-F14-4）", async () => {
    const s = makeSettings({
      launch: { mode: "restore-folder", customPath: "", lastFolder: "C:/gone" },
    });
    const d = await resolveLaunch({ new: false }, s, existsNone);
    expect(d.action).toBe("new");
    expect(d.notice).toContain("不存在");
  });

  it("--reopen-file 优先于设置（AC-F1-3 正常路径）", async () => {
    const s = makeSettings();
    const d = await resolveLaunch({ new: false, reopenFile: "C:/x.md" }, s, existsAll);
    expect(d).toEqual({ action: "open-file", path: "C:/x.md" });
  });

  it("--reopen-file 不携带 restoreFolder（Q 修复：不恢复文件夹、不污染最近列表）", async () => {
    // 即便设置模式为 restore-both，--reopen-file 也只打开指定文件
    const s = makeSettings({
      launch: {
        mode: "restore-both",
        customPath: "",
        lastFolder: "C:/docs",
        lastFile: "C:/docs/a.md",
      },
    });
    const d = await resolveLaunch({ new: false, reopenFile: "C:/x.md" }, s, existsAll);
    expect(d).toEqual({ action: "open-file", path: "C:/x.md" });
    expect(d.restoreFolder).toBeUndefined();
  });

  it("--reopen-file 目标不存在回退新建并提示（AC-F1-3 异常路径：提示不崩溃）", async () => {
    const s = makeSettings();
    const d = await resolveLaunch({ new: false, reopenFile: "C:/gone.md" }, s, existsNone);
    expect(d.action).toBe("new");
    expect(d.notice).toContain("不存在");
  });

  it("custom-folder 模式打开自定义文件夹（不存在回退新建）", async () => {
    const s = makeSettings({ launch: { mode: "custom-folder", customPath: "C:/custom" } });
    expect((await resolveLaunch({ new: false }, s, existsAll)).action).toBe("open-folder");
    expect((await resolveLaunch({ new: false }, s, existsNone)).action).toBe("new");
  });

  it("mode=new 直接新建", async () => {
    const s = makeSettings({ launch: { mode: "new", customPath: "" } });
    expect((await resolveLaunch({ new: false }, s, existsAll)).action).toBe("new");
  });

  it("restore-both 无 lastFile 时退化为打开文件夹", async () => {
    const s = makeSettings({
      launch: { mode: "restore-both", customPath: "", lastFolder: "C:/docs" },
    });
    const d = await resolveLaunch({ new: false }, s, existsAll);
    expect(d).toEqual({ action: "open-folder", path: "C:/docs" });
  });

  it("restore-both 恢复文件夹不存在时回退新建并提示（AC-F14-4 覆盖 restore-both）", async () => {
    const s = makeSettings({
      launch: { mode: "restore-both", customPath: "", lastFolder: "C:/gone" },
    });
    const d = await resolveLaunch({ new: false }, s, existsNone);
    expect(d.action).toBe("new");
    expect(d.notice).toContain("不存在");
  });
});
