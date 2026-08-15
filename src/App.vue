<!-- App.vue
     应用根组件（01 阶段：直接挂载编辑器页；12 窗口外壳模块将替换为完整窗口装配） -->
<script setup lang="ts">
import EditorPage from "./components/editor/EditorPage.vue";
</script>

<template>
  <EditorPage initial-doc="# 欢迎使用 MarkWell" />
</template>
