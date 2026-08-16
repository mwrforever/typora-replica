// 目录遍历与自然序（02 文档管理 F1/F11 数据源；03 文件树 F3/F6 数据源）
//
// list_dir 递归返回目录与文件（扩展名白名单/隐藏过滤仅作用于文件）；排序支持
// 字母/自然序/修改时间/创建时间四种键（各可升降序）+ Group by Folder 开关；
// 不传 opts 时回落 02 原语义（目录优先 + 自然序）。路径统一 / 分隔相对名。
// 线程安全：无共享状态；walkdir 遍历为只读。
use std::cmp::Ordering;
use std::path::Path;

use serde::Deserialize;
use walkdir::WalkDir;

use crate::io::atomic::assert_safe_path;
use crate::io::commands::DirEntry;

/// 受支持文本扩展名白名单（spec §3：与 C3 编码探测共用一份常量；
/// 前端 tree-utils.ts 有同值常量，修改须同步两处）
pub const SUPPORTED_TEXT_EXTENSIONS: [&str; 14] = [
    "md",
    "markdown",
    "mdown",
    "mmd",
    "text",
    "txt",
    "rmarkdown",
    "mkd",
    "mdwn",
    "mdtxt",
    "rmd",
    "qmd",
    "mdtext",
    "mdx",
];

/// 目录遍历选项（03 文件树消费；字段缺省回落旧行为）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDirOptions {
    /// 扩展名白名单（多值；None=不过滤，优先级高于命令层 ext_filter）
    pub ext_filters: Option<Vec<String>>,
    /// 隐藏条目（. 开头）过滤（目录不进入遍历剪枝）
    pub hide_hidden: bool,
    /// 排序键：alpha/natural/mtime/ctime（None 回落 natural）
    pub sort_by: Option<String>,
    /// 排序方向：asc/desc（None 回落 asc）
    pub direction: Option<String>,
    /// Group by Folder：目录优先（默认 true）
    pub group_folder_first: bool,
}

/// 缺省选项：与 02 原语义一致（目录优先 + 自然序 + 升序 + 不隐藏过滤）
impl Default for ListDirOptions {
    fn default() -> Self {
        Self {
            ext_filters: None,
            hide_hidden: false,
            sort_by: None,
            direction: None,
            group_folder_first: true,
        }
    }
}

/// 递归遍历目录（含子目录；白名单/隐藏过滤 + 四键排序 + Group by Folder）
///
/// @param root 遍历根目录（必须存在）
/// @param ext_filter 命令层单扩展名过滤（大小写不敏感，仅文件；None 不过滤）
/// @param opts 过滤/排序选项（None 回落 02 语义：目录优先 + 自然序 + 升序）
/// @returns 排序后的条目列表（path 完整路径、name 相对根路径 / 分隔、mtime/ctime epoch 毫秒）
pub fn list_dir(
    root: &Path,
    ext_filter: Option<&str>,
    opts: Option<&ListDirOptions>,
) -> Result<Vec<DirEntry>, String> {
    assert_safe_path(root)?;
    let root_abs = root
        .canonicalize()
        .map_err(|e| format!("目录不存在或不可访问: {e}"))?;
    let opts = opts.cloned().unwrap_or_default();
    let mut entries: Vec<DirEntry> = Vec::new();
    let walker = WalkDir::new(&root_abs).follow_links(false).into_iter();
    // 隐藏目录剪枝（. 开头不进入遍历），隐藏文件由条目级判断；
    // hide_hidden=false 时谓词恒真，等价不过滤（walkdir 2.5.0 起
    // filter_entry 位于 IntoIter 上，须先 into_iter）
    let hide_hidden = opts.hide_hidden;
    let walker = walker.filter_entry(move |e| {
        if !hide_hidden {
            return true;
        }
        let name = e.file_name().to_string_lossy();
        !(e.depth() > 0 && name.starts_with('.') && e.file_type().is_dir())
    });
    for entry in walker {
        let entry = entry.map_err(|e| format!("遍历目录失败: {e}"))?;
        let path = entry.path();
        // 根自身不返回（调用方已有根引用）
        if path == root_abs {
            continue;
        }
        let is_dir = entry.file_type().is_dir();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_string();
        // 隐藏文件过滤（隐藏目录已在遍历剪枝处理）
        if opts.hide_hidden {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if name.starts_with('.') {
                continue;
            }
        }
        if !is_dir {
            // 白名单优先，其次命令层单扩展名
            let matched = if let Some(filters) = &opts.ext_filters {
                filters.iter().any(|f| ext.eq_ignore_ascii_case(f))
            } else if let Some(filter) = ext_filter {
                ext.eq_ignore_ascii_case(filter)
            } else {
                true
            };
            if !matched {
                continue;
            }
        }
        let rel = path
            .strip_prefix(&root_abs)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        // 元数据（排序需要；目录与文件均填充）
        let (mtime, ctime) = entry
            .metadata()
            .ok()
            .map(|m| {
                let mt = m
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64);
                let ct = m
                    .created()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64);
                (mt, ct)
            })
            .unwrap_or((None, None));
        entries.push(DirEntry {
            path: path.to_string_lossy().into_owned(),
            name: rel,
            is_dir,
            ext,
            mtime,
            ctime,
        });
    }
    entries.sort_by(|a, b| compare_with_options(a, b, &opts));
    Ok(entries)
}

