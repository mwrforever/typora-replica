// 主题 CSS 注入服务（08 spec §5「主题 CSS 注入服务」，供 themeStore 驱动）
//
// 四层顺序（spec T6）：第 1 层 基础 = crepe-overrides.css（main.ts 静态引入，本服务
// 不管辖）；第 1.5 层 映射层 = typora-var-bridge.css（静态引入，Task 11）；
// 第 2 层 主题 = {theme}.css；第 3 层 全局追加 = base.user.css（存在才挂）；
// 第 4 层 主题追加 = {theme}.user.css（存在才挂，随主题层移除）。
// 热刷新（D-7）：cacheBust 变化 → 同 id link 换 href（?t= 穿透 WebView 缓存）。
// 红线：只操作 document.head 的 link，绝不触碰编辑器 DOM（宪法 B.2.5）。
// 命名规则（小写字母+连字符）保证 fileName URL 安全，无需 encode（D-10）。
import type { ThemeMeta } from "../../services/theme-io";

/** 主题层 link id */
export const THEME_LINK_ID = "markwell-theme-link";
/** base.user.css 层 link id */
export const USER_BASE_LINK_ID = "markwell-theme-user-base-link";
/** {theme}.user.css 层 link id */
export const USER_THEME_LINK_ID = "markwell-theme-user-link";

/** 注入入参（A.7 参数对象化） */
export interface ActiveThemeRefs {
  /** 主题目录 asset 基准 URL（convertFileSrc 产物） */
  themesAssetBase: string;
  /** 当前模式激活主题；undefined = 无激活主题（主题层与主题 user 层移除） */
  theme: Pick<ThemeMeta, "name" | "fileName" | "hasUserCss"> | undefined;
  /** base.user.css 存在（Rust 扫描大小写敏感结果） */
  hasBaseUserCss: boolean;
  /** 缓存穿透时间戳（热刷新时更新） */
  cacheBust: number;
}

/** 层序表（THEME → USER_BASE → USER_THEME）；重建缺失层时按此定位插入点（A-3） */
const LAYER_ORDER = [THEME_LINK_ID, USER_BASE_LINK_ID, USER_THEME_LINK_ID];

/**
 * 在层序正确位置创建 link（仅重建缺失层时调用，A-3）
 *
 * 规则：THEME 层若 USER_BASE 存在则插其前，否则若 USER_THEME 存在则插其前，
 * 否则 append；USER_BASE 若 USER_THEME 存在则插其前，否则 append；USER_THEME 恒 append。
 */
function createLayerLink(doc: Document, id: string): HTMLLinkElement {
  const link = doc.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  // 从层序表中本层之后的位置向前找：后继层已在 DOM 即插其前，保证层序不倒置
  for (const laterId of LAYER_ORDER.slice(LAYER_ORDER.indexOf(id) + 1)) {
    const later = doc.getElementById(laterId);
    if (later) {
      doc.head.insertBefore(link, later);
      return link;
    }
  }
  doc.head.appendChild(link);
  return link;
}

/** upsert 或移除固定 id link（href 相同则不动——幂等，重复 apply 零副作用） */
function upsertLink(doc: Document, id: string, href: string | undefined): void {
  // getElementById 返回 HTMLElement | null——DOM 原生签名对齐（null 不外泄出本函数）
  const existing = doc.getElementById(id) as HTMLLinkElement | null;
  // href 缺省（undefined）= 移除该层（宪法 A.1.2.3：新增 API「无」用 undefined）
  if (href === undefined) {
    existing?.remove();
    return;
  }
  const link = existing ?? createLayerLink(doc, id);
  // href 相同不重写——避免 WebView 因属性变更触发无谓的样式重载
  if (link.getAttribute("href") !== href) {
    link.setAttribute("href", href);
  }
}

/**
 * 按四层顺序重排主题 CSS 链
 * @param refs 见接口注
 * @param doc 注入目标文档（测试注入 jsdom；缺省当前文档）
 */
export function applyThemeCss(refs: ActiveThemeRefs, doc: Document = document): void {
  // 基准归一：剥掉尾随分隔符（asset URL 的路径段为编码形态，/ 与 \ 均可能尾随）
  const base = refs.themesAssetBase.replace(/[/\\]+$/, "");
  // 三层 href 均追加 ?t=<cacheBust>（裁决 D-7）：热刷新文件内容不变名，
  // WebView 按 URL 缓存样式——时间戳变化即视为新 URL 强制重载
  upsertLink(
    doc,
    THEME_LINK_ID,
    refs.theme ? `${base}/${refs.theme.fileName}?t=${refs.cacheBust}` : undefined,
  );
  upsertLink(
    doc,
    USER_BASE_LINK_ID,
    refs.hasBaseUserCss ? `${base}/base.user.css?t=${refs.cacheBust}` : undefined,
  );
  upsertLink(
    doc,
    USER_THEME_LINK_ID,
    refs.theme?.hasUserCss ? `${base}/${refs.theme.name}.user.css?t=${refs.cacheBust}` : undefined,
  );
}
