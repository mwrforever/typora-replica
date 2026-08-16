// 文件操作纯函数（03 文件树，F4 右键菜单动作）
//
// 职责：新建文件/文件夹、重命名、复制（文件与目录）、删除到回收站。
// 删除走 trash crate（回收站，非永久删除——AC-F4-3；Windows 为 IFileOperation COM）。
// 线程安全：无共享状态；全部操作原子性由 fs 层保证（不存在即报错，不做覆盖）。
use crate::io::atomic::assert_safe_path;
use std::path::Path;

/// 新建文件（空内容；父目录须存在；已存在报错）
pub fn create_file(path: &Path) -> Result<(), String> {
    assert_safe_path(path)?;
    let parent = path.parent().ok_or_else(|| "路径缺少父目录".to_string())?;
    if !parent.is_dir() {
        return Err("父目录不存在".to_string());
    }
    std::fs::File::create_new(path)
        .map(|_| ())
        .map_err(|e| format!("新建文件失败: {e}"))
}

/// 新建文件夹（父目录须存在；已存在报错）
pub fn create_dir(path: &Path) -> Result<(), String> {
    assert_safe_path(path)?;
    let parent = path.parent().ok_or_else(|| "路径缺少父目录".to_string())?;
    if !parent.is_dir() {
        return Err("父目录不存在".to_string());
    }
    std::fs::create_dir(path).map_err(|e| format!("新建文件夹失败: {e}"))
}

/// 重命名（同目录移动；目标已存在报错）
pub fn rename_path(from: &Path, to: &Path) -> Result<(), String> {
    assert_safe_path(from)?;
    assert_safe_path(to)?;
    if to.exists() {
        return Err("目标已存在".to_string());
    }
    std::fs::rename(from, to).map_err(|e| format!("重命名失败: {e}"))
}

/// 复制（文件 fs::copy；目录 walkdir 递归复制；目标已存在报错）
pub fn duplicate_path(from: &Path, to: &Path) -> Result<(), String> {
    assert_safe_path(from)?;
    assert_safe_path(to)?;
    if to.exists() {
        return Err("目标已存在".to_string());
    }
    if from.is_dir() {
        copy_dir_recursive(from, to)
    } else {
        std::fs::copy(from, to)
            .map(|_| ())
            .map_err(|e| format!("复制失败: {e}"))
    }
}

/// 目录递归复制（walkdir 遍历 + 逐文件 copy）
fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| format!("创建目标目录失败: {e}"))?;
    for entry in walkdir::WalkDir::new(from) {
        let entry = entry.map_err(|e| format!("遍历源目录失败: {e}"))?;
        let rel = entry.path().strip_prefix(from).unwrap_or(entry.path());
        let target = to.join(rel);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&target).map_err(|e| format!("创建目录失败: {e}"))?;
        } else {
            std::fs::copy(entry.path(), &target).map_err(|e| format!("复制文件失败: {e}"))?;
        }
    }
    Ok(())
}

/// 删除到回收站（trash crate；文件与目录均支持，非永久删除）
pub fn delete_to_trash(path: &Path) -> Result<(), String> {
    assert_safe_path(path)?;
    trash::delete(path).map_err(|e| format!("删除到回收站失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// 创建独立临时目录（进程内自增后缀防并发冲突）
    fn temp_dir() -> std::path::PathBuf {
        static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("markwell-fileops-{}-{n}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn create_file_creates_empty_and_rejects_existing() {
        let dir = temp_dir();
        let p = dir.join("new.md");
        create_file(&p).unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"");
        // 已存在报错
        assert!(create_file(&p).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn create_file_missing_parent_rejected() {
        let p = std::path::Path::new("Z:/no-such-dir-xyz/new.md");
        assert!(create_file(p).is_err());
    }

    #[test]
    fn create_dir_creates_and_rejects_existing() {
        let dir = temp_dir();
        let p = dir.join("sub");
        create_dir(&p).unwrap();
        assert!(p.is_dir());
        // 已存在报错
        assert!(create_dir(&p).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn create_dir_missing_parent_rejected() {
        let p = std::path::Path::new("Z:/no-such-dir-xyz/newdir");
        assert!(create_dir(p).is_err());
    }

    #[test]
    fn create_dir_and_rename_roundtrip() {
        let dir = temp_dir();
        let src = dir.join("a.md");
        std::fs::write(&src, "x").unwrap();
        let dst = dir.join("b.md");
        rename_path(&src, &dst).unwrap();
        assert!(!src.exists() && dst.exists());
        // 目标已存在报错
        let third = dir.join("c.md");
        std::fs::write(&third, "y").unwrap();
        assert!(rename_path(&dst, &third).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicate_file_copies_content() {
        let dir = temp_dir();
        let src = dir.join("a.md");
        std::fs::write(&src, "中文内容").unwrap();
        let dst = dir.join("a copy.md");
        duplicate_path(&src, &dst).unwrap();
        assert_eq!(std::fs::read_to_string(&dst).unwrap(), "中文内容");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicate_dir_recursive() {
        let dir = temp_dir();
        let src = dir.join("sub");
        std::fs::create_dir_all(src.join("inner")).unwrap();
        std::fs::write(src.join("inner").join("x.md"), "x").unwrap();
        let dst = dir.join("sub copy");
        duplicate_path(&src, &dst).unwrap();
        assert!(dst.join("inner").join("x.md").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicate_path_existing_target_rejected() {
        let dir = temp_dir();
        let src = dir.join("a.md");
        std::fs::write(&src, "x").unwrap();
        let dst = dir.join("b.md");
        std::fs::write(&dst, "y").unwrap();
        // 目标已存在报错（复制不做覆盖）
        assert!(duplicate_path(&src, &dst).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rename_path_missing_source_rejected() {
        let dir = temp_dir();
        let src = dir.join("no-such.md");
        let dst = dir.join("b.md");
        // 源不存在：fs::rename 错误透传
        assert!(rename_path(&src, &dst).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_to_trash_moves_file_away() {
        let dir = temp_dir();
        let p = dir.join("trash-me.md");
        std::fs::write(&p, "x").unwrap();
        delete_to_trash(&p).unwrap();
        // trash crate 保证移入回收站：原路径不再存在（AC-F4-3）
        assert!(!p.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_to_trash_removes_directory() {
        let dir = temp_dir();
        let p = dir.join("trash-dir");
        std::fs::create_dir(&p).unwrap();
        delete_to_trash(&p).unwrap();
        // trash crate 保证移入回收站：原目录路径不再存在
        assert!(!p.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_to_trash_missing_path_rejected() {
        let dir = temp_dir();
        let p = dir.join("no-such.md");
        // 路径不存在：trash 内部 canonicalize 失败透传
        assert!(delete_to_trash(&p).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
