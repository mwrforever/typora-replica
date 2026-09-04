// onUpload 编排层（07 spec P2 粘贴自动存盘）
//
// 三路收敛（粘贴/拖拽/快捷键对话框外的字节链路）统一经本工厂注入 01 注册表：
//   目标决策序：frontmatter typora-copy-images-to（文档级优先）→ 全局设置 → 临时目录
//   （target_dir 缺省由 Rust 落 markwell-images，对齐 Typora 截图默认行为），
//   决策收敛于公共函数 pickTargetDir——Task 10 对话框链路复用同一口径；
//   文件名分流：Chromium 合成名（image.*）换 UTC 时间戳名防互覆，真实名保留
//   （重名覆盖语义交由 Rust 直接覆盖，对齐 Typora 用户实测）；
//   失败回落：notifyError 提示 + blob URL 占位（编辑器不崩溃，AC-P2-5）。
// 纯编排无 UI 依赖；invoke/createObjectUrl 可注入以便单测。
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { ImageSettings } from "../../services/settings";
import { readFrontMatterKey } from "../editor/frontmatter/frontmatter";
import { buildImageSrc, isSyntheticClipboardName } from "./image-src-policy";

/** 文档上下文快照（接线层每次上传时拉取最新值，保证多标签实时性） */
export interface ImageDocContext {
  /** 有磁盘基准（已保存/已恢复路径） */
  documentSaved: boolean;
  /** 文档所在目录绝对路径；未保存 undefined */
  docDir?: string;
  /** 当前文档 front matter 内文（无则 null） */
  frontMatter: string | null;
}

/** Rust save_image 返回 DTO（camelCase 对齐 serde rename_all；null 为 serde None 序列化值） */
interface SaveImageDto {
  /** 图片落盘后的绝对路径 */
  absolutePath: string;
  /** 相对文档目录的 src；未保存/跨盘符时 null（前端降级绝对路径 AC-P2-4） */
  relativeSrc?: string | null;
}

/** 依赖注入集（invoke/createObjectUrl 测试可替换；缺省走 Tauri 真实通道） */
export interface ImageUploadDeps {
  getContext(): ImageDocContext;
  getSettings(): ImageSettings;
  /** 错误提示出口（AC-P2-5 用户可见反馈的唯一通道；接线方接既有通知通道） */
  notifyError(message: string): void;
  /** 测试注入；缺省 Tauri invoke */
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  /** blob 回落出口；缺省 URL.createObjectURL */
  createObjectUrl?: (file: File) => string;
}

/**
 * frontmatter copy-images-to 值 → 目标目录
 *
 * 绝对值（盘符/UNC/根斜杠）原样返回；相对值拼 docDir（`/` 分隔，Rust 侧两种分隔符均可处理）；
 * 相对值无 docDir 基准时无法落地返回 undefined（调用方降级临时目录链路）。
 * @param fmValue readFrontMatterKey 结果（undefined=文档未配置）
 * @param docDir 文档目录绝对路径（相对值的拼接基准；undefined 时相对值不可落地）
 * @returns 目标目录；无有效配置返回 undefined
 */
export function resolveCopyTarget(
  fmValue: string | undefined,
  docDir?: string,
): string | undefined {
  if (!fmValue) return undefined;
  // 盘符/UNC/带斜杠根视为绝对；其余按相对拼 docDir
  const isAbsolute =
    /^[A-Za-z]:[\\/]/.test(fmValue) || fmValue.startsWith("\\\\") || fmValue.startsWith("/");
  if (isAbsolute || !docDir) return isAbsolute ? fmValue : undefined;
  return `${docDir}/${fmValue}`;
}

/**
 * 目标目录三级决策（fm 优先 → 全局设置 → undefined）
 *
 * 决策序：frontmatter typora-copy-images-to（文档级优先）→ 全局设置
 * （copyToFolderEnabled 开且 copyTargetDir 非空才生效）→ undefined（Rust 落临时目录）。
 * 公共化供 Task 10 对话框链路复用，确保与自动存盘链路同一决策口径。
 * @param ctx 文档上下文快照（接线层每次上传/打开对话框时拉取最新）
 * @param settings 图片插入偏好
 * @returns 本张图片的目标目录；无任何配置来源返回 undefined
 */
export function pickTargetDir(ctx: ImageDocContext, settings: ImageSettings): string | undefined {
  const fmTarget = resolveCopyTarget(
    readFrontMatterKey(ctx.frontMatter ?? "", "typora-copy-images-to"),
    ctx.docDir,
  );
  // 开关关或目录空串均视为未配置全局目标（空串是合法存量值=未配置，见 settings.ts）
  const globalTarget =
    settings.copyToFolderEnabled && settings.copyTargetDir ? settings.copyTargetDir : undefined;
  return fmTarget ?? globalTarget;
}

/**
 * 创建 onUpload 处理器（注入 setUploadHandler 的真实实现；01 接口 (file)=>Promise<string>）
 *
 * 执行流：拉取上下文/偏好 → pickTargetDir 定目标 → 合成名分流 → 字节转数组经
 * save_image 落盘 → buildImageSrc 组装最终 src（三开关策略见 image-src-policy）。
 * @param deps 见接口注；getSettings/getContext 每次调用时拉取（多标签实时性）
 * @returns 永不 reject 的处理器：失败 notifyError + blob 回落（AC-P2-5）
 */
export function createImageUploadHandler(deps: ImageUploadDeps): (file: File) => Promise<string> {
  const invoke = deps.invoke ?? tauriInvoke;
  const createObjectUrl = deps.createObjectUrl ?? URL.createObjectURL.bind(URL);
  return async (file: File): Promise<string> => {
    try {
      const ctx = deps.getContext();
      const settings = deps.getSettings();
      // 文档级 frontmatter 优先 → 全局开关+目录 → 临时目录（undefined）
      const targetDir = pickTargetDir(ctx, settings);
      // 合成剪贴板名换时间戳名（null 交 Rust 生成）；真实名保留触发覆盖语义
      const name = isSyntheticClipboardName(file.name) ? null : file.name;
      const bytes = new Uint8Array(await file.arrayBuffer());
      // targetDir/docDir 为 undefined → serde 反序列化为 None（临时目录/无相对基准）
      const dto = (await invoke("save_image", {
        bytes: Array.from(bytes),
        name,
        mime: file.type || "image/png",
        targetDir,
        docDir: ctx.documentSaved ? ctx.docDir : undefined,
      })) as SaveImageDto;
      // settings 的 dotSlashPrefixEnabled 映射为 policy 层的 dotPrefixEnabled 字段名
      return buildImageSrc({
        absolutePath: dto.absolutePath,
        relativeSrc: dto.relativeSrc ?? undefined,
        documentSaved: ctx.documentSaved,
        relativePathEnabled: settings.relativePathEnabled,
        dotPrefixEnabled: settings.dotSlashPrefixEnabled,
        urlEscapeEnabled: settings.urlEscapeEnabled,
      });
    } catch (e) {
      // AC-P2-5：失败不走编辑器异常路径——中文提示后以会话级 blob 占位
      // （blob 会话内可见、重启失效，与 Typora 存盘失败的降级表现同方向）
      const message = e instanceof Error ? e.message : String(e);
      deps.notifyError(`图片存盘失败：${message}`);
      return createObjectUrl(file);
    }
  };
}
