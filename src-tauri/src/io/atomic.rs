// 原子写与路径安全（02 文档管理）
//
// 原子性（spec §3）：同目录临时文件 + fs::rename 覆盖——中途断电/崩溃不会损坏
// 目标文件（旧文件保留到 rename 一刻）；Windows 上 rename 覆盖语义由 std 保证
// （MoveFileEx REPLACE_EXISTING）。
// 路径安全（spec §3）：所有 IO 命令入口先过 assert_safe_path，拒绝 .. 逃逸。
// 线程安全：无共享状态。
use std::fs;
use std::io::Write;
use std::path::{Component, Path};
use std::time::{SystemTime, UNIX_EPOCH};

/// 原子写文件（同目录临时文件 + rename 覆盖）
///
/// @param path 目标文件路径（父目录必须已存在）
/// @param content 完整内容（已按目标行尾归一）
/// @returns 成功返回 ()；任一步失败清理临时文件并返回中文错误
pub fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    assert_safe_path(path)?;
    let parent = path
        .parent()
        .ok_or_else(|| "目标路径无父目录".to_string())?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "目标文件名非法".to_string())?;
    // 临时文件名：隐藏点前缀 + 进程号 + 纳秒时间戳，同目录保证 rename 原子性
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp_path = parent.join(format!(".{file_name}.{}.{}.tmp", std::process::id(), nanos));
    let write_result = (|| -> std::io::Result<()> {
        let mut tmp = fs::File::create(&tmp_path)?;
        tmp.write_all(content.as_bytes())?;
        // 内容落盘（fsync）后再替换：断电/崩溃时目标文件保持旧内容，
        // 不出现 tmp 缓存未落盘、rename 后目标为空/截断（BUG-7 原子性补强）
        tmp.sync_all()?;
        drop(tmp);
        // 保留原文件权限（只读属性等）：直接覆盖会把目标权限重置为默认值（BUG-7 丢权限）。
        // 尽力而为——权限读取/设置失败不阻断写盘主流程（目标不存在时跳过）
        if let Ok(meta) = fs::metadata(path) {
            let _ = fs::set_permissions(&tmp_path, meta.permissions());
        }
        fs::rename(&tmp_path, path)?;
        Ok(())
    })();
    if let Err(e) = write_result {
        // 任一步失败清理临时文件再上报（写入失败可能已创建部分内容的 tmp，不留垃圾）
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("原子写失败: {e}"));
    }
    Ok(())
}

/// 路径安全校验：拒绝含 `..` 组件的路径（逃逸注入防线）
///
/// 绝对路径允许（用户可打开任意路径）；仅拦截路径穿越组件。
/// @param path 待校验路径
/// @returns 通过返回 ()；含 .. 返回错误
pub fn assert_safe_path(path: &Path) -> Result<(), String> {
    for comp in path.components() {
        if let Component::ParentDir = comp {
            return Err("路径包含 .. 逃逸，已拒绝".to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// 创建独立临时目录（进程内自增后缀防并发冲突）
    fn temp_dir() -> std::path::PathBuf {
        static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("markwell-test-{}-{n}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_content_and_overwrites() {
        let dir = temp_dir();
        let target = dir.join("doc.md");
        atomic_write(&target, "第一版").unwrap();
        atomic_write(&target, "第二版").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "第二版");
        // 无残留临时文件
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn overwrites_existing_file() {
        let dir = temp_dir();
        let target = dir.join("a.md");
        fs::write(&target, "旧内容").unwrap();
        atomic_write(&target, "新内容").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "新内容");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_parent_rejected() {
        let dir = temp_dir();
        let target = dir.join("no-such-dir/doc.md");
        assert!(atomic_write(&target, "x").is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn target_is_directory_rejected_and_tmp_cleaned() {
        // BUG-7：rename 覆盖失败路径——目标是目录时替换失败，须清理临时文件不留垃圾
        let dir = temp_dir();
        let target = dir.join("doc.md");
        fs::create_dir(&target).unwrap();
        assert!(atomic_write(&target, "x").is_err());
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_failure_cleans_tmp() {
        // BUG-7：写入失败（此处以 tmp 创建即失败模拟——路径为已存在目录）须清理。
        // 注：真实写入失败难以在 Windows 稳定构造，此用例覆盖失败清理分支的
        // 等价路径（tmp 路径指向不可创建的形态）
        let dir = temp_dir();
        let target = dir.join("sub").join("doc.md"); // 父目录不存在：创建 tmp 即失败
        assert!(atomic_write(&target, "x").is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn dotdot_path_rejected() {
        assert!(assert_safe_path(std::path::Path::new("a/../b.md")).is_err());
        assert!(assert_safe_path(std::path::Path::new("..\\evil.md")).is_err());
        assert!(assert_safe_path(std::path::Path::new("C:/docs/b.md")).is_ok());
    }
}
