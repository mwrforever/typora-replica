// DevTools 开关（08 T7；View 菜单装配后续归 12 窗口外壳）
//
// 编译门控：tauri 的 open/close/is_devtools_open 方法带
// #[cfg(any(debug_assertions, feature = "devtools"))]——debug 构建默认可用，
// release 须经本 crate 的 devtools feature（映射 tauri/devtools）显式启用；
// 未启用构建下命令退化为无操作返回 false（前端快捷键不报错）。

/// 切换 DevTools 开合（AC-T7-1；Shift+F12 由前端窗口级快捷键触发本命令）
///
/// @returns 切换后状态：true=已打开，false=已关闭（或当前构建不支持 DevTools）
#[tauri::command]
pub fn toggle_devtools(window: tauri::WebviewWindow) -> Result<bool, String> {
    #[cfg(any(debug_assertions, feature = "devtools"))]
    {
        if window.is_devtools_open() {
            window.close_devtools();
            Ok(false)
        } else {
            window.open_devtools();
            Ok(true)
        }
    }
    #[cfg(not(any(debug_assertions, feature = "devtools")))]
    {
        // 未启用构建：显式消费参数避免 unused 警告；无操作返回 false
        let _ = window;
        Ok(false)
    }
}
