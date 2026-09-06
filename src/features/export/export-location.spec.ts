// 导出位置解析测试（AC-X8-1/2 三模式七态 + 会话级上次目录记忆）
import { afterEach, describe, expect, it } from "vitest";
import {
  getLastExportDirForTest,
  resolveDefaultExportDir,
  resolveExportDefaultPath,
  setLastExportDir,
} from "./export-location";

afterEach(() => {
  // 会话记忆是模块级单例：每用例后清除防串扰
  setLastExportDir(undefined);
});

describe("resolveDefaultExportDir（位置三模式）", () => {
  it("auto + 有文档目录 → 文档目录", () => {
    const dir = resolveDefaultExportDir(
      { locationMode: "auto", customDir: "" },
      { documentDir: "D:/docs" },
    );
    expect(dir).toBe("D:/docs");
  });

  it("auto + 未命名文档 + 会话记忆 → 上次导出目录（AC-X8-1 auto 语义）", () => {
    setLastExportDir("D:/last-out");
    const dir = resolveDefaultExportDir(
      { locationMode: "auto", customDir: "" },
      { documentDir: undefined },
    );
    expect(dir).toBe("D:/last-out");
  });

  it("auto + 无文档目录 + 无会话记忆 → undefined（对话框用系统默认）", () => {
    const dir = resolveDefaultExportDir(
      { locationMode: "auto", customDir: "" },
      { documentDir: undefined },
    );
    expect(dir).toBeUndefined();
  });

  it("document-dir 无文档目录 → 回落会话记忆（上次导出目录）", () => {
    setLastExportDir("D:/last-out");
    const dir = resolveDefaultExportDir(
      { locationMode: "document-dir", customDir: "" },
      { documentDir: undefined },
    );
    expect(dir).toBe("D:/last-out");
  });

  it("custom 已配置 → customDir 优先于一切", () => {
    setLastExportDir("D:/last-out");
    const dir = resolveDefaultExportDir(
      { locationMode: "custom", customDir: "D:/fixed-out" },
      { documentDir: "D:/docs" },
    );
    expect(dir).toBe("D:/fixed-out");
  });

  it("custom 空串（未配置）→ 回落文档目录（不产生无处可导死态）", () => {
    const dir = resolveDefaultExportDir(
      { locationMode: "custom", customDir: "" },
      { documentDir: "D:/docs" },
    );
    expect(dir).toBe("D:/docs");
  });
});

describe("resolveExportDefaultPath（目录+文件名拼接）", () => {
  it("有目录时拼接为 完整路径（AC-X8-2）", () => {
    setLastExportDir("D:/last-out");
    const path = resolveExportDefaultPath("手册.html");
    expect(path).toBe("D:/last-out/手册.html");
  });

  it("无目录时仅返回文件名", () => {
    const path = resolveExportDefaultPath("手册.html");
    expect(path).toBe("手册.html");
  });
});

describe("会话级记忆读写面", () => {
  it("getLastExportDirForTest 读取回写值；undefined 清除", () => {
    expect(getLastExportDirForTest()).toBeUndefined();
    setLastExportDir("D:/a");
    expect(getLastExportDirForTest()).toBe("D:/a");
    setLastExportDir(undefined);
    expect(getLastExportDirForTest()).toBeUndefined();
  });

  it("显式传入的历史目录优先于会话记忆", () => {
    setLastExportDir("D:/session-last");
    const dir = resolveDefaultExportDir(
      { locationMode: "auto", customDir: "" },
      { documentDir: undefined, lastExportDir: "D:/explicit-last" },
    );
    expect(dir).toBe("D:/explicit-last");
  });
});
