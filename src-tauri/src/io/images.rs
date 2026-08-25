// 图片存盘与路径解析（07 图片粘贴存盘）
//
// 职责：剪贴板/拖拽图片落盘（sanitize + mime→扩展名 + UTC 时间戳名 + 原子写字节版 +
// 重名直接覆盖对齐 Typora）、对话框选中文件的批量复制导入、markdown src → 磁盘路径
// 解析（http/data/blob/asset 合成协议排除、绝对透传、root_url 前缀拼接、doc_dir 相对
// 拼接归一）、相对 src 计算（pathdiff，跨盘符 None → 前端降级绝对路径）。
// 时间戳口径沿 drafts.rs 先例用 UTC（无 chrono 依赖；Typora 为本地时区，披露项）。
// 线程安全：无共享状态，每次调用独立计算。
use crate::io::atomic::atomic_write_bytes;
use pathdiff::diff_paths;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Windows 文件名非法字符清洗（保留字符换 `_`，结尾点/空格剥除，空名兜底 `_`）
///
/// @param name 原始文件名（用户文件名或前端合成的剪贴板候选名）
/// @returns 可直接落盘的安全文件名；全非法/空输入兜底 `_`
pub fn sanitize_image_filename(name: &str) -> String {
    // Windows 保留字符与控制字符统一换 `_`——拒绝服务式文件名不阻断粘贴主流程
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if (c as u32) < 0x20 => '_',
            _ => c,
        })
        .collect();
    // Windows 文件名不允许以点/空格结尾（资源管理器会拒收），剥除
    let trimmed = cleaned.trim_end_matches(['.', ' ']);
    if trimmed.is_empty() {
        "_".to_string()
    } else {
        trimmed.to_string()
    }
}

/// mime → 扩展名映射（未知类型兜底 png——Chromium 截图恒 png）
///
/// @param mime 图片 MIME 类型字符串（来自剪贴板/文件探测）
/// @returns 不带点的扩展名；jpeg 归一为 jpg 对齐 Typora 惯例
pub fn mime_to_extension(mime: &str) -> &'static str {
    match mime {
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/bmp" => "bmp",
        "image/avif" => "avif",
        _ => "png",
    }
}

/// 剪贴板截图时间戳词干：image-YYYYMMDD-HHMMSS（UTC，civil_from_days 同 drafts.rs）
///
/// @param now_secs Unix 秒时间戳（调用方注入以便测试固定）
/// @returns 如 image-20260813-063000 的词干（不含扩展名）
pub fn clipboard_image_stem(now_secs: u64) -> String {
    let days = (now_secs / 86_400) as i64;
    let secs_of_day = now_secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    format!(
        "image-{y:04}{m:02}{d:02}-{h:02}{mm:02}{ss:02}",
        h = secs_of_day / 3600,
        mm = secs_of_day % 3600 / 60,
        ss = secs_of_day % 60
    )
}

/// 天数 → 公历（Howard Hinnant 算法，与 drafts.rs 同源实现，私有副本不改动他人模块）
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 相对 src 计算：doc_dir → 图片绝对路径的相对形式（分隔符归一 `/`，跨盘符 None）
///
/// @param doc_dir 文档所在目录（相对基准）
/// @param image_abs 图片绝对路径
/// @returns 正斜杠分隔的相对路径；跨盘符/无法相对化返回 None（前端降级绝对路径）
pub fn relative_src(doc_dir: &Path, image_abs: &Path) -> Option<String> {
    // 跨盘符防线：pathdiff 对不同 Windows 盘符前缀不判 None，反而产出 ../ 伪相对路径
    // （C: 基准 → D: 图片得 ../../pics/x.png），回写 markdown 语义错误，必须显式拦截。
    // 前缀经首组件提取（Path 无公开 prefix()）；Unix 无前缀组件恒走 diff_paths 不受影响
    if let (Some(Component::Prefix(a)), Some(Component::Prefix(b))) =
        (image_abs.components().next(), doc_dir.components().next())
    {
        if a != b {
            return None;
        }
    }
    diff_paths(image_abs, doc_dir).map(|rel| rel.to_string_lossy().replace('\\', "/"))
}

