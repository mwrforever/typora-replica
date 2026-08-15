use std::sync::Mutex;

/// 应用级共享状态（02：目录监视句柄持有）
pub struct AppState {
    /// 当前监视句柄（watch_dir 持活，防 drop 停止监视；03 可扩展为多路）
    pub watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

pub mod io;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 启动失败（环境错误、重复实例等）以错误信息退出而非 panic：
    // 库代码禁止 expect（AGENTS.md §3.6），run 返回 Err 属可恢复的启动失败路径
    if let Err(e) = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState {
            watcher: Mutex::new(None),
        })
        // 命令随实现任务注册：Task 5 read_file/write_file/list_dir；
        // Task 6 save_draft/list_drafts/recover_draft；Task 7 watch_dir；Task 13 get_cli_args
        .invoke_handler(tauri::generate_handler![
            io::commands::read_file,
            io::commands::write_file,
            io::commands::list_dir
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("应用启动失败: {e}");
        std::process::exit(1);
    }
}
