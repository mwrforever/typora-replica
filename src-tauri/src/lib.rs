#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 启动失败（环境错误、重复实例等）以错误信息退出而非 panic：
    // 库代码禁止 expect（AGENTS.md §3.6），run 返回 Err 属可恢复的启动失败路径
    if let Err(e) = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
    {
        eprintln!("应用启动失败: {e}");
        std::process::exit(1);
    }
}