/// markdown src → 磁盘路径解析
///
/// 规则序：①合成协议（http/https/data/blob/asset）→ None；②Windows 绝对路径（盘符或
/// UNC 开头）→ 原样；③src 以 `/` 开头且 root_url 存在 → root_url 拼接（根路径前缀只用于
/// 显示解析，绝不回写 src）；④doc_dir 存在 → 相对拼接并归一 `.`/`..` 组件；⑤无基准 → None。
///
/// @param src markdown 图片 src 原文
/// @param doc_dir 文档所在目录；None 表示未保存文档
/// @param root_url 站点根路径前缀（如本地服务器场景）；None/空表示无
/// @returns 磁盘可寻路径；合成协议或无基准目录时 None（交由上层按远程图处理）
pub fn resolve_fs_path(src: &str, doc_dir: Option<&str>, root_url: Option<&str>) -> Option<String> {
    // 合成/远程协议先行排除：这类 src 永远不该被当成本地磁盘路径拼接
    let lower = src.to_ascii_lowercase();
    if lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("data:")
        || lower.starts_with("blob:")
        || lower.starts_with("asset:")
    {
        return None;
    }
    // Windows 绝对：`C:\`/`C:/` 盘符或 `\\` UNC——原样透传给 fs 层
    let bytes = src.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' {
        return Some(src.to_string());
    }
    if src.starts_with("\\\\") {
        return Some(src.to_string());
    }
    if let Some(root) = root_url {
        if !root.is_empty() && src.starts_with('/') {
            let trimmed = root.trim_end_matches(['/', '\\']);
            return Some(format!("{trimmed}{src}"));
        }
    }
    if let Some(dir) = doc_dir {
        if !dir.is_empty() {
            return Some(normalize_join(Path::new(dir), src));
        }
    }
    None
}

/// 目录拼接 + `.`/`..` 组件归一（不触盘，纯字符串级）
///
/// 根分隔符组件必须保留为独立段：PathBuf 收集时靠它恢复 `C:\` 的 `\`，
/// 若丢弃会退化为 `C:docs` 形态的盘符相对路径（Windows 语义完全不同）。
/// 当前目录组件 `.` 丢弃；`..` 弹出上一段（弹尽即止，纯字符串操作不触盘）。
fn normalize_join(dir: &Path, rel: &str) -> String {
    use Component::*;
    let mut parts: Vec<std::ffi::OsString> = dir
        .components()
        .filter_map(|c| match c {
            CurDir => None,
            RootDir => Some(c.as_os_str().to_os_string()),
            Prefix(p) => Some(p.as_os_str().to_os_string()),
            other => Some(other.as_os_str().to_os_string()),
        })
        .collect();
    for seg in rel.split(['/', '\\']) {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s.into()),
        }
    }
    let joined: PathBuf = parts.iter().collect();
    joined.to_string_lossy().replace('/', "\\")
}

/// 存盘结果 DTO（前端消费 absolutePath / relativeSrc）
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveImageDto {
    /// 图片落盘后的绝对路径（回显/调试用）
    pub absolute_path: String,
    /// 相对文档目录的 src（markdown 回写值）；doc_dir 缺省或跨盘符时 None
    pub relative_src: Option<String>,
}

/// 未开启 copy-to-folder 时截图落临时目录的子目录名
const TEMP_IMAGES_DIR: &str = "markwell-images";

/// 当前 Unix 秒（时钟回拨等异常兜底 0，仅影响时间戳名可读性）
fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 目标目录落地：显式指定优先，否则系统临时目录/markwell-images（自动创建）
///
/// @param target_dir 显式目标目录；None 或空串走临时目录缺省
/// @returns 已确保存在的目标目录
/// @returns Err 目录创建失败（不可写盘符、权限不足等）——AC-P2-5 错误提示由此冒泡
fn prepare_target_dir(target_dir: Option<&str>) -> Result<PathBuf, String> {
    let dir = match target_dir.filter(|s| !s.is_empty()) {
        Some(s) => PathBuf::from(s),
        None => std::env::temp_dir().join(TEMP_IMAGES_DIR),
    };
    fs::create_dir_all(&dir).map_err(|e| format!("创建图片目标目录失败: {e}"))?;
    Ok(dir)
}

