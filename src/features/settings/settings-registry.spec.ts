// 设置项注册表测试（AC-S1-1 七分区 / AC-S1-2 过滤 / AC-S1-4 禁用占位 / AC-S1-5 生效时机元数据）
import { describe, expect, it } from "vitest";
import { filterSettingsItems, SETTINGS_ITEMS, SETTINGS_SECTIONS } from "./settings-registry";

describe("SETTINGS_SECTIONS 分区表", () => {
  it("AC-S1-1 七分区导航，序为 General → Save & Recover → Editor → Image → Appearance → Markdown → Export", () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual([
      "general",
      "save-recover",
      "editor",
      "image",
      "appearance",
      "markdown",
      "export",
    ]);
  });

  it("Save & Recover 是 General 内部区锚点（非独立设置作用域）", () => {
    expect(SETTINGS_SECTIONS.find((s) => s.id === "save-recover")?.anchorOf).toBe("general");
  });
});

describe("SETTINGS_ITEMS 全集注册表", () => {
  it("条目 id 全仓唯一且 section 合法", () => {
    const ids = SETTINGS_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sectionIds = new Set(SETTINGS_SECTIONS.map((s) => s.id));
    for (const item of SETTINGS_ITEMS) expect(sectionIds.has(item.section)).toBe(true);
  });

  it("禁用占位项必须带原因文案（AC-S1-4）", () => {
    for (const item of SETTINGS_ITEMS) {
      if (item.disabled) expect(item.disabledReason, item.id).toBeTruthy();
    }
    // 云上传相关两项占位在列
    expect(SETTINGS_ITEMS.find((i) => i.id === "image.uploader")?.disabled).toBe(true);
    expect(SETTINGS_ITEMS.find((i) => i.id === "image.yaml-auto-upload")?.disabled).toBe(true);
  });

  it("重启生效项在列（AC-S1-5 元数据驱动徽标）", () => {
    expect(SETTINGS_ITEMS.find((i) => i.id === "markdown.inline-math")?.effect).toBe("restart");
    expect(SETTINGS_ITEMS.find((i) => i.id === "editor.auto-pair-brackets")?.effect).toBe(
      "restart",
    );
    expect(SETTINGS_ITEMS.find((i) => i.id === "editor.default-line-ending")?.effect).toBe(
      "instant",
    );
  });
});

describe("filterSettingsItems 面板内搜索过滤（AC-S1-2）", () => {
  it("按 label 中文包含匹配", () => {
    const hits = filterSettingsItems(SETTINGS_ITEMS, "行内数学");
    expect(hits.some((i) => i.id === "markdown.inline-math")).toBe(true);
    expect(hits.some((i) => i.id === "editor.auto-pair-brackets")).toBe(false);
  });

  it("按 keywords 英文别名匹配且大小写不敏感", () => {
    const hits = filterSettingsItems(SETTINGS_ITEMS, "AUTOSAVE");
    expect(hits.some((i) => i.id === "save-recover.auto-save")).toBe(true);
  });

  it("空白查询返回全量（空态）", () => {
    expect(filterSettingsItems(SETTINGS_ITEMS, "  ")).toHaveLength(SETTINGS_ITEMS.length);
  });

  it("无命中返回空数组", () => {
    expect(filterSettingsItems(SETTINGS_ITEMS, "不存在的设置项xyz")).toHaveLength(0);
  });
});
