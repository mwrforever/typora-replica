// 编辑器实例管理服务
//
// 模块 01 对外暴露的实例管理接口，供 02 自动保存、05 大纲、06 搜索定位、
// 07 图片上传、10 设置快捷键、11 字数统计、12 标题栏脏状态消费。
//
// 当前为单实例形态（01 阶段单编辑器）；05/06 多实例需求由消费方基于本服务
// 扩展或替换（接口已按「文档级」而非「应用级」划分）。
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Crepe } from "@milkdown/crepe";
import { createMarkwellEditor } from "../features/editor/create-editor";
import { destroyEditorEvents, setupEditorEvents } from "./editor-events";

/** 文档级转换器挂载点（E11 Front Matter 使用） */
export interface DocumentTransformers {
  /** 打开文档时：原始内容 → 编辑器正文（剥离 Front Matter） */
  parse?: (doc: string) => string;
  /** 保存文档时：编辑器正文 → 落盘内容（回写 Front Matter） */
  serialize?: (body: string) => string;
}

class EditorManager {
  /** 当前 Crepe 实例（单例） */
  private crepe: Crepe | undefined;
  /** 当前编辑器底层实例 */
  private editor: Editor | undefined;
  /** 挂载根元素（destroy 时自行移除，@milkdown/core 的 view-clear 不负责） */
  private root: HTMLElement | undefined;
  /** 上一次销毁的异步流程（create 入口串行等待，避免 teardown 与初始化重叠） */
  private pendingDestroy: Promise<unknown> | undefined;
  /** 文档级转换器（默认透传） */
  private transformers: DocumentTransformers = {};

  /**
   * 创建编辑器实例（销毁旧实例后创建新实例）
   * @param doc 原始文档内容（可含 Front Matter，由 transformers.parse 剥离）
   */
  async create(doc: string): Promise<void> {
    this.destroy();
    // 等待旧实例异步销毁完成，避免 teardown 与本次初始化重叠（Editor.destroy 为异步流程）
    if (this.pendingDestroy) {
      await this.pendingDestroy;
      this.pendingDestroy = undefined;
    }
    const body = (this.transformers.parse ?? ((d: string) => d))(doc);
    const root = document.createElement("div");
    document.body.appendChild(root);
    this.root = root;
    this.crepe = createMarkwellEditor(root, body);
    this.editor = this.crepe.editor;
    await this.crepe.create();
    setupEditorEvents(this.crepe);
  }

  /** 销毁当前实例并解除事件绑定 */
  destroy(): void {
    if (this.crepe) {
      destroyEditorEvents();
      // Editor.destroy 为异步流程（含插件清理）：登记 promise 供下次 create 串行等待，
      // 同步清空引用维持「destroy 后即为空态」的对外契约
      this.pendingDestroy = Promise.resolve(this.crepe.destroy());
      this.crepe = undefined;
      this.editor = undefined;
    }
    // 移除挂载根元素：@milkdown/core 的 view-clear 只清理编辑器内部容器，root div 须自行移除
    this.root?.remove();
    this.root = undefined;
  }

  /** 获取 Crepe 实例（未创建返回 undefined） */
  getCrepe(): Crepe | undefined {
    return this.crepe;
  }

  /** 获取底层 Editor 实例（未创建返回 undefined） */
  getEditor(): Editor | undefined {
    return this.editor;
  }

  /** 获取当前编辑器视图（未创建返回 undefined） */
  getView() {
    return this.editor?.action((ctx) => ctx.get(editorViewCtx));
  }

  /**
   * 全量序列化当前文档（O(n)）
   * 未创建返回空串；经 transformers.serialize 回写后返回落盘内容
   */
  getMarkdown(): string {
    if (!this.crepe) return "";
    // Crepe 序列化器恒在文末追加换行；剥离全部尾随换行后再交给转换器，保证精确断言（E11 Front Matter 往返）
    const body = this.crepe.getMarkdown().replace(/\n+$/, "");
    return (this.transformers.serialize ?? ((b: string) => b))(body);
  }

  /** 切换编辑器只读状态 */
  setReadonly(value: boolean): void {
    this.crepe?.setReadonly(value);
  }

  /** 注册文档级转换器（E11 注入；传空对象还原透传） */
  setDocumentTransformers(transformers: DocumentTransformers): void {
    this.transformers = transformers;
  }
}

/** 全局单例（模块边界内唯一入口） */
export const editorManager = new EditorManager();
