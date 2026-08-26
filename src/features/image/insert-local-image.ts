// 插图入口（Ctrl+Shift+I；12 窗口外壳建成前的直触形态，D-3 裁决）
//
// 三路插入接线的最后一环：剪贴板文本为图片 URL → 光标处直插该 src（Typora 平价，
// 不开对话框）；否则系统文件多选对话框 → import_local_images 路径复制落盘
// （不经 IPC 传字节，D-6）→ 逐 DTO 走 buildImageSrc 策略后批量插入。
// 目标目录决策复用 upload-flow 的 pickTargetDir（fm 优先 → 全局设置 → undefined），
// 与粘贴/拖拽自动存盘链路同一口径不漂移。对话框取消零副作用。
// 全部外部依赖（剪贴板/对话框/invoke/插入器）可注入，单测零 Tauri 依赖。
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Command } from "@milkdown/kit/prose/state";
import type { ImageSettings } from "../../services/settings";
import { buildImageSrc } from "./image-src-policy";
import { pickTargetDir, type ImageDocContext } from "./upload-flow";

/** 图片 URL 直写判定：http(s) + 图片扩展名，容忍查询串（AC-P1-3 简报锁定正则） */
const IMAGE_URL_RE = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?\S*)?$/i;

/** 对话框图片扩展名白名单（与直写正则的扩展名集合一致） */
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];

/** Rust import_local_images 返回 DTO（camelCase 对齐 serde rename_all；null 为 serde None 序列化值） */
interface ImportedImageDto {
  /** 图片复制落盘后的绝对路径 */
  absolutePath: string;
  /** 相对文档目录的 src；未保存/跨盘符时 null（前端按策略降级绝对路径） */
  relativeSrc?: string | null;
}

/** 动作依赖集（全部外部能力均可注入；缺省走 Tauri/编辑器真实通道，单测注桩零 Tauri 依赖） */
export interface InsertDeps {
  /** 读剪贴板纯文本；缺省 navigator.clipboard.readText() 包 try-catch 返空串 */
  readClipboard?(): Promise<string>;
  /** 系统文件多选对话框；缺省 plugin-dialog open() 并把 string|string[]|null 归一为 string[]|null */
  showOpenDialog?(): Promise<string[] | null>;
  /** Tauri IPC；缺省 @tauri-apps/api/core invoke */
  invoke?(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
  /** 拉取文档上下文快照（已保存/docDir/frontmatter；每次动作时拉取保证多标签实时性） */
  getContext(): ImageDocContext;
  /** 拉取图片插入偏好快照 */
  getSettings(): ImageSettings;
  /**
   * 光标处插入图片节点；缺省 defaultInsertImage（replaceSelectionWith image-block）
   * @param ctx milkdown 上下文（onRun 阶段透传）
   * @param src 最终写入节点 attrs.src 的地址（已过路径策略或为剪贴板 URL 原文）
   */
  insertImage?(ctx: Ctx, src: string): void;
  /** 错误提示出口（导入失败的用户可见反馈通道；缺省由装配方注入会话通知） */
  notifyError?(message: string): void;
}

/**
 * 缺省读剪贴板：navigator.clipboard.readText()
 *
 * 权限被拒/非安全上下文/无 clipboard API 时同步抛错或异步 reject，
 * 统一 try-catch 收敛为空串——空串必不命中 URL 正则，自然落入对话框链路。
 * @returns 剪贴板纯文本；任何失败返回空串（不向上抛错）
 */
async function defaultReadClipboard(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return "";
  }
}

/**
 * 缺省系统文件多选对话框（plugin-dialog open）
 *
 * open() 返回三态 string | string[] | null：单选语义的 string 归一为单元素数组，
 * null（用户取消）原样保留；归一后调用方只需处理 string[] | null 两种形态。
 * filters 白名单与 IMAGE_URL_RE 的扩展名集合一致，防止两处清单漂移。
 * @returns 选中的绝对路径列表；用户取消返回 null
 */
async function defaultShowOpenDialog(): Promise<string[] | null> {
  const selection = await open({
    multiple: true,
    filters: [{ name: "图片", extensions: [...IMAGE_EXTENSIONS] }],
  });
  if (!selection) return null;
  return Array.isArray(selection) ? selection : [selection];
}

