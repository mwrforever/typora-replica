// 目录监视（02 文档管理，供 03 文件树刷新）
//
// notify 8.2.0 recommended_watcher（Windows 走 ReadDirectoryChangesW），
// 递归监视 + 事件种类映射（create/remove/modify/other）。
// 线程安全：回调经 mpsc/Channel 跨线程投递；watcher 句柄须持有防 drop 停止。
use std::path::Path;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::Manager;

use crate::io::atomic::assert_safe_path;
use crate::io::commands::WatchEvent;

/// 建立递归目录监视（纯函数，事件经回调投递）
///
/// @param root 监视根目录（必须存在）
/// @param on_event 事件回调（跨线程调用，须 Send + 'static）
/// @returns 监视句柄（drop 即停止监视，调用方须持有）
pub fn watch_dir_inner<F>(root: &Path, on_event: F) -> Result<RecommendedWatcher, String>
where
    F: Fn(WatchEvent) + Send + 'static,
{
    assert_safe_path(root)?;
    let root_owned = root.to_path_buf();
    // 闭包 move 捕获后原值不可再用，clone 一份供闭包过滤路径、原值用于注册监视
    let watch_root = root_owned.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        // 单条事件错误（如文件被锁）跳过，不终止监视
        let Ok(event) = res else { return };
        let kind = match event.kind {
            EventKind::Create(_) => "create",
            EventKind::Remove(_) => "remove",
            EventKind::Modify(_) => "modify",
            // Access（句柄打开/关闭类非变更事件）与未知事件一并归入 other
            EventKind::Access(_) | EventKind::Any | EventKind::Other => "other",
        };
        for path in event.paths {
            // 仅投递根内事件（notify 可能上报根自身或外部路径，防御性过滤）
            if path.starts_with(&watch_root) {
                on_event(WatchEvent {
                    kind: kind.to_string(),
                    path: path.to_string_lossy().into_owned(),
                });
            }
        }
    })
    .map_err(|e| format!("创建目录监视失败: {e}"))?;
    watcher
        .watch(&root_owned, RecursiveMode::Recursive)
        .map_err(|e| format!("注册监视目录失败: {e}"))?;
    Ok(watcher)
}

/// 命令：目录监视（Channel 事件流，句柄入 AppState 持活）
///
/// @param path 监视根目录
/// @param channel 前端 Channel（事件持续推送；再次调用替换旧监视）
#[tauri::command]
pub fn watch_dir(
    app: tauri::AppHandle,
    path: String,
    channel: tauri::ipc::Channel<WatchEvent>,
) -> Result<(), String> {
    let watcher = watch_dir_inner(std::path::Path::new(&path), move |ev| {
        // Channel 发送失败（前端已销毁）忽略：监视继续直到被替换
        let _ = channel.send(ev);
    })?;
    // State 为临时值，须先 let 绑定再取锁，否则锁借用随临时值析构而失效（E0716）
    let state = app.state::<crate::AppState>();
    let mut guard = state
        .watcher
        .lock()
        .map_err(|_| "监视器状态锁损坏".to_string())?;
    *guard = Some(watcher);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    fn temp_dir() -> std::path::PathBuf {
        static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("markwell-watch-{}-{n}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 轮询等待指定种类事件（notify 事件异步到达，最多等 5s）
    ///
    /// Windows 上写新文件会依次产生 create 与 modify 两个事件
    /// （ReadDirectoryChangesW 的 ADDED + MODIFIED 动作），测试须跳过无关事件
    /// 只取目标 kind，否则 remove 前会先收到排队中的 modify。
    fn wait_event_kind(rx: &mpsc::Receiver<WatchEvent>, kind: &str) -> WatchEvent {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match rx.try_recv() {
                Ok(ev) if ev.kind == kind => return ev,
                // 跳过无关事件（如写文件伴随的 modify），继续等待目标事件
                Ok(_) => {}
                Err(_) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(50))
                }
                Err(_) => panic!("等待监视事件超时"),
            }
        }
    }

    #[test]
    fn create_and_remove_events_delivered() {
        let dir = temp_dir();
        let (tx, rx) = mpsc::channel();
        let watcher = watch_dir_inner(&dir, move |ev| {
            let _ = tx.send(ev);
        })
        .unwrap();
        let target = dir.join("new.md");
        fs::write(&target, "x").unwrap();
        let created = wait_event_kind(&rx, "create");
        assert_eq!(created.kind, "create");
        assert!(created.path.contains("new.md"));
        fs::remove_file(&target).unwrap();
        let removed = wait_event_kind(&rx, "remove");
        assert_eq!(removed.kind, "remove");
        // 句柄存活则监视持续；drop 后测试结束（watcher 变量保持引用防提前停止）
        drop(watcher);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_root_rejected() {
        assert!(watch_dir_inner(std::path::Path::new("Z:/no-such-dir-xyz"), |_| {}).is_err());
    }
}
