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

/// 事件合并窗口：窗口内累积事件、超时批量投递（防事件洪泛打满 IPC，BUG-14）。
/// 前端 watch 消费为 300ms 防抖重扫，100ms 窗口对其透明
const MERGE_WINDOW: std::time::Duration = std::time::Duration::from_millis(100);

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
        let event = match res {
            Ok(event) => event,
            // 单条事件错误（文件被锁/路径被删）跳过不终止监视；记录错误供排查——
            // 修复前静默吞掉，监视死亡无感知（BUG-13）
            Err(err) => {
                eprintln!("[MarkWell] 目录监视事件错误: {err}");
                return;
            }
        };
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

/// 事件合并循环：窗口内累积事件，超时或 mpsc 断开（监视被替换）时批量投递，
/// 断开前 flush 残余事件后退出（纯函数，供单测与命令层复用）
///
/// @param rx 事件接收端（watch 回调投递；断开即退出）
/// @param send 批量投递回调（如 tauri Channel）
fn flush_loop(rx: std::sync::mpsc::Receiver<WatchEvent>, send: impl Fn(Vec<WatchEvent>)) {
    let mut pending: Vec<WatchEvent> = Vec::new();
    loop {
        match rx.recv_timeout(MERGE_WINDOW) {
            Ok(ev) => pending.push(ev),
            // 窗口到点：批量投递累积事件（空则继续等待）
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if !pending.is_empty() {
                    send(std::mem::take(&mut pending));
                }
            }
            // 发送端断开（watcher 被替换/销毁）：投递残余后退出线程
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                if !pending.is_empty() {
                    send(std::mem::take(&mut pending));
                }
                break;
            }
        }
    }
}

/// 命令：目录监视（Channel 批量事件流，句柄入 AppState 持活）
///
/// @param path 监视根目录
/// @param channel 前端 Channel（事件按 100ms 合并窗口批量投递；再次调用替换旧监视）
#[tauri::command]
pub fn watch_dir(
    app: tauri::AppHandle,
    path: String,
    channel: tauri::ipc::Channel<Vec<WatchEvent>>,
) -> Result<(), String> {
    // 事件先经 mpsc 汇集，后台线程按合并窗口批量投递——逐事件 channel.send 在
    // 事件洪泛（node_modules 安装/git checkout）时每事件一次 IPC、无背压（BUG-14）
    let (tx, rx) = std::sync::mpsc::channel::<WatchEvent>();
    let watcher = watch_dir_inner(std::path::Path::new(&path), move |ev| {
        // 合并器已断开（监视被替换、线程退出）后忽略
        let _ = tx.send(ev);
    })?;
    std::thread::spawn(move || {
        flush_loop(rx, move |batch| {
            // Channel 发送失败（前端已销毁）忽略：监视继续直到被替换
            let _ = channel.send(batch);
        });
    });
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

    #[test]
    fn flush_loop_batches_events_and_flushes_on_disconnect() {
        // BUG-14：合并循环须把窗口内事件聚合成批次投递（防逐事件 IPC 洪泛），
        // 且发送端断开时 flush 残余事件
        let (tx, rx) = mpsc::channel::<WatchEvent>();
        let batches: std::sync::Mutex<Vec<Vec<WatchEvent>>> = std::sync::Mutex::new(Vec::new());
        let batches_ref = std::sync::Arc::new(batches);
        let batches_arc = batches_ref.clone();
        let thread = std::thread::spawn(move || {
            flush_loop(rx, move |batch| {
                batches_arc.lock().unwrap().push(batch);
            });
        });
        let ev = |kind: &str, path: &str| WatchEvent {
            kind: kind.to_string(),
            path: path.to_string(),
        };
        tx.send(ev("create", "C:/d/a.md")).unwrap();
        tx.send(ev("modify", "C:/d/b.md")).unwrap();
        // 断开（监视被替换）：残余事件 flush 后线程退出
        drop(tx);
        thread.join().unwrap();
        let all: Vec<Vec<WatchEvent>> = batches_ref.lock().unwrap().clone();
        assert_eq!(all.len(), 1, "窗口内事件应合并为单批次投递");
        assert_eq!(all[0].len(), 2);
        assert_eq!(all[0][0].path, "C:/d/a.md");
        assert_eq!(all[0][1].path, "C:/d/b.md");
    }

    #[test]
    fn flush_loop_empty_disconnect_exits_without_send() {
        let (tx, rx) = mpsc::channel::<WatchEvent>();
        drop(tx); // 立即断开：无事件时线程须直接退出、不产生空批次投递
        let sends = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let sends_arc = sends.clone();
        std::thread::spawn(move || {
            flush_loop(rx, move |_| {
                sends_arc.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            });
        })
        .join()
        .unwrap();
        assert_eq!(sends.load(std::sync::atomic::Ordering::SeqCst), 0);
    }
}