/**
 * 编程插入缺省实现：光标处替换插入 image-block 节点（T1 PIN-5 钉桩 API 形态）
 *
 * schema.nodes["image-block"] 为 07 定制后 schema（T9）：attrs 含 src/caption/ratio/rawTitle，
 * rawTitle 有默认空串故新插图只显式给 src/caption/ratio 三项。scrollIntoView 保证
 * 批量插入时视图跟随最后一张图。
 * @param ctx milkdown 上下文（经 editorViewCtx 取 ProseMirror 视图）
 * @param src 最终写入 attrs.src 的地址
 * @throws image-block 节点类型不在 schema 时抛错（01 schema 未注册的装配事故，须尽早暴露）
 */
function defaultInsertImage(ctx: Ctx, src: string): void {
  const view = ctx.get(editorViewCtx);
  // 节点类型在插入时解析（SchemaReady 之后；键位触发时机必然晚于 create() 完成）
  const nodeType = view.state.schema.nodes["image-block"];
  if (!nodeType) throw new Error("image-block 节点类型未注册（01 编辑核心 schema 缺失）");
  const node = nodeType.create({ src, caption: "", ratio: 1 });
  view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
}

/**
 * Ctrl+Shift+I 动作工厂：剪贴板图片 URL 直写 src → 否则系统文件多选对话框批量导入
 *
 * 执行流：读剪贴板 → 命中图片 URL 正则即直插（不开对话框，Typora 平价 AC-P1-3）→
 * 未命中弹多选对话框 → 取消/空选静默返回（零副作用）→ pickTargetDir 定目标 →
 * import_local_images 复制落盘 → 逐 DTO buildImageSrc 后批量插入（AC-P1-1）。
 * 任一环节失败经 notifyError 上浮中文提示，不向编辑器异常路径逃逸。
 *
 * 多文件拖拽链路不经本函数（Crepe 原生按 files 遍历逐一回调 onUpload，
 * 见 insert-local-image.spec.ts 钉桩用例）。
 *
 * @param deps 见接口注；生产装配由 register.ts 注入真实通道
 * @returns ProseMirror Command 工厂——执行即后台启动异步流程并恒返回消费按键的命令
 *   （对话框/IPC 为异步操作，按键处理必须同步结束，故 fire-and-forget）
 */
export function insertLocalImagesAction(deps: InsertDeps): (ctx: Ctx) => Command {
  return (ctx: Ctx) => {
    // 异步流程后台执行（对话框/IPC 均为异步，按键处理必须同步结束）
    void (async () => {
      try {
        const readClipboard = deps.readClipboard ?? defaultReadClipboard;
        const insertImage = deps.insertImage ?? defaultInsertImage;
        // 剪贴板优先：命中图片 URL 直接作为 src 插入（trim 容忍复制携带的首尾空白）
        const text = (await readClipboard()).trim();
        if (IMAGE_URL_RE.test(text)) {
          insertImage(ctx, text);
          return;
        }
        const showOpenDialog = deps.showOpenDialog ?? defaultShowOpenDialog;
        const paths = await showOpenDialog();
        // 用户取消（null）或空多选（[]）：静默返回，不产生任何 IPC 与文档变更
        if (!paths || paths.length === 0) return;
        const docContext = deps.getContext();
        const settings = deps.getSettings();
        // 目标决策与自动存盘链路同一公共函数（fm 优先 → 全局设置 → undefined=临时目录）
        const targetDir = pickTargetDir(docContext, settings);
        const invoke = deps.invoke ?? tauriInvoke;
        // docDir 仅在有磁盘基准时有值；undefined 经 serde 反序列化为 None（无相对基准）
        const dtos = (await invoke("import_local_images", {
          paths,
          targetDir,
          docDir: docContext.docDir,
        })) as ImportedImageDto[];
        for (const dto of dtos) {
          // settings.dotSlashPrefixEnabled 显式映射为 policy 层 dotPrefixEnabled 字段名
          insertImage(
            ctx,
            buildImageSrc({
              absolutePath: dto.absolutePath,
              relativeSrc: dto.relativeSrc ?? undefined,
              documentSaved: docContext.documentSaved,
              relativePathEnabled: settings.relativePathEnabled,
              dotPrefixEnabled: settings.dotSlashPrefixEnabled,
              urlEscapeEnabled: settings.urlEscapeEnabled,
            }),
          );
        }
      } catch (e) {
        // 导入失败收敛为用户可见提示（含原因摘要），不中断编辑器运行
        deps.notifyError?.(`插入本地图片失败：${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    // 返回消费按键的命令：异步流程已启动，命令恒成功（true）——Shift-Mod-i 不回落内置行为
    return () => true;
  };
}
