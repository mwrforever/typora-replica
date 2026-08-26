// Delete Image 右键菜单链路（07 spec P5，用户拍板：确认对话框+回收站）
//
// 结构镜像 mermaid-menu 的 DOM 菜单模式（show/close/handle 三件套）；决策链收敛于
// 纯逻辑 runDeleteFlow，菜单只是入口皮：
//   确认（多引用附计数提示）→ resolve_image_path 解析磁盘路径 →
//   ├─ 可解析：delete_to_trash 尽力而为；成功或失败都删引用（失败附 error 通知）
//   ├─ 不可解析（远程图/合成协议）：仅删引用 + info 通知（AC-P5-4）
//   └─ 解析链路本身异常：与文件删除失败同一取向——报错且必删引用
// 数据安全取向（简报锁定）：引用必删成功，文件删除失败不让文档残留死引用。
//
// ⚠️ 原始 src 一律取自 ProseMirror 文档模型而非 DOM：显示观察器（local-image-view）
// 已把本地图片的 DOM src 替换为 asset:// URL 且无 data-markwell-original-src 属性，
// DOM 只用于命中检测与菜单坐标；若把 DOM src 写回文档即 asset:// 落盘数据损坏红线。
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { readFrontMatterKey } from "../editor/frontmatter/frontmatter";
import { editorManager } from "../editor/editor-manager";
import { getActiveSession } from "../tabs/editor-registry";
import { getActiveDocContext } from "./register";
import type { ImageDocContext } from "./upload-flow";

/** image-block 节点类型名（T1 PIN 实证：schema id 即 "image-block"） */
const IMAGE_NODE_TYPE = "image-block";

/** 图片右键菜单容器类名（样式与图表菜单同款，见 src/styles/crepe-overrides.css 同址段） */
const MENU_CLASS = "markwell-image-menu";

/** 依赖注入集（测试替换 confirm/trash/文档扫描/节点删除/DOM→模型反查） */
export interface DeleteImageDeps {
  /** 文档上下文快照（docDir/root-url 解析基准；每次删除时拉取保证多标签实时性） */
  getContext(): ImageDocContext;
  /** 确认对话框（true=用户确认）；缺省 @tauri-apps/plugin-dialog ask() */
  confirm(message: string): Promise<boolean>;
  /** Tauri IPC；缺省 @tauri-apps/api/core invoke（测试注桩零 Tauri 依赖） */
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
  /** 文档内同 src 引用计数（含被右键的自身这一处；缺省=当前视图全文 descendants 扫描） */
  countReferences(src: string): number;
  /** 按 src 删除文档内图片节点（首个命中；缺省=editorManager.getView() descendants+dispatch） */
  removeNodeBySrc(src: string): boolean;
  /** 用户可见通知出口（error/info 两级；缺省沿激活会话通知通道，无会话兜底控制台） */
  notify(level: "error" | "info", message: string): void;
  /**
   * 从被右键的 img 元素反查文档模型中的原始 src
   * 返回 undefined 表示非本模块管辖（不在编辑器 DOM 内/位置边界无 image-block
   * 邻接/视图未就绪），调用方据此放行事件——绝不以 DOM src 兜底
   * （asset:// 写回文档属数据损坏红线）
   */
  resolveOriginalSrc(img: Element): string | undefined;
}

/** 错误对象 → 用户可读消息摘要（Error 取 message，其余 String 化） */
function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 执行删除决策链（菜单点击后调用；src 为文档模型中的原始 src）
 *
 * 执行流：多引用计数 → confirm（文案含回收站说明，多引用附「共被引用 N 处」提示）→
 * 取消零副作用退出 → resolve_image_path 解析磁盘路径 → 可解析则 delete_to_trash
 * 尽力而为、不可解析仅提示 info；无论上述分支结果如何，finally 兜底移除文档内引用。
 * @param src 待删图片的原始 src（ProseMirror image-block 节点 attrs.src 原值）
 * @param deps 见接口注；生产装配经 createDefaultImageDeleteDeps 注入真实通道
 */