/// 带选项排序：Group by Folder 开关 + 四种排序键 + 方向
fn compare_with_options(a: &DirEntry, b: &DirEntry, opts: &ListDirOptions) -> Ordering {
    // Group by Folder（默认开）：目录恒置前；关闭时按排序键统一比较
    let dir_cmp = match (a.is_dir, b.is_dir) {
        (true, false) => Some(Ordering::Less),
        (false, true) => Some(Ordering::Greater),
        _ => None,
    };
    let order = if opts.group_folder_first {
        if let Some(c) = dir_cmp {
            return c;
        }
        key_cmp(a, b, opts)
    } else {
        key_cmp(a, b, opts)
    };
    // 方向：desc 反转
    if opts.direction.as_deref() == Some("desc") {
        order.reverse()
    } else {
        order
    }
}

/// 排序键比较（字母/自然序/修改时间/创建时间）
fn key_cmp(a: &DirEntry, b: &DirEntry, opts: &ListDirOptions) -> Ordering {
    match opts.sort_by.as_deref() {
        Some("alpha") => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        Some("mtime") => a.mtime.cmp(&b.mtime),
        Some("ctime") => a.ctime.cmp(&b.ctime),
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
        let entries = list_dir(&dir, None, None).unwrap();
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
        let entries = list_dir(&dir, Some("md"), None).unwrap();
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
        assert!(list_dir(std::path::Path::new("Z:/no-such-dir-xyz"), None, None).is_err());
    }

    #[test]
    fn dotdot_root_rejected() {
        assert!(list_dir(std::path::Path::new("a/../b"), None, None).is_err());
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

    #[test]
    fn hidden_entries_filtered_out() {
        let dir = temp_dir();
        fs::write(dir.join(".hidden.md"), "").unwrap();
        fs::write(dir.join(".gitkeep"), "").unwrap();
        fs::write(dir.join("ok.md"), "").unwrap();
        let opts = ListDirOptions {
            ext_filters: Some(vec!["md".into()]),
            hide_hidden: true,
            sort_by: None,
            direction: None,
            group_folder_first: true,
        };
        let entries = list_dir(&dir, None, Some(&opts)).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "ok.md");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sort_by_alpha_desc_mixed_without_group() {
        let dir = temp_dir();
        fs::write(dir.join("b.md"), "").unwrap();
        fs::create_dir_all(dir.join("adir")).unwrap();
        fs::write(dir.join("a.md"), "").unwrap();
        let opts = ListDirOptions {
            ext_filters: None,
            hide_hidden: false,
            sort_by: Some("alpha".into()),
            direction: Some("desc".into()),
            group_folder_first: false,
        };
        let entries = list_dir(&dir, None, Some(&opts)).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        // 关闭 Group by Folder：目录与文件混排，全部按字母降序
        assert_eq!(names, vec!["b.md", "adir", "a.md"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sort_by_mtime_desc_and_metadata_present() {
        let dir = temp_dir();
        fs::write(dir.join("old.md"), "").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(30));
        fs::write(dir.join("new.md"), "").unwrap();
        let opts = ListDirOptions {
            ext_filters: Some(vec!["md".into()]),
            hide_hidden: false,
            sort_by: Some("mtime".into()),
            direction: Some("desc".into()),
            group_folder_first: true,
        };
        let entries = list_dir(&dir, None, Some(&opts)).unwrap();
        assert_eq!(entries[0].name, "new.md"); // 最近修改在前
        assert!(entries[0].mtime.is_some()); // 元数据已填充
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn default_options_match_old_behavior() {
        // 不传 opts：目录优先 + 自然序 + 不隐藏过滤（02 原语义）
        let dir = sample_tree();
        let entries = list_dir(&dir, None, None).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["sub", "a1.md", "a2.md", "a10.md", "b.md", "note.txt", "sub/c.md"]
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sort_by_ctime_asc_and_metadata_present() {
        let dir = temp_dir();
        fs::write(dir.join("old.md"), "").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(30));
        fs::write(dir.join("new.md"), "").unwrap();
        let opts = ListDirOptions {
            ext_filters: None,
            hide_hidden: false,
            sort_by: Some("ctime".into()),
            direction: Some("asc".into()),
            group_folder_first: true,
        };
        let entries = list_dir(&dir, None, Some(&opts)).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        // 创建时间升序：先创建者在前
        assert_eq!(names, vec!["old.md", "new.md"]);
        assert!(entries[0].ctime.is_some()); // 创建时间元数据已填充
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn hidden_dir_pruned_from_traversal() {
        let dir = temp_dir();
        fs::create_dir_all(dir.join(".hdir")).unwrap();
        fs::write(dir.join(".hdir").join("ok.md"), "").unwrap();
        fs::write(dir.join("ok.md"), "").unwrap();
        let opts = ListDirOptions {
            ext_filters: Some(vec!["md".into()]),
            hide_hidden: true,
            sort_by: None,
            direction: None,
            group_folder_first: true,
        };
        let entries = list_dir(&dir, None, Some(&opts)).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        // 隐藏目录在遍历层剪枝：.hdir 及其内部 ok.md 均不出现，普通 ok.md 正常
        assert_eq!(names, vec!["ok.md"]);
        let _ = fs::remove_dir_all(&dir);
    }
}
