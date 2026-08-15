// 图片上传回调注册表（E15 接口）
//
// 07 图片粘贴存盘模块通过 setUploadHandler 注入「Tauri 写盘 + 相对路径」实现；
// 未注入时 Crepe builder 自动回落 blob URL（URL.createObjectURL，已核实构建产物）。
let uploadHandler: ((file: File) => Promise<string>) | undefined;

/**
 * 注入图片上传处理（07 模块调用；传 undefined 还原为 blob URL 占位）
 * @param handler 上传处理函数，入参为待上传的图片文件，返回落库/落盘的 src
 */
export function setUploadHandler(handler: ((file: File) => Promise<string>) | undefined): void {
  uploadHandler = handler;
}

/** 获取当前上传处理（create-editor.ts 组装 onUpload 时调用） */
export function getUploadHandler(): ((file: File) => Promise<string>) | undefined {
  return uploadHandler;
}
