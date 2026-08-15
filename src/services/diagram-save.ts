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
  // 挂载到文档再触发下载并立即移除：部分引擎要求 anchor 处于文档内才接受 download 语义；
  // 挂载态下点击不会导航（download 属性已声明保存意图）
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 延迟一拍撤销 blob URL：click() 后下载由引擎异步读取，同步 revoke 在部分引擎下
  // 可能使下载拿到空文件/失败（FIX-12，WebView2/Chrome 实测同步可用，规范层面不保证）
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