export async function runDeleteFlow(src: string, deps: DeleteImageDeps): Promise<void> {
  // 多引用提示（增强项）：计数>1 时确认文案附引用数——文件只删一次，
  // 其余引用会变成指向已删文件的死图，须让用户知情后自行决断
  const refs = deps.countReferences(src);
  const multiNote =
    refs > 1 ? `\n\n注意：该图片在文档中共被引用 ${refs} 处，删除文件将影响全部引用。` : "";
  const ok = await deps.confirm(
    `确定删除图片「${src}」吗？\n磁盘文件将移入回收站（可恢复）。${multiNote}`,
  );
  // 用户取消：零副作用退出（AC-P5-3）——不发起 IPC、不改动文档
  if (!ok) return;
  const ctx = deps.getContext();
  // Typora 平价：root-url 作为相对路径解析基准参与 Rust 侧 fs 定位（与显示解析同一口径）
  const rootUrl = readFrontMatterKey(ctx.frontMatter ?? "", "typora-root-url");
  try {
    let fsPath: string | null;
    try {
      // markdown src → 磁盘绝对路径；null=合成协议/无法定位（AC-P5-4）
      fsPath = (await deps.invoke("resolve_image_path", {
        src,
        docDir: ctx.docDir,
        rootUrl,
      })) as string | null;
    } catch (e) {
      // 解析链路本身异常（IPC 失败等）：无法定位文件但引用照删（数据安全取向），向用户报错
      deps.notify("error", `图片路径解析失败：${messageOf(e)}（已移除文档引用）`);
      return;
    }
    if (fsPath) {
      try {
        // 回收站删除尽力而为：失败不阻断引用移除，错误信息透传原因摘要
        await deps.invoke("delete_to_trash", { path: fsPath });
      } catch (e) {
        deps.notify("error", `文件删除失败：${messageOf(e)}（已移除文档引用）`);
      }
    } else {
      // 非本地文件（远程图/合成协议）：无可删磁盘文件，仅删引用并如实告知（AC-P5-4）
      deps.notify("info", "图片非本地文件，已移除引用");
    }
  } finally {
    // 引用必删成功：任何分支都不在文档内残留指向缺失文件的死引用
    deps.removeNodeBySrc(src);
  }
}

/**
 * 引用计数生产实现：当前激活视图全文扫描统计同 src 的 image-block 节点数
 *
 * 经 01 门面 editorManager.getView() 取视图（锁定接口）；未创建实例返回 0
 * （调用链上游菜单已要求视图就绪，此处兜底防御）。
 */
function countImageReferences(src: string): number {
  const view = editorManager.getView();
  if (!view) return 0;
  let count = 0;
  view.state.doc.descendants((node) => {
    // 含被右键的自身这一处：descendants 遍历 doc 下全部节点
    if (node.type.name === IMAGE_NODE_TYPE && node.attrs.src === src) count++;
    return true;
  });
  return count;
}

/**
 * 删节点生产实现：按 src 定位首个命中的 image-block 节点整节点移除
 *
 * 单次只删一个节点（简报锁定"首个命中"语义）：文件只删一次，其余同 src 引用
 * 由用户逐一右键操作（每次都会走完整确认流）。未创建实例返回 false 如实上报。
 */
function removeImageNodeBySrc(src: string): boolean {
  const view = editorManager.getView();
  if (!view) return false;
  let done = false;
  view.state.doc.descendants((node, pos) => {
    if (done) return false;
    if (node.type.name === IMAGE_NODE_TYPE && node.attrs.src === src) {
      // 整节点删除（nodeSize 含节点开闭标记）后终止遍历
      view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
      done = true;
      return false;
    }
    return true;
  });
  return done;
}

/**
 * DOM→模型 src 反查生产实现：posAtDOM 定位后在位置边界双侧取 image-block attrs.src
 *
 * img 不在本视图 DOM 内（html 块内嵌图等外来元素）或位置边界两侧均非管辖图片时
 * 返回 undefined 放行事件；posAtDOM 对不属于当前文档树的元素会抛错，按未命中处理。
 */
function extractOriginalSrc(img: Element): string | undefined {
  const view = editorManager.getView();
  if (!view || !view.dom.contains(img)) return undefined;
  try {
    // DOM 元素 → 文档位置。ProseMirror 边界语义：image-block 是 atom 原子节点，
    // 自身不含任何内部位置，posAtDOM 落点解析（ResolvedPos.resolve）后该原子节点
    // 只会以 nodeBefore / nodeAfter 形式贴在位置边界上——祖先链 $pos.node(depth)
    // （depth≥1）必为含内容的容器节点，恒不可能是原子图片块。旧实现沿祖先链查找
    // 因此在生产装配下永不命中（顶层块解析后 depth=0，循环条件 depth>0 连节点
    // 自身都检查不到），改为边界双侧探测
    const $pos = view.state.doc.resolve(view.posAtDOM(img, 0));
    const hit = [$pos.nodeBefore, $pos.nodeAfter].find(
      (node) => node?.type.name === IMAGE_NODE_TYPE,
    );
    // src 经 schema validate:"string" 约束，此处防御 attrs 被编程写入的非字符串脏值
    return hit && typeof hit.attrs.src === "string" ? hit.attrs.src : undefined;
  } catch {
    // 元素不在文档树等边缘场景：按未命中处理，放行浏览器默认行为
  }
  return undefined;
}

