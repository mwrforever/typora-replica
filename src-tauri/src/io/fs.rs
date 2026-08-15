// 目录遍历与自然序（02 文档管理，F1/F11 数据源）
//
// list_dir 递归返回目录与文件（扩展名过滤仅作用于文件）；排序为目录优先 +
// 名称自然序（数字段按数值比较，a2 < a10）。路径统一 / 分隔相对名。
// 线程安全：无共享状态；walkdir 遍历为只读。
use crate::io::atomic::assert_safe_path;
use crate::io::commands::DirEntry;
use std::cmp::Ordering;
use std::path::Path;
use walkdir::WalkDir;

/// 递归遍历目录（含子目录，目录优先 + 自然序）
///
/// @param root 遍历根目录（必须存在）
/// @param ext_filter 扩展名过滤（大小写不敏感，仅作用于文件；None 返回全部）
/// @returns 排序后的条目列表（path 为完整路径，name 为相对根路径 / 分隔）
pub fn list_dir(root: &Path, ext_filter: Option<&str>) -> Result<Vec<DirEntry>, String> {
    assert_safe_path(root)?;
    let root_abs = root
        .canonicalize()
        .map_err(|e| format!("目录不存在或不可访问: {e}"))?;
    let mut entries: Vec<DirEntry> = Vec::new();
    for entry in WalkDir::new(&root_abs).follow_links(false) {
        let entry = entry.map_err(|e| format!("遍历目录失败: {e}"))?;
        let path = entry.path();
        // 根自身不返回（调用方已有根引用）
        if path == root_abs {
            continue;
        }
        let is_dir = entry.file_type().is_dir();
        if !is_dir {
            // 扩展名过滤：不匹配的普通文件跳过（目录恒保留）
            if let Some(filter) = ext_filter {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if !ext.eq_ignore_ascii_case(filter) {
                    continue;
                }
            }
        }
        let rel = path
            .strip_prefix(&root_abs)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        entries.push(DirEntry {
            path: path.to_string_lossy().into_owned(),
            name: rel,
            is_dir,
            ext: path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_string(),
        });
    }
    entries.sort_by(compare_entries);
    Ok(entries)
}

/// 条目排序：目录优先，同级按名称自然序
fn compare_entries(a: &DirEntry, b: &DirEntry) -> Ordering {
    match (a.is_dir, b.is_dir) {
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        _ => natural_cmp(&a.name, &b.name),
    }
}

/// 自然序比较：数字段按数值比较（前导零忽略），文本段大小写不敏感字典序
///
/// @param a 比较对象
/// @param b 比较对象
/// @returns 排序关系（a2 < a10；alpha < Beta 按大小写不敏感）
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();
    let (mut i, mut j) = (0, 0);
    while i < a_chars.len() && j < b_chars.len() {
        let (ca, cb) = (a_chars[i], b_chars[j]);
        if ca.is_ascii_digit() && cb.is_ascii_digit() {
            // 数字段：先比有效位数（去前导零后的长度），再逐位比较
            let (mut k, mut l) = (i, j);
            while k < a_chars.len() && a_chars[k].is_ascii_digit() {
                k += 1;
            }
            while l < b_chars.len() && b_chars[l].is_ascii_digit() {
                l += 1;
            }
            let a_digits = &a_chars[i..k];
            let b_digits = &b_chars[j..l];
            let a_trim = a_digits.iter().take_while(|c| **c == '0').count();
            let b_trim = b_digits.iter().take_while(|c| **c == '0').count();
            let a_sig = a_digits.len() - a_trim;
            let b_sig = b_digits.len() - b_trim;
            let len_cmp = a_sig.cmp(&b_sig);
            if len_cmp != Ordering::Equal {
                return len_cmp;
            }
            let val_cmp = a_digits[a_trim..].iter().cmp(b_digits[b_trim..].iter());
            if val_cmp != Ordering::Equal {
                return val_cmp;
            }
            i = k;
            j = l;
        } else {
            // 文本段：大小写不敏感字典序（稳定排序，相等时保持原相对序）
            let text_cmp = ca.to_lowercase().cmp(cb.to_lowercase());
            if text_cmp != Ordering::Equal {
                return text_cmp;
            }
            i += 1;
            j += 1;
        }
    }
    // 一方耗尽：更短者在前
    (a_chars.len() - i).cmp(&(b_chars.len() - j))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// 创建独立临时目录（进程内自增后缀防并发冲突）
    fn temp_dir() -> std::path::PathBuf {
        static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("markwell-fs-{}-{n}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 构造标准样本树：根下 4 个 md + 1 个 txt + 1 个子目录（内含 1 个 md）
    fn sample_tree() -> std::path::PathBuf {
        let dir = temp_dir();
        fs::write(dir.join("b.md"), "").unwrap();
        fs::write(dir.join("a10.md"), "").unwrap();
        fs::write(dir.join("a2.md"), "").unwrap();
        fs::write(dir.join("a1.md"), "").unwrap();
        fs::write(dir.join("note.txt"), "").unwrap();
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("sub").join("c.md"), "").unwrap();
        dir
    }

    #[test]
    fn natural_order_files_and_dirs_first() {
        let dir = sample_tree();
        let entries = list_dir(&dir, None).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        // 目录优先，文件按自然序（a1 < a2 < a10 < b），子目录条目递归返回（sub/c.md）
        assert_eq!(
            names,
            vec!["sub", "a1.md", "a2.md", "a10.md", "b.md", "note.txt", "sub/c.md"]
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ext_filter_applies_case_insensitive() {
        let dir = sample_tree();
        let entries = list_dir(&dir, Some("md")).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        // 子目录内文件同样受过滤，name 为相对根路径（sub/c.md）
        assert_eq!(
            names,
            vec!["sub", "a1.md", "a2.md", "a10.md", "b.md", "sub/c.md"]
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_root_rejected() {
        assert!(list_dir(std::path::Path::new("Z:/no-such-dir-xyz"), None).is_err());
    }

    #[test]
    fn dotdot_root_rejected() {
        assert!(list_dir(std::path::Path::new("a/../b"), None).is_err());
    }

    #[test]
    fn natural_cmp_numeric_segments() {
        use std::cmp::Ordering;
        assert_eq!(natural_cmp("a1.md", "a2.md"), Ordering::Less);
        assert_eq!(natural_cmp("a2.md", "a10.md"), Ordering::Less);
        assert_eq!(natural_cmp("a10.md", "a2.md"), Ordering::Greater);
        assert_eq!(natural_cmp("b.md", "a1.md"), Ordering::Greater);
        assert_eq!(natural_cmp("a.md", "a.md"), Ordering::Equal);
    }

    #[test]
    fn natural_cmp_case_insensitive_text() {
        use std::cmp::Ordering;
        assert_eq!(natural_cmp("README.md", "readme.md"), Ordering::Equal);
        assert_eq!(natural_cmp("Alpha.md", "beta.md"), Ordering::Less);
    }
}
