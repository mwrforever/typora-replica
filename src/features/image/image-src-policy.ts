// 图片 src 路径策略纯函数层（07 spec P3）
//
// 三开关组合语义（默认全关，用户实测对齐 Typora）：
//   relative path —— 前提=文档已保存 + 相对 src 可计算（跨盘符不可算降级绝对路径）；
//   ./ prefix     —— 仅当最终采用同级相对路径时附加（子目录相对路径不加）；
//   URL 转义      —— JS escape() 等价语义（调研纠错：非 encodeURIComponent），
//                    作用于最终 src 形态（含 ./ 前缀整体）。
// 未保存文档恒绝对路径（AC-P2-4 用户实测）。纯函数零依赖，线程安全。
/** escape() 不转义白名单（MDN 规范：A-Z a-z 0-9 @ * _ + - . /） */
const ESCAPE_KEEP_RE = /^[A-Za-z0-9@*_+\-./]$/;

/**
 * JS escape() 等价转义
 *
 * 按 UTF-16 码元遍历（for 循环而非 for-of——代理对须拆成两个 %uXXXX，
 * for-of 会把 emoji 当单个码点产出错误形态）；码元 <256 走 %XX（Latin-1），
 * ≥256 走 %uXXXX；十六进制大写。
 * @param url 原始 src
 */
export function escapeImageUrl(url: string): string {
  let out = "";
  for (let i = 0; i < url.length; i++) {
    const unit = url.charCodeAt(i);
    const ch = url[i];
    if (ESCAPE_KEEP_RE.test(ch)) {
      out += ch;
    } else if (unit < 0x100) {
      out += `%${unit.toString(16).toUpperCase().padStart(2, "0")}`;
    } else {
      out += `%u${unit.toString(16).toUpperCase().padStart(4, "0")}`;
    }
  }
  return out;
}

/** buildImageSrc 入参（见函数注） */
export interface BuildImageSrcInput {
  /** 落盘图片绝对路径（Rust SaveImageDto.absolutePath） */
  absolutePath: string;
  /** 相对 src（SaveImageDto.relativeSrc；undefined=未保存/跨盘符/无基准） */
  relativeSrc?: string;
  /** 文档是否已保存（有磁盘基准目录） */
  documentSaved: boolean;
  /** relative path 开关 */
  relativePathEnabled: boolean;
  /** ./ prefix 开关 */
  dotPrefixEnabled: boolean;
  /** URL 转义开关 */
  urlEscapeEnabled: boolean;
}

/**
 * 路径策略组合：相对前提（已保存+开关+可计算）→ ./ 前缀（仅同目录相对）→ 转义收尾
 * @param input 见接口注
 * @returns 最终写入节点 attrs.src 的字符串（不回写 frontmatter/root-url）
 */
export function buildImageSrc(input: BuildImageSrcInput): string {
  const canRelative =
    input.documentSaved &&
    input.relativePathEnabled &&
    typeof input.relativeSrc === "string" &&
    input.relativeSrc.length > 0;
  let src = canRelative ? (input.relativeSrc as string) : input.absolutePath;
  // ./ 前缀仅修饰同级相对路径：含 / 分隔符的是子目录引用或 ../ 上级引用，
  // Typora 口径均不加（与简报用例「./ 前缀不作用于子目录相对路径」对齐）
  if (input.dotPrefixEnabled && canRelative && !src.includes("/")) {
    src = `./${src}`;
  }
  return input.urlEscapeEnabled ? escapeImageUrl(src) : src;
}

/** Chromium 剪贴板合成名集合（截图粘贴 File.name 恒为 image.<ext>，须换时间戳名防互覆） */
const SYNTHETIC_NAMES = new Set([
  "image.png",
  "image.jpg",
  "image.jpeg",
  "image.gif",
  "image.webp",
]);

/**
 * 合成剪贴板名判定：命中则上传流生成 image-YYYYMMDD-HHMMSS 时间戳名，
 * Explorer 复制的真实文件名保留原名（重名才触发覆盖语义 AC-P2-3）
 * @param name File.name（可为空串）
 */
export function isSyntheticClipboardName(name: string): boolean {
  return name === "" || SYNTHETIC_NAMES.has(name.toLowerCase());
}