/// 单张落盘核心（save_image / import_local_images 共用）
///
/// 经 atomic_write_bytes 落盘（内部 assert_safe_path 拒绝 .. 逃逸）；
/// 重名直接覆盖对齐 Typora（把关已确认）。
///
/// @param file_name 已含扩展名的最终文件名（调用方负责生成/补扩展名）
/// @param bytes 图片原始字节
/// @param target_dir 已确保存在的目标目录
/// @param doc_dir 相对 src 计算基准；None 则 relative_src 为 None
/// @returns DTO；relative_src 在 doc_dir 缺省或跨盘符时为 None
fn write_one(
    file_name: &str,
    bytes: &[u8],
    target_dir: &Path,
    doc_dir: Option<&str>,
) -> Result<SaveImageDto, String> {
    let full = target_dir.join(file_name);
    atomic_write_bytes(&full, bytes)?;
    Ok(SaveImageDto {
        absolute_path: full.to_string_lossy().into_owned(),
        relative_src: doc_dir.and_then(|d| relative_src(Path::new(d), &full)),
    })
}

/// 粘贴/拖拽图片存盘命令
///
/// 执行流程：确定目标目录 → 清洗文件名/生成 UTC 时间戳名 → 补扩展名 → 原子写字节覆盖。
///
/// @param bytes 图片字节（IPC JSON 数组传输，多 MB 截图可接受）
/// @param name 原始文件名；None/空 → UTC 时间戳名（合成剪贴板名由前端判定后传 None）
/// @param mime 图片 MIME 类型（决定扩展名；未知兜底 png）
/// @param target_dir 目标目录；None → 系统临时目录/markwell-images
/// @param doc_dir 文档所在目录（相对 src 计算基准）；未保存文档传 None
/// @returns SaveImageDto；失败返回中文错误（目录不可创建、原子写失败等）
#[tauri::command]
pub fn save_image(
    bytes: Vec<u8>,
    name: Option<String>,
    mime: String,
    target_dir: Option<String>,
    doc_dir: Option<String>,
) -> Result<SaveImageDto, String> {
    let dir = prepare_target_dir(target_dir.as_deref())?;
    let ext = mime_to_extension(&mime);
    // 有语义名的清洗后补扩展名（原无名含点则信任原扩展名）；合成名恒时间戳+推导扩展名
    let final_name = match name.filter(|s| !s.trim().is_empty()) {
        Some(raw) => {
            let sanitized = sanitize_image_filename(&raw);
            if sanitized.contains('.') {
                sanitized
            } else {
                format!("{sanitized}.{ext}")
            }
        }
        None => format!("{}.{ext}", clipboard_image_stem(now_secs())),
    };
    write_one(&final_name, &bytes, &dir, doc_dir.as_deref())
}

