// 本地图片显示解析观察器（07 spec §3 非功能：proxyDomURL 平价）
//
// 问题：文档内相对/绝对本地路径的 img 在 WebView 里没有宿主基准，直接渲染必然破损；
// 方案：DOM 层把本地 src 替换为 convertFileSrc 产物（asset:// 协议，配合动态授权与
// CSP 放行）。关键约束：只改 DOM、绝不写回 ProseMirror 节点 attrs——否则 getMarkdown
// 会把 asset:// 序列化进文档造成数据损坏（红线）。NodeView 因选区/事务重渲染把 src
// 复位为本地路径时，观察器按当前 src 值自愈重解析（判定条件只看 src 形态，天然无环：
// 我们产出的 asset:// URL 不会再次命中本地判定）。
import { convertFileSrc as tauriConvert, invoke as tauriInvoke } from "@tauri-apps/api/core";
import { readFrontMatterKey } from "../editor/frontmatter/frontmatter";
import type { ImageDocContext } from "./upload-flow";

/** 依赖注入集（测试替换 invoke/convertFileSrc） */
export interface LocalImageViewDeps {
  getContext(): ImageDocContext;
  /** 测试注入；缺省 Tauri invoke */
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  /** 测试注入；缺省 @tauri-apps/api/core convertFileSrc */
  convertFileSrc?: (path: string) => string;
}

/** 本地路径形态判定（合成协议一律放行不解析） */
function looksLocal(src: string): boolean {
  if (!src) return false;
  return !/^(https?:|data:|blob:|asset:)/i.test(src);
}

/**
 * 挂载观察器
 * @param root 编辑器根元素（观察其子树内的 img）
 * @param deps 见接口注
 * @returns destroy 句柄（随编辑器实例销毁调用）
 */
export function attachLocalImageView(
  root: HTMLElement,
  deps: LocalImageViewDeps,
): { destroy(): void } {
  const invoke = deps.invoke ?? tauriInvoke;
  const convert = deps.convertFileSrc ?? tauriConvert;
  // in-flight 去重：同一 src 并发事件只发一次 IPC
  const inflight = new Map<string, Promise<void>>();

  const resolveImg = (img: HTMLImageElement): void => {
    const src = img.getAttribute("src") ?? "";
    if (!looksLocal(src) || inflight.has(src)) return;
    const job = (async () => {
      try {
        const ctx = deps.getContext();
        // Typora 平价：root-url 作为相对路径解析基准参与 Rust 侧 fs 定位
        const rootUrl = readFrontMatterKey(ctx.frontMatter ?? "", "typora-root-url") ?? undefined;
        const fsPath = (await invoke("resolve_image_path", {
          src,
          docDir: ctx.docDir,
          rootUrl,
        })) as string | null;
        // 复位守卫：等待期间 src 可能又被 NodeView 改动，仅对仍为本目标的 img 生效
        if (fsPath && img.isConnected && img.getAttribute("src") === src) {
          img.src = convert(fsPath);
        }
      } catch {
        // 解析失败静默保底：保留原 src（浏览器破损图标），不打断编辑
      } finally {
        inflight.delete(src);
      }
    })();
    inflight.set(src, job);
  };

  const scanAll = (): void => {
    root.querySelectorAll<HTMLImageElement>("img[src]").forEach(resolveImg);
  };

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "attributes") {
        resolveImg(m.target as HTMLImageElement);
      } else {
        m.addedNodes.forEach((n) => {
          if (n instanceof HTMLImageElement) resolveImg(n);
          // 显式泛型：可选链/推断在此退化为 Element，需锚定 HTMLImageElement
          else if (n instanceof HTMLElement) {
            n.querySelectorAll<HTMLImageElement>("img[src]").forEach(resolveImg);
          }
        });
      }
    }
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });
  scanAll();
  return {
    destroy() {
      observer.disconnect();
      inflight.clear();
    },
  };
}
