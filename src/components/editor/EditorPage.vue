<!-- src/components/editor/EditorPage.vue -->
<script setup lang="ts">
/**
 * 编辑器宿主组件
 *
 * 负责 Crepe 与 Vue 集成的装配：MilkdownProvider + useEditor 生命周期管理，
 * 以及 MarkWell 版式容器（居中纸面）。窗口外壳（12 模块）在此基础上装配。
 */
import type { Crepe } from "@milkdown/crepe";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/vue";
import { defineComponent, onBeforeUnmount } from "vue";
import { createMarkwellEditor } from "../../features/editor/create-editor";
import { parseFrontMatter } from "../../features/editor/frontmatter/frontmatter";
import { editorManager } from "../../features/editor/editor-manager";

/** 组件属性 */
const props = withDefaults(
  defineProps<{
    /** 初始文档内容（02 文档管理接管后由外部传入） */
    initialDoc?: string;
    /** 04 多标签：false 时挂载不 adopt 进 editorManager（被动挂载，实例经回调上缴） */
    adopt?: boolean;
    /** 被动挂载时的实例上缴回调（adopt=true 时忽略） */
    onInstanceReady?: (inst: { crepe: Crepe; frontMatter: string | null }) => void;
  }>(),
  { initialDoc: "", adopt: true, onInstanceReady: undefined },
);

/**
 * 编辑器装配子组件
 *
 * useEditor 依赖祖先链上的 MilkdownProvider 注入上下文（@milkdown/vue 官方测试同构），
 * 因此必须渲染在 Provider 内部；本组件仅承载工厂注册，DOM 结构由插槽透传。
 */
const EditorSurface = defineComponent({
  name: "EditorSurface",
  setup(_, { slots }) {
    // 通过 @milkdown/vue 的 useEditor 创建实例（集成层自动 create/destroy），
    // 同时登记到 editorManager 单例供各模块服务消费
    useEditor((root) => {
      // E11：Front Matter 剥离——FM 不进文档树（仅用正文建编辑器），
      // 内文经 adopt 登记到实例管理服务，保存时 getMarkdown 原样回写
      const { frontMatter, body } = parseFrontMatter(props.initialDoc);
      const crepe = createMarkwellEditor(root, body);
      if (props.adopt) {
        editorManager.adopt(crepe, frontMatter);
      } else {
        // 被动挂载：实例归调用方（tabs 注册表）管理，门面在激活时 adopt
        props.onInstanceReady?.({ crepe, frontMatter });
      }
      return crepe;
    });
    return () => slots.default?.();
  },
});

onBeforeUnmount(() => {
  // 被动模式不销毁门面（实例销毁由 @milkdown/vue 集成层在卸载时负责；
  // 门面可能已指向另一标签，误 destroy 会杀掉其他实例）
  if (props.adopt) editorManager.destroy();
});
</script>

<template>
  <MilkdownProvider>
    <div class="markwell-editor">
      <div class="markwell-editor__surface">
        <EditorSurface>
          <Milkdown />
        </EditorSurface>
      </div>
    </div>
  </MilkdownProvider>
</template>

<style scoped>
/* 版式：居中纸面（design-system/markwell/pages/editor.md） */
.markwell-editor {
  display: flex;
  justify-content: center;
  min-height: 100vh;
}

.markwell-editor__surface {
  width: 100%;
  max-width: var(--markwell-editor-max-width);
  padding: 48px 24px;
}
</style>
