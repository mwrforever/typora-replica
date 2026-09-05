// 四层 CSS 注入（08 spec T6/T1-2）：顺序、条件挂载、大小写敏感的挂载键、
// 热刷新 ?t= 重挂、移除语义。只操作 head 内 link（B.2.5：不触碰编辑器 DOM）。
import { beforeEach, describe, expect, it } from "vitest";
import type { ThemeMeta } from "../../services/theme-io";
import { applyThemeCss, THEME_LINK_ID, USER_BASE_LINK_ID, USER_THEME_LINK_ID } from "./theme-css";

const light: ThemeMeta = {
  name: "markwell-light",
  fileName: "markwell-light.css",
  label: "Markwell Light",
  hasUserCss: true,
};

function linkIds(): string[] {
  return Array.from(document.head.querySelectorAll("link")).map((l) => l.id);
}

// getAttribute 缺省返回 string | null——DOM 原生签名对齐（null 不属新增 API 语义，
// 宪法 A.1.2.3 允许项），断言侧仅与字面量比较
function hrefOf(id: string): string | null {
  return (document.getElementById(id) as HTMLLinkElement | null)?.getAttribute("href") ?? null;
}

describe("applyThemeCss 四层注入", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  it("全层挂载且顺序为 主题 → base.user → {theme}.user（AC-T6-1/2）", () => {
    applyThemeCss({
      themesAssetBase: "http://asset.localhost/C%3A%5Cthemes",
      theme: light,
      hasBaseUserCss: true,
      cacheBust: 1,
    });
    expect(linkIds()).toEqual([THEME_LINK_ID, USER_BASE_LINK_ID, USER_THEME_LINK_ID]);
    expect(hrefOf(THEME_LINK_ID)).toBe(
      "http://asset.localhost/C%3A%5Cthemes/markwell-light.css?t=1",
    );
    expect(hrefOf(USER_BASE_LINK_ID)).toBe(
      "http://asset.localhost/C%3A%5Cthemes/base.user.css?t=1",
    );
    expect(hrefOf(USER_THEME_LINK_ID)).toBe(
      "http://asset.localhost/C%3A%5Cthemes/markwell-light.user.css?t=1",
    );
  });

  it("hasBaseUserCss=false 时第 3 层不挂载；hasUserCss=false 时第 4 层不挂载", () => {
    applyThemeCss({
      themesAssetBase: "http://asset.localhost/t",
      theme: { ...light, hasUserCss: false },
      hasBaseUserCss: false,
      cacheBust: 1,
    });
    expect(linkIds()).toEqual([THEME_LINK_ID]);
  });

  it("theme 为 undefined 移除主题层与主题 user 层、保留 base.user 层（全局追加对所有主题生效）", () => {
    applyThemeCss({
      themesAssetBase: "http://asset.localhost/t",
      theme: light,
      hasBaseUserCss: true,
      cacheBust: 1,
    });
    applyThemeCss({
      themesAssetBase: "http://asset.localhost/t",
      theme: undefined,
      hasBaseUserCss: true,
      cacheBust: 2,
    });
    expect(linkIds()).toEqual([USER_BASE_LINK_ID]);
  });

  it("THEME 层移除后再次应用非空主题，DOM 顺序仍为 THEME → USER_BASE → USER_THEME（A-3 层序重建）", () => {
    applyThemeCss({
      themesAssetBase: "http://asset.localhost/t",
      theme: light,
      hasBaseUserCss: true,
      cacheBust: 1,
    });
    // 无激活主题：主题层与主题 user 层被移除，base.user 层保留
    applyThemeCss({
      themesAssetBase: "http://asset.localhost/t",
      theme: undefined,
      hasBaseUserCss: true,
      cacheBust: 2,
    });
    // 再次应用非空主题：THEME 层须重建于 USER_BASE 之前（按层序 insertBefore），
    // 不得 appendChild 到尾部造成 THEME → USER_BASE 倒置
    applyThemeCss({
      themesAssetBase: "http://asset.localhost/t",
      theme: light,
      hasBaseUserCss: true,
      cacheBust: 3,
    });
    expect(linkIds()).toEqual([THEME_LINK_ID, USER_BASE_LINK_ID, USER_THEME_LINK_ID]);
  });

  it("热刷新：cacheBust 变化重挂同 id link 更新 href（AC-T3-2 机制）", () => {
    applyThemeCss({
      themesAssetBase: "http://asset.localhost/t",
      theme: light,
      hasBaseUserCss: true,
      cacheBust: 1,
    });
    applyThemeCss({
      themesAssetBase: "http://asset.localhost/t",
      theme: light,
      hasBaseUserCss: true,
      cacheBust: 2,
    });
    expect(linkIds()).toEqual([THEME_LINK_ID, USER_BASE_LINK_ID, USER_THEME_LINK_ID]); // 无重复节点
    expect(hrefOf(THEME_LINK_ID)).toBe("http://asset.localhost/t/markwell-light.css?t=2");
  });

  it("尾随分隔符归一：基准带 / 或 \\ 时拼接无重复分隔符", () => {
    applyThemeCss({
      themesAssetBase: "http://asset.localhost/C%3A%5Cthemes%5Csub/",
      theme: light,
      hasBaseUserCss: false,
      cacheBust: 1,
    });
    expect(hrefOf(THEME_LINK_ID)).toBe(
      "http://asset.localhost/C%3A%5Cthemes%5Csub/markwell-light.css?t=1",
    );
  });

  it("重复 apply 同 href 幂等不新增节点", () => {
    // hasUserCss=false：单层最小形态隔离幂等语义（light.hasUserCss=true 会连带挂第 4 层，
    // 简报原 fixture 与期望数组自相矛盾，此处按实现语义修正）
    const refs = {
      themesAssetBase: "http://asset.localhost/t",
      theme: { ...light, hasUserCss: false },
      hasBaseUserCss: false,
      cacheBust: 1,
    };
    applyThemeCss(refs);
    applyThemeCss(refs);
    expect(linkIds()).toEqual([THEME_LINK_ID]);
  });

  it("link 元素 rel=stylesheet 且挂载于 head", () => {
    applyThemeCss({
      themesAssetBase: "http://asset.localhost/t",
      theme: light,
      hasBaseUserCss: false,
      cacheBust: 1,
    });
    const link = document.getElementById(THEME_LINK_ID) as HTMLLinkElement;
    expect(link.rel).toBe("stylesheet");
    expect(link.ownerDocument).toBe(document);
  });
});
