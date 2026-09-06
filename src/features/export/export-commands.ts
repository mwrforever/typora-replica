// 导出菜单装配接口与命令单一入口（09 X7 装配面；模块 12 消费）
//
// 单一路径原则（12 spec §非功能）：菜单 action 与未来快捷键共用 runExport；
// 装配列表实时读取导出项 store（X7「改动实时作用于 File → Export 菜单」）。
// 选项消费：runExport 合并 store 的 HTML/PDF 选项为缺省值——设置面板（归 10）
// 与导出管线之间的唯一汇合点。
// 真实菜单渲染归模块 12（12 spec 消费「导出服务（09）」——PR 披露清单已记）。
import { exportOverwriteWithPrevious, exportWithPrevious } from "./export-previous";
import { useExportStore } from "./export-store";
import { exportHtml, exportPlainHtml } from "./html-export";
import { exportPdf } from "./pdf-export";
import type { ExportHtmlOptions, ExportResult, PdfExportOptions } from "./export-types";

/** 导出菜单装配条目（12 菜单渲染消费；run 为命令函数绑定） */
export interface ExportMenuEntry {
  /** 条目 id（内置格式 id / 两重复导出固定 id / 自定义项 id） */
  id: string;
  /** 菜单显示名 */
  label: string;
  /** 是否可用（占位禁用项 false） */
  enabled: boolean;
  /** 命令执行（异步；失败上抛由调用方呈现） */
  run: () => Promise<ExportResult | undefined>;
}

/**
 * 构建当前 Export 菜单装配列表（每次调用实时重算）
 * @returns 条目序 = store 项序 + 末尾两重复导出项（分隔线语义归 12 渲染）
 */
export function getExportMenuEntries(): ExportMenuEntry[] {
  const store = useExportStore();
  const formatEntries: ExportMenuEntry[] = store.items.map((item) => ({
    id: item.id,
    label: item.label,
    enabled: item.enabled,
    run: () => runExport(item.id),
  }));
  // X6 两命令固定尾随（用户实测菜单序：…Image → 分隔线 → with Previous → overwrite）
  return [
    ...formatEntries,
    {
      id: "export-with-previous",
      label: "使用上一次设置导出",
      enabled: true,
      run: exportWithPrevious,
    },
    {
      id: "overwrite-with-previous",
      label: "导出并覆盖上一次的导出文件",
      enabled: true,
      run: exportOverwriteWithPrevious,
    },
  ];
}

/**
 * 导出命令单一入口（菜单 / 未来快捷键共用；12 装配只消费本函数）
 *
 * 选项合并：store 的 includeOutline / 页眉页脚 / h1 分页在此并入导出选项
 * （仅在非默认值时携带，保持空选项调用面干净）。
 * @param formatId 格式或固定命令 id
 * @returns 导出结果；取消 / 未知 id 返回 undefined
 * @throws ExportError 导出管线失败（调用方呈现，不静默）；HTML / HTML 无样式的
 *         落盘失败形态为 FileIoError（file-io 包装）
 */
export async function runExport(formatId: string): Promise<ExportResult | undefined> {
  const store = useExportStore();
  switch (formatId) {
    case "pdf": {
      const options: PdfExportOptions = {};
      if (store.pdfHeader !== "") options.header = store.pdfHeader;
      if (store.pdfFooter !== "") options.footer = store.pdfFooter;
      if (store.pdfPageBreakH1) options.breakH1 = true;
      return exportPdf(options);
    }
    case "html": {
      const options: ExportHtmlOptions = {};
      if (store.includeOutline) options.includeOutline = true;
      return exportHtml(options);
    }
    case "html-plain":
      return exportPlainHtml();
    case "export-with-previous":
      return exportWithPrevious();
    case "overwrite-with-previous":
      return exportOverwriteWithPrevious();
    default: {
      // 自定义项（X5 占位）：可执行命令面未来接入。
      // TODO(export-x5): 自定义命令导出（Pandoc 管线），计划于 X5 模块迭代引入
      return undefined;
    }
  }
}
