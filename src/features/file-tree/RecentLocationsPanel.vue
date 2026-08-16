<!-- 最近位置面板（03 文件树，F9）
     列出打开过的文件夹；hover 出现移除（trash）/固定（Pin）按钮（AC-F9-2/3）；
     固定项置顶且不被新记录挤出（AC-F9-4）。数据源 RecentLocations 服务。 -->
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RecentLocations, type RecentLocation } from "./recent-locations";

const emit = defineEmits<{
  "open-folder": [path: string];
}>();

/** 最近位置服务（单例由父组件注入，此处默认新建） */
const service = new RecentLocations();
const items = ref<RecentLocation[]>([]);

onMounted(async () => {
  items.value = await service.list();
});

async function onTogglePin(item: RecentLocation): Promise<void> {
  await service.togglePin(item.path);
  items.value = await service.list();
}

async function onRemove(item: RecentLocation): Promise<void> {
  await service.remove(item.path);
  items.value = await service.list();
}
</script>

<template>
  <div class="recent-locations">
    <p v-if="items.length === 0" class="recent-locations__empty">暂无最近位置</p>
    <div
      v-for="item in items"
      :key="item.path"
      class="recent-locations__item"
      @click="emit('open-folder', item.path)"
    >
      <span class="recent-locations__name">{{ item.path.split(/[/\\]/).pop() }}</span>
      <span class="recent-locations__actions">
        <button title="固定" @click.stop="onTogglePin(item)">
          {{ item.pinned ? "已固定" : "Pin" }}
        </button>
        <button title="移除" @click.stop="onRemove(item)">移除</button>
      </span>
    </div>
  </div>
</template>
