<!-- src/components/editor/EditorPage.vue -->
<script setup lang="ts">
/**
 * 编辑器宿主组件
 *
 * 负责 Crepe 与 Vue 集成的装配：MilkdownProvider + useEditor 生命周期管理，
 * 以及 MarkWell 版式容器（居中纸面）。窗口外壳（12 模块）在此基础上装配。
 */
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/vue";
import { defineComponent, onBeforeUnmount } from "vue";
import { createMarkwellEditor } from "../../features/editor/create-editor";
import { editorManager } from "../../services/editor-manager";

/** 组件属性 */
const props = withDefaults(
  defineProps<{
    /** 初始文档内容（02 文档管理接管后由外部传入） */
    initialDoc?: string;
  }>(),
  { initialDoc: "" },
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
      const crepe = createMarkwellEditor(root, props.initialDoc);
      editorManager.adopt(crepe);
      return crepe;
    });
    return () => slots.default?.();
  },
});

onBeforeUnmount(() => {
  // 组件卸载即销毁编辑器实例（12 多标签场景由该模块扩展为实例池）
  editorManager.destroy();
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