/**
 * 通知生产实现：沿激活会话通知通道上浮（与上传失败同一出口口径）
 *
 * 无激活会话（极端时序）兜底控制台告警，错误不静默丢失；消息不含敏感信息。
 */
function notifyActiveSession(level: "error" | "info", message: string): void {
  const session = getActiveSession();
  if (session) session.notify({ level, message });
  else console.warn("[MarkWell]", message);
}

/** 生产依赖集单例（惰性构建：全部走 Tauri/编辑器门面真实通道；方法均为无状态转发） */
let defaultDeps: DeleteImageDeps | undefined;

/**
 * 生产依赖集访问器（首次调用构建并缓存，后续复用同一实例）
 *
 * 供 create-editor 的 contextmenu 入口缺省使用，亦暴露给测试对默认实现做替身验证；
 * 各方法内部均经活动访问器（getActiveSession/getView 等）实时取上下文，
 * 不缓存实例状态，多标签切换天然生效。
 */
export function createDefaultImageDeleteDeps(): DeleteImageDeps {
  if (defaultDeps) return defaultDeps;
  defaultDeps = {
    getContext: getActiveDocContext,
    // 原生确认对话框（warning 图标），标题固定「删除图片」
    confirm: (message) => ask(message, { title: "删除图片", kind: "warning" }),
    invoke: tauriInvoke,
    countReferences: countImageReferences,
    removeNodeBySrc: removeImageNodeBySrc,
    notify: notifyActiveSession,
    resolveOriginalSrc: extractOriginalSrc,
  };
  return defaultDeps;
}

/**
 * 在指定坐标弹出图片删除菜单（结构逐段镜像 mermaid-menu）
 * @param src 文档模型原始 src（点击删除项时传给决策链）
 * @param x 菜单横坐标（视口坐标，CSS position: fixed 定位基准）
 * @param y 菜单纵坐标（视口坐标）
 * @param deps 依赖注入集（闭包持有供删除项回调使用）
 */
function showImageMenu(src: string, x: number, y: number, deps: DeleteImageDeps): void {
  closeImageMenu();
  const menu = document.createElement("div");
  menu.className = MENU_CLASS;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const deleteItem = document.createElement("button");
  deleteItem.textContent = "删除图片";
  deleteItem.addEventListener("click", () => {
    closeImageMenu();
    // 决策链异步执行（confirm/IPC 均异步）；异常不向 DOM 事件逃逸，
    // 流程内部已把可恢复失败收敛为 notify 提示
    void runDeleteFlow(src, deps);
  });

  menu.append(deleteItem);
  document.body.appendChild(menu);
  // 点击菜单外关闭（mermaid-menu 同款一次性监听；菜单项自身点击已在回调中先行关闭）
  setTimeout(() => {
    document.addEventListener("click", closeImageMenu, { once: true });
  });
}

/** 关闭已打开的图片菜单（幂等：无菜单时 no-op） */
export function closeImageMenu(): void {
  document.querySelector(`.${MENU_CLASS}`)?.remove();
}

/**
 * 图片右键 contextmenu 入口（create-editor 的 handleDOMEvents.contextmenu 调用）
 *
 * 命中「编辑器管辖内的 img」（closest("img") 且能反查出模型原始 src）→ preventDefault
 * 弹删除菜单并返回 true 已拦截；其余一律返回 false 放行后续图表菜单/浏览器默认菜单。
 * @param event 原生 contextmenu 事件（target 为被右键元素）
 * @param deps 依赖注入集；缺省生产通道（测试注入桩替身）
 */
export function handleImageContext(
  event: MouseEvent,
  deps: DeleteImageDeps = createDefaultImageDeleteDeps(),
): boolean {
  const target = event.target as HTMLElement | null;
  const img = target?.closest("img");
  if (!img) return false;
  // 反查失败即非管辖图片（html 块内嵌图等）：不消费事件，绝不以 DOM src 兜底
  const src = deps.resolveOriginalSrc(img);
  if (!src) return false;
  event.preventDefault();
  showImageMenu(src, event.clientX, event.clientY, deps);
  return true;
}
