<!-- 标签编辑器宿主（04 多标签）
     v-show 保活：切换零重建（光标/undo/滚动隔离，AC-F29-8）；
     LRU 回收 = recycledIds 中标签 v-if 卸载（实例销毁由集成层负责），
     重新激活时以 contentSnapshot 重建（AC-F29-7）。
     initialDoc 优先级（终审 I2）：contentSnapshot（回收时最新内容，恒新鲜）
     优先于 initialDocs（打开时写入、从不清理，恒陈旧）——否则回收重建读到旧内容丢编辑。 -->
<script setup lang="ts">
import EditorPage from "../../components/editor/EditorPage.vue";
import type { Crepe } from "@milkdown/crepe";
import { useTabsController } from "./tabs-controller";

const controller = useTabsController();
const { store, initialDocs, recycledIds } = controller;

/** EditorPage 实例上缴（passive 模式回调） */
function onInstanceReady(tabId: string, inst: { crepe: Crepe; frontMatter: string | null }): void {
  controller.onInstanceReady(tabId, inst);
}
</script>

<template>
  <div class="tabs-host">
    <template v-for="tab in store.tabs" :key="tab.id">
      <div v-show="tab.id === store.activeTabId" class="tabs-host__pane">
        <EditorPage
          v-if="tab.contentReady && !recycledIds.has(tab.id)"
          :initial-doc="tab.contentSnapshot ?? initialDocs.get(tab.id) ?? ''"
          :adopt="false"
          :on-instance-ready="(inst) => onInstanceReady(tab.id, inst)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.tabs-host {
  height: 100%;
  min-width: 0;
}
.tabs-host__pane {
  height: 100%;
}
</style>
