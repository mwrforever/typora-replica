<!-- 大纲面板占位（03 文件树；05 模块实现 TOC 大纲）
     当前仅静态占位文案，05 接入后替换为真实大纲渲染（数据源为编辑器 TOC）。 -->
<template>
  <div class="outline-panel">
    <p class="outline-panel__placeholder">大纲面板（05 模块实现）</p>
  </div>
</template>

<style scoped>
/* 大纲面板占位样式（03 阶段朴素定位；08 主题模块按设计令牌精修） */
.outline-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.outline-panel__placeholder {
  font-size: 13px;
  color: var(--markwell-text-dim, #888);
}
</style>
