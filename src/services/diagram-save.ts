// 图表 SVG 另存封装（E21）
//
// 默认实现：Blob + <a download> 触发 WebView2 原生保存对话框。
// 09 导入导出 / 12 窗口外壳模块可替换为原生文件对话框实现。
/**
 * 保存 SVG 文本为文件
 * @param svg SVG 字符串
 * @param suggestedName 建议文件名（不含扩展名）
 */
export function saveSvgAsFile(svg: string, suggestedName: string): void {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${suggestedName}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}
