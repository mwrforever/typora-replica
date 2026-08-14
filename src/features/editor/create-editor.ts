// Crepe 工厂：统一组装 featureConfigs 与 keymap 注册注入点（10 模块扩展入口）
import { Crepe, type CrepeConfig } from "@milkdown/crepe";
// mhchem 副作用导入：KaTeX 化学式扩展（E7），全应用只需一次
import "katex/contrib/mhchem";
import { registerEditorInputRules } from "./input-rules";

/** 编辑器工厂可选配置 */
export interface MarkwellEditorOptions {
  /** 图片上传回调（07 图片模块注入实现；缺省时 Crepe 自动回落 blob URL） */
  onUpload?: (file: File) => Promise<string>;
  /** 附加 Crepe 配置（keymap/插件注入点，10 设置快捷键模块使用） */
  crepeConfig?: CrepeConfig;
}

/**
 * 创建 MarkWell 编辑器实例（Crepe 7.22.1）
 * 注意：仅构造，调用方需自行 create()（@milkdown/vue 集成层会自动 create）
 * @param root 编辑器挂载根元素（由 @milkdown/vue 集成层传入）
 * @param defaultValue 初始文档内容
 * @param options 可选配置
 */
export function createMarkwellEditor(
  root: HTMLElement,
  defaultValue: string,
  options: MarkwellEditorOptions = {},
): Crepe {
  const crepe = new Crepe({
    root,
    defaultValue,
    // 默认 features 除 TopBar/AI 外全开（与 Typora 无菜单栏编辑器形态一致）
    ...options.crepeConfig,
    featureConfigs: {
      ...(options.crepeConfig?.featureConfigs ?? {}),
      ...(options.onUpload ? { [Crepe.Feature.ImageBlock]: { onUpload: options.onUpload } } : {}),
    },
  });
  // 自定义语法规则注入：config 回调在 create() 时执行，与内置规则统一编排
  crepe.editor.config((ctx) => {
    registerEditorInputRules(ctx);
  });
  return crepe;
}
