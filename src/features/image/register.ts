// 07 图片功能应用装配（唯一有权调用 setUploadHandler 的模块）
//
// 装配内容：
// ① onUpload 真实实现注入 01 注册表——上下文快照来自活动标签会话，每次上传惰性
//   拉取（多标签实时性），目标决策/合成名分流/blob 回落均收敛于 upload-flow 工厂；
// ② 图片设置快照缓存 + `markwell-settings-updated` 自定义事件失效——updateSettings
//   调用方分散，不做推送式同步；10 设置模块保存设置后 dispatch 该事件即可刷新快照
//   （登记为 10 的对接契约）；
// ③ 活动文档目录 → asset protocol 运行时授权（fire-and-forget，供 EditorPage 挂载点调用）。
//
// 本模块无 UI、不持编辑器引用；重复装配幂等：处理器覆盖注入无害，事件监听模块级仅注册一次。
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_SETTINGS, loadSettings } from "../../services/settings";
import type { ImageSettings } from "../../services/settings";
import { getActiveFrontMatter, getActiveSession } from "../tabs/editor-registry";
import { setUploadHandler } from "../editor/image-upload";
import { createImageUploadHandler } from "./upload-flow";
import type { ImageDocContext } from "./upload-flow";

/** 设置失效事件名（10 模块保存设置后 dispatch 即可刷新本模块设置快照） */
export const SETTINGS_INVALIDATED_EVENT = "markwell-settings-updated";

/** 图片设置快照（undefined=尚未加载完成，读取方回落默认值） */
let cachedImageSettings: ImageSettings | undefined;

/**
 * 预加载图片设置快照（模块装载与每次失效事件后各触发一次）
 *
 * 01 注册表的 getSettings 为同步签名，快照必须先于上传就绪；此处 fire-and-forget，
 * 加载窗口内（应用启动最初数毫秒）读取方回落默认偏好（全关语义，粘贴走临时目录
 * 链路，无功能损坏）。加载失败仅告警降级，下次失效事件重试。
 */
function preloadSettings(): void {
  if (cachedImageSettings) return;
  void loadSettings()
    .then((s) => {
      cachedImageSettings = s.image;
    })
    .catch((e: unknown) => {
      console.warn("[MarkWell] 图片设置读取失败，暂用默认值", e);
    });
}

// 快照失效订阅：模块级仅注册一次（registerImageFeature 幂等重入不叠加监听）；
// 失效即清空并立刻重拉（10 模块保存设置后的刷新路径）。typeof 守卫兼容非 DOM 环境。
if (typeof window !== "undefined") {
  window.addEventListener(SETTINGS_INVALIDATED_EVENT, () => {
    cachedImageSettings = undefined;
    preloadSettings();
  });
}

/**
 * 取图片设置快照（getSettings 注入实现，同步）
 *
 * @returns 当前快照；启动加载窗口内回落默认偏好（缺失键已由 settings 层兜底）
 */
function getSettingsSnapshot(): ImageSettings {
  return cachedImageSettings ?? DEFAULT_SETTINGS.image;
}

/**
 * 组装活动会话的文档上下文快照（上传链路与本地图片显示观察器共用同一口径）
 *
 * documentSaved 以「有文档目录」为准——未命名标签即使 restore 过路径基准，
 * 无目录仍走临时目录链路；frontMatter 取激活实例 FM 内文，供 root-url /
 * copy-images-to 解析。
 * @returns 文档上下文快照（无激活会话时三字段均为「未保存/空」语义）
 */
export function getActiveDocContext(): ImageDocContext {
  const session = getActiveSession();
  return {
    documentSaved: Boolean(session?.currentDir),
    docDir: session?.currentDir,
    frontMatter: getActiveFrontMatter(),
  };
}

/**
 * 活动文档目录的 asset 协议运行时授权（fire-and-forget）
 *
 * 编辑器挂载点每次装配后调用一次；目录随打开文件变化时由重新挂载自然触发重发。
 * 无活动会话目录直接跳过（未命名标签无可授权对象）；失败仅 console.warn 降级——
 * 授权缺失只影响本地图片显示（asset URL 被 scope 拒绝），不阻断编辑流程。
 */
export function authorizeActiveDocumentDir(): void {
  const dir = getActiveSession()?.currentDir;
  if (!dir) return;
  void invoke("allow_asset_directory", { dir }).catch((e: unknown) => {
    console.warn("[MarkWell] asset 目录授权失败", dir, e);
  });
}

/**
 * 应用装配入口（App.vue onMounted 调一次）
 *
 * 执行流：createImageUploadHandler 组装真实处理器（上下文/设置/错误通道三个依赖
 * 均指向本模块闭包）→ setUploadHandler 覆盖注入 01 注册表。重复调用幂等：
 * 后注入覆盖前注入，处理器语义不变，不产生叠加副作用。
 */
export function registerImageFeature(): void {
  setUploadHandler(
    createImageUploadHandler({
      getContext: getActiveDocContext,
      getSettings: getSettingsSnapshot,
      notifyError: (message) => {
        // 错误沿激活会话通知通道上浮（与 02 会话提示同口径）；无会话时兜底控制台
        const session = getActiveSession();
        if (session) session.notify({ level: "error", message });
        else console.warn("[MarkWell]", message);
      },
    }),
  );
}
