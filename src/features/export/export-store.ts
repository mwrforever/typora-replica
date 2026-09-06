// 导出项管理 store（09 X7；设置 UI 归模块 10，本 store 为数据面）
//
// 内置 4 项锁定（不可删/改名——spec X7）；自定义项会话态维护；HTML/PDF 选项
// 为导出管线的缺省值来源（runExport 合并后传入）。
// 持久化经 services/settings（loadFromSettings/persistSettings；导出项列表
// 与 X6 会话记忆不持久化——spec：列表改动实时作用于菜单，记忆仅会话级）。
import { defineStore } from "pinia";
import { ref } from "vue";
import { loadSettings, updateSettings } from "../../services/settings";
import type { ExportSettings } from "../../services/settings";

/** 导出菜单项元数据 */
export interface ExportMenuItemMeta {
  /** 项 id（内置 = 格式 id；自定义 = 自增 id） */
  id: string;
  /** 菜单显示名 */
  label: string;
  /** 内置项（锁定不可删改） */
  builtin: boolean;
  /** 是否可用（X4/X5 占位禁用） */
  enabled: boolean;
}

/** 内置导出 4 项（锁定；顺序即默认菜单序——用户实测回填） */
export const BUILTIN_EXPORT_ITEMS: ExportMenuItemMeta[] = [
  { id: "pdf", label: "PDF", builtin: true, enabled: true },
  { id: "html", label: "HTML", builtin: true, enabled: true },
  { id: "html-plain", label: "HTML (without Styles)", builtin: true, enabled: true },
  // X4 图片长图首版不做：菜单占位禁用（spec 1.2）
  { id: "image", label: "Image", builtin: true, enabled: false },
];

/** 自定义项 id 自增序号（模块级，会话内唯一） */
let customSeq = 0;

/** 导出项管理与导出选项 store（setup store 形态，state 全量 return——宪法 B.2.4） */
export const useExportStore = defineStore("export", () => {
  // —— state ——
  const items = ref<ExportMenuItemMeta[]>(BUILTIN_EXPORT_ITEMS.map((i) => ({ ...i })));
  const locationMode = ref<ExportSettings["locationMode"]>("auto");
  const customDir = ref("");
  const includeOutline = ref(false);
  const pdfHeader = ref("");
  const pdfFooter = ref("");
  const pdfPageBreakH1 = ref(false);

  /** 新增自定义导出项（追加列表尾；Export 菜单实时数据源；X5 命令面未来接入） */
  function addItem(label: string): void {
    customSeq += 1;
    items.value.push({ id: `custom-${customSeq}`, label, builtin: false, enabled: true });
  }

  /** 删除导出项（内置拒绝——AC-X7-2 锁定语义） */
  function removeItem(id: string): void {
    const target = items.value.find((i) => i.id === id);
    if (target?.builtin) throw new Error("内置导出项不可删除");
    items.value = items.value.filter((i) => i.id !== id);
  }

  /** 改名（内置拒绝） */
  function renameItem(id: string, label: string): void {
    const target = items.value.find((i) => i.id === id);
    if (target?.builtin) throw new Error("内置导出项不可改名");
    if (target) target.label = label;
  }

  /** 改序（目标位置越界收敛到合法区间；全部项含内置可排位） */
  function moveItem(id: string, toIndex: number): void {
    const from = items.value.findIndex((i) => i.id === id);
    if (from === -1) return;
    const clamped = Math.max(0, Math.min(items.value.length - 1, toIndex));
    const [moved] = items.value.splice(from, 1);
    items.value.splice(clamped, 0, moved!);
  }

  /** 从持久化设置装载导出选项（App 装配调用一次；设置页变更路径亦可调用） */
  async function loadFromSettings(): Promise<void> {
    const settings = await loadSettings();
    locationMode.value = settings.export.locationMode;
    customDir.value = settings.export.customDir;
    includeOutline.value = settings.export.includeOutline;
    pdfHeader.value = settings.export.pdfHeader;
    pdfFooter.value = settings.export.pdfFooter;
    pdfPageBreakH1.value = settings.export.pdfPageBreakH1;
  }

  /** 把当前选项持久化（设置页保存路径调用；X6 会话记忆与导出项列表不持久化） */
  async function persistSettings(): Promise<void> {
    await updateSettings({
      export: {
        locationMode: locationMode.value,
        customDir: customDir.value,
        includeOutline: includeOutline.value,
        pdfHeader: pdfHeader.value,
        pdfFooter: pdfFooter.value,
        pdfPageBreakH1: pdfPageBreakH1.value,
      },
    });
  }

  return {
    items,
    locationMode,
    customDir,
    includeOutline,
    pdfHeader,
    pdfFooter,
    pdfPageBreakH1,
    addItem,
    removeItem,
    renameItem,
    moveItem,
    loadFromSettings,
    persistSettings,
  };
});