/// 对话框选中的本地图片批量复制导入（fs 层复制，不经 IPC 传字节；重名直接覆盖）
///
/// 执行流程：确定目标目录 → 逐个读源文件字节 → 复用 write_one 原子写入。
/// 任一张失败即整体返回 Err（已写入的不回滚——覆盖语义下残留无害）。
///
/// @param paths 对话框选中的源图片绝对路径列表（非空约定由前端保证）
/// @param target_dir 目标目录；None → 系统临时目录/markwell-images
/// @param doc_dir 文档所在目录（相对 src 计算基准）；未保存文档传 None
/// @returns 与入参同序的 DTO 列表；任一张读取/写入失败返回中文错误
#[tauri::command]
pub fn import_local_images(
    paths: Vec<String>,
    target_dir: Option<String>,
    doc_dir: Option<String>,
) -> Result<Vec<SaveImageDto>, String> {
    let dir = prepare_target_dir(target_dir.as_deref())?;
    paths
        .iter()
        .map(|p| {
            let src = Path::new(p);
            // 源路径必须指向具体文件（目录/盘根无文件名，直接报错）
            let raw_name = src
                .file_name()
                .ok_or_else(|| format!("源路径无文件名: {p}"))?;
            // 清洗后无扩展名兜底 png（对话框选择通常已有扩展名，防御性处理）
            let file_name = {
                let s = sanitize_image_filename(&raw_name.to_string_lossy());
                if s.contains('.') {
                    s
                } else {
                    format!("{s}.png")
                }
            };
            let bytes = fs::read(src).map_err(|e| format!("读取图片失败({p}): {e}"))?;
            write_one(&file_name, &bytes, &dir, doc_dir.as_deref())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 创建独立临时目录（进程内自增后缀防并发冲突）
    fn temp_dir() -> std::path::PathBuf {
        static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("markwell-img-{}-{n}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    // ---- sanitize_image_filename ----
    #[test]
    fn sanitize_replaces_windows_reserved_chars() {
        assert_eq!(
            sanitize_image_filename("a<b>c:d\"e/f\\g|h|i?j*k.png"),
            "a_b_c_d_e_f_g_h_i_j_k.png"
        );
    }
    #[test]
    fn sanitize_strips_trailing_dots_and_spaces() {
        assert_eq!(sanitize_image_filename("name. "), "name");
    }
    #[test]
    fn sanitize_empty_falls_to_underscore() {
        assert_eq!(sanitize_image_filename(""), "_");
    }

    // ---- mime_to_extension ----
    #[test]
    fn mime_maps_common_types() {
        assert_eq!(mime_to_extension("image/png"), "png");
        assert_eq!(mime_to_extension("image/jpeg"), "jpg");
        assert_eq!(mime_to_extension("image/webp"), "webp");
    }
    #[test]
    fn mime_unknown_defaults_png() {
        assert_eq!(mime_to_extension("application/octet-stream"), "png");
    }

    // ---- clipboard_image_stem ----
    #[test]
    fn stem_formats_utc_timestamp() {
        // 2026-08-13 06:30:00 UTC = 1_786_602_600 秒（20454 天至 2026-01-01 + 224 天
        // + 当日 23400 秒；固定常量防实现漂移）
        assert_eq!(clipboard_image_stem(1_786_602_600), "image-20260813-063000");
    }

    // ---- relative_src ----
    #[test]
    fn relative_same_dir() {
        let doc = Path::new("C:/docs");
        let img = Path::new("C:/docs/pic.png");
        assert_eq!(relative_src(doc, img).unwrap(), "pic.png");
    }
    #[test]
    fn relative_subdir_uses_forward_slash() {
        let doc = Path::new("C:/docs");
        let img = Path::new("C:/docs/assets/sub/pic.png");
        assert_eq!(relative_src(doc, img).unwrap(), "assets/sub/pic.png");
    }
    #[test]
    fn relative_cross_drive_none() {
        let doc = Path::new("C:/docs");
        let img = Path::new("D:/pics/pic.png");
        assert!(relative_src(doc, img).is_none());
    }

    // ---- resolve_fs_path（Task 3 主体的基础分支在此一并覆盖）----
    #[test]
    fn resolve_rejects_remote_and_synthetic_schemes() {
        assert!(resolve_fs_path("https://a.com/x.png", None, None).is_none());
        assert!(resolve_fs_path("data:image/png;base64,AAAA", None, None).is_none());
        assert!(resolve_fs_path("blob:abc", None, None).is_none());
        assert!(resolve_fs_path("asset://localhost/C%3A/x.png", None, None).is_none());
    }
    #[test]
    fn resolve_absolute_passthrough() {
        assert_eq!(
            resolve_fs_path("C:\\pics\\x.png", Some("C:/docs"), None).as_deref(),
            Some("C:\\pics\\x.png")
        );
    }
    #[test]
    fn resolve_root_url_join_for_leading_slash() {
        // 根路径前缀只用于显示解析（不回写 src）；分隔符归一为 /
        let r = resolve_fs_path("/blog/x.png", Some("C:/docs"), Some("/root")).unwrap();
        assert!(r.replace('\\', "/").ends_with("/root/blog/x.png"));
    }
    #[test]
    fn resolve_doc_dir_join_normalizes_parent() {
        let r = resolve_fs_path("../assets/x.png", Some("C:/docs/note"), None).unwrap();
        assert!(
            r.replace('/', "\\").ends_with("C:\\docs\\assets\\x.png")
                || Path::new(&r) == Path::new("C:/docs/assets/x.png")
        );
    }
    #[test]
    fn resolve_unresolvable_without_base() {
        assert!(resolve_fs_path("x.png", None, None).is_none());
    }

    // ---- save_image 命令层 ----
    #[test]
    fn save_image_writes_bytes_and_returns_paths() {
        let dir = temp_dir();
        let dto = save_image(
            b"fakepng".to_vec(),
            Some("我的 图.png".to_string()),
            "image/png".into(),
            Some(dir.to_string_lossy().into()),
            Some(dir.to_string_lossy().into()),
        )
        .unwrap();
        let expected = dir.join("我的 图.png");
        assert_eq!(dto.absolute_path, expected.to_string_lossy());
        assert_eq!(fs::read(&expected).unwrap(), b"fakepng");
        assert_eq!(dto.relative_src.as_deref(), Some("我的 图.png"));
        let _ = fs::remove_dir_all(&dir);
    }
    #[test]
    fn save_image_generates_timestamped_name_when_synthetic() {
        let dir = temp_dir();
        let dto = save_image(
            b"x".to_vec(),
            None,
            "image/png".into(),
            Some(dir.to_string_lossy().into()),
            None,
        )
        .unwrap();
        let saved = Path::new(&dto.absolute_path)
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        assert!(saved.starts_with("image-2"), "实际名: {saved}");
        assert!(saved.ends_with(".png"));
        let _ = fs::remove_dir_all(&dir);
    }
    #[test]
    fn save_image_overwrites_existing() {
        let dir = temp_dir();
        let args = (b"x".to_vec(), "a.png".to_string());
        save_image(
            args.0.clone(),
            Some(args.1.clone()),
            "image/png".into(),
            Some(dir.to_string_lossy().into()),
            None,
        )
        .unwrap();
        let dto = save_image(
            b"y".to_vec(),
            Some(args.1),
            "image/png".into(),
            Some(dir.to_string_lossy().into()),
            None,
        )
        .unwrap();
        assert_eq!(fs::read(Path::new(&dto.absolute_path)).unwrap(), b"y");
        let _ = fs::remove_dir_all(&dir);
    }
    #[test]
    fn save_image_missing_target_dir_errors() {
        // AC-P2-5 错误路径：目标目录不可创建（本机不存在 Z: 盘）时错误冒泡到前端提示
        let r = save_image(
            b"x".to_vec(),
            Some("a.png".into()),
            "image/png".into(),
            Some("Z:/no/such/dir".into()),
            None,
        );
        assert!(r.is_err());
    }

    // ---- import_local_images 命令层 ----
    #[test]
    fn import_copies_files_into_target() {
        let src_dir = temp_dir();
        let dst_dir = temp_dir();
        fs::write(src_dir.join("s.png"), b"data").unwrap();
        let dtos = import_local_images(
            vec![src_dir.join("s.png").to_string_lossy().into()],
            Some(dst_dir.to_string_lossy().into()),
            Some(dst_dir.to_string_lossy().into()),
        )
        .unwrap();
        assert_eq!(dtos.len(), 1);
        assert_eq!(fs::read(dst_dir.join("s.png")).unwrap(), b"data");
        let _ = fs::remove_dir_all(&src_dir);
        let _ = fs::remove_dir_all(&dst_dir);
    }
}
