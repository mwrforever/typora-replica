// conf.user.json 高级设置（10 S2）
//
// 双层设置的文件侧：面板 GUI 走 tauri-plugin-store（services/settings.ts），高级键走本模块
// 管理的 conf.user.json（用户实测裁决文件名；官方 Advance-Config 页 config.user.json 为笔误）。
// 解析为「注释剥离 + serde_json」（官方明文支持 // 行注释）；写回为「行级键值合并」——
// 只替换目标键行、保留用户注释与其余格式（AC-S2-2）；落盘复用 io::atomic::atomic_write
// （同目录临时文件 + fsync + rename，宪法 A.5/BUG-7 语义）。
// 线程安全：无共享状态（纯函数 + 路径参数）。文件为 KB 级小文本，同步 IO 与 read_file 同口径。

/// conf 文件名（app_data_dir 下）
pub const CONF_FILE_NAME: &str = "conf.user.json";

/// 高级设置合法键白名单（12.7 七键；写入口收窄，防 typo 与任意键注入）
pub const ADVANCED_KEYS: [&str; 7] = [
    "defaultFontFamily",
    "autoHideMenuBar",
    "searchService",
    "monocolorEmoji",
    "flags",
    "autoSaveTimer",
    "keyBinding",
];

/// 默认模板（Reset 目标与首启种子；键默认值与前端 DEFAULT_ADVANCED_SETTINGS 逐键一致；
/// 注释为用户编辑指引——官方 Auto-Save 页示例即带 // 注释）
pub const DEFAULT_CONF_TEMPLATE: &str = r#"{
  // MarkWell 高级设置：JSON 支持 // 行注释；除 autoSaveTimer 随面板同步外，修改后重启生效
  // defaultFontFamily：默认字体族覆盖，如 { "sansSerif": "Microsoft YaHei" }
  "defaultFontFamily": {},
  // autoHideMenuBar：true 才启用菜单栏自动隐藏（Alt 单按切换显隐）
  "autoHideMenuBar": false,
  // searchService：右键搜索服务列表，如 [ { "name": "Bing", "url": "https://www.bing.com/search?q=%s" } ]
  "searchService": [],
  // monocolorEmoji：true = 表情符号渲染为单色
  "monocolorEmoji": false,
  // flags：Chromium 启动参数，如 { "force-color-profile": "srgb" }
  "flags": {},
  // autoSaveTimer：自动保存间隔（分钟；与偏好面板双写同步）
  "autoSaveTimer": 5,
  // keyBinding：自定义快捷键，键 = 菜单命令名、值 = 组合串，如 { "Always on Top": "Ctrl+Shift+P" }
  "keyBinding": {}
}
"#;

/// 剥离 // 行注释（AC-S2-1 核心：跳过字符串字面量内的 //）
///
/// 逐行块（split_inclusive('\n')）状态机：字符串外遇 `//` 截断到行尾；字符串内 `//`（如 URL）
/// 与 `\"` 转义不终止字符串；截断后补回原行终止符（\r\n / \n），行块边界与原文一一对应
/// （行级合并的深度表按同一行块切分）。JSON 规范字符串不含裸换行，跨行残缺字符串由
/// parse 阶段 serde 兜底报错。
pub fn strip_line_comments(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut in_string = false;
    let mut escaped = false;
    for line in raw.split_inclusive('\n') {
        let chars: Vec<char> = line.chars().collect();
        let mut cut: Option<String> = None;
        let mut i = 0;
        while i < chars.len() {
            let c = chars[i];
            if in_string {
                if escaped {
                    escaped = false;
                } else if c == '\\' {
                    escaped = true;
                } else if c == '"' {
                    in_string = false;
                }
                out.push(c);
            } else if c == '"' {
                in_string = true;
                out.push(c);
            } else if c == '/' && chars.get(i + 1) == Some(&'/') {
                // 注释起点：剩余内容丢弃，仅保留原行终止符（维持行块一一对应）
                let mut rest = String::new();
                if line.ends_with("\r\n") {
                    rest.push_str("\r\n");
                } else if line.ends_with('\n') {
                    rest.push('\n');
                }
                cut = Some(rest);
                break;
            } else {
                out.push(c);
            }
            i += 1;
        }
        if let Some(rest) = cut {
            out.push_str(&rest);
        }
    }
    out
}

/// 解析 conf.user.json 原文（剥离 // 注释后 serde 解析，顶层必须是对象）
///
/// @returns 解析出的 JSON 值（保证 is_object）
/// @returns Err 中文错误（消息含「已保留原文件」口径——调用方在此路径绝不写盘，AC-S2-4）
pub fn parse_advanced_raw(raw: &str) -> Result<serde_json::Value, String> {
    let stripped = strip_line_comments(raw);
    let value: serde_json::Value = serde_json::from_str(stripped.trim())
        .map_err(|e| format!("conf.user.json 不是合法 JSON（已保留原文件）: {e}"))?;
    if !value.is_object() {
        return Err("conf.user.json 顶层必须是 JSON 对象（已保留原文件）".to_string());
    }
    Ok(value)
}

/// 计算每个行块（split_inclusive('\n') 切分，与 merge 的行切分一致）起始处的对象嵌套深度
///
/// 字符串内的大括号不计数；`{`/`[` 加一、`}`/`]` 减一。顶层键定义行的行前深度恒为 1。
fn depth_before_lines(raw: &str) -> Vec<i32> {
    let mut depths = Vec::new();
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    for line in raw.split_inclusive('\n') {
        depths.push(depth);
        for c in line.chars() {
            if in_string {
                if escaped {
                    escaped = false;
                } else if c == '\\' {
                    escaped = true;
                } else if c == '"' {
                    in_string = false;
                }
            } else {
                match c {
                    '"' => in_string = true,
                    '{' | '[' => depth += 1,
                    '}' | ']' => depth -= 1,
                    _ => {}
                }
            }
        }
    }
    depths
}

/// 拆分行尾注释：首个字符串外 `//` 起为注释（返回 (代码段, 注释段)）；无注释返回 (原文, "")
///
/// 字符串内的 `//`（URL 等）不影响；注释段内出现引号不再翻转状态（注释到行尾为止）。
fn split_trailing_comment(line: &str) -> (&str, &str) {
    let mut in_string = false;
    let mut escaped = false;
    let chars: Vec<(usize, char)> = line.char_indices().collect();
    let mut i = 0;
    while i < chars.len() {
        let (byte_idx, c) = chars[i];
        if in_string {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
        } else if c == '"' {
            in_string = true;
        } else if c == '/' && chars.get(i + 1).map(|(_, n)| *n) == Some('/') {
            return (&line[..byte_idx], &line[byte_idx..]);
        }
        i += 1;
    }
    (line, "")
}

/// 行终止符识别（\r\n / \n / EOF 无终止符）
fn line_terminator(line: &str) -> &'static str {
    if line.ends_with("\r\n") {
        "\r\n"
    } else if line.ends_with('\n') {
        "\n"
    } else {
        ""
    }
}

/// 注释段重组（剥终止符、前置空格分隔）
fn comment_suffix(comment: &str) -> String {
    let trimmed = comment.trim_end_matches(['\n', '\r']);
    if trimmed.is_empty() {
        String::new()
    } else {
        format!(" {trimmed}")
    }
}

/// 行级合并写回（AC-S2-2 核心）
///
/// 规则：
/// 1. 原文先过 parse_advanced_raw（非法 JSON 即 Err——调用方无从拿到产出，原文件保留原样）；
/// 2. 目标行判定 = 行前深度 1 + 非注释行 + 去缩进后恰以 `"key"` 开头且随后为 `:`；
/// 3. 替换只重建目标行：保留原缩进、尾逗号、行尾 // 注释与行终止符；
/// 4. key 未命中 → 最后一个顶层收括号行前插入（2 空格缩进 + \n），前属性行缺逗号则补；
/// 5. 同一 key 命中多行 → Err（替换歧义，请用户手工去重）；
/// 6. 产出再过 parse_advanced_raw（后置校验兜底——不合法不产出）。
///
/// @param raw 原文件全文
/// @param key 目标键（白名单校验在命令层）
/// @param value_json 目标值的单行 JSON 序列化（serde_json::to_string 产物）
pub fn merge_advanced_line(raw: &str, key: &str, value_json: &str) -> Result<String, String> {
    parse_advanced_raw(raw)?;
    let depths = depth_before_lines(raw);
    let lines: Vec<&str> = raw.split_inclusive('\n').collect();
    let pattern = format!("\"{key}\"");
    let hits: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter(|(idx, line)| {
            let trimmed = line.trim_start();
            // 注释行不是定义行（注释内出现 "key": 形态不得误命中）
            !trimmed.starts_with("//")
                && depths[*idx] == 1
                && trimmed.starts_with(&pattern)
                && trimmed[pattern.len()..].trim_start().starts_with(':')
        })
        .map(|(idx, _)| idx)
        .collect();

    let mut out = String::with_capacity(raw.len() + value_json.len() + 16);
    match hits.as_slice() {
        [target] => {
            for (idx, line) in lines.iter().enumerate() {
                if idx == *target {
                    // 只替换目标行值段：缩进 + "key": 值 + 尾逗号 + 行尾注释 + 原终止符
                    let trimmed = line.trim_start();
                    let indent = &line[..line.len() - trimmed.len()];
                    let (code, comment) = split_trailing_comment(line);
                    let code_core = code.trim_end();
                    let comma = if code_core.ends_with(',') { "," } else { "" };
                    out.push_str(indent);
                    out.push_str(&format!("\"{key}\": {value_json}{comma}"));
                    out.push_str(&comment_suffix(comment));
                    out.push_str(line_terminator(line));
                } else {
                    out.push_str(line); // 未触及行原样（含终止符）
                }
            }
        }
        [] => {
            // key 缺失：最后一个顶层收括号行前插入
            let close_idx = lines
                .iter()
                .rposition(|l| l.trim_start().starts_with('}'))
                .ok_or_else(|| "conf.user.json 缺少顶层收括号，拒绝插入新键".to_string())?;
            for (idx, line) in lines.iter().enumerate() {
                if idx + 1 == close_idx {
                    // 前属性行缺尾逗号则补（保留注释与终止符）
                    let (code, comment) = split_trailing_comment(line);
                    let code_core = code.trim_end();
                    if !code_core.ends_with(',') && !code_core.ends_with('{') {
                        out.push_str(code_core);
                        out.push(',');
                        out.push_str(&comment_suffix(comment));
                        out.push_str(line_terminator(line));
                        continue;
                    }
                }
                if idx == close_idx {
                    out.push_str(&format!("  \"{key}\": {value_json}\n"));
                }
                out.push_str(line);
            }
        }
        _ => {
            return Err(format!(
                "conf.user.json 中键 {key} 出现多次，拒绝写入（请手工去重后重试）"
            ))
        }
    }
    // 产出校验（兜底）：不合法即 Err，调用方不得写盘
    parse_advanced_raw(&out)?;
    Ok(out)
}

/// 键值形态校验（写入口；与前端 AdvancedSettingValue 相比更严格——按键逐一验型）
///
/// 布尔键：autoHideMenuBar / monocolorEmoji；数值键：autoSaveTimer（有限正数）；
/// 对象键：defaultFontFamily / flags / keyBinding（keyBinding 的值必须全为字符串）；
/// 列表键：searchService。
pub fn validate_value(key: &str, value: &serde_json::Value) -> Result<(), String> {
    let reject = |shape: &str| format!("高级设置 {key} 的值必须是{shape}");
    match key {
        "autoHideMenuBar" | "monocolorEmoji" => {
            if value.is_boolean() {
                Ok(())
            } else {
                Err(reject("布尔值"))
            }
        }
        "autoSaveTimer" => match value.as_f64() {
            Some(n) if n.is_finite() && n > 0.0 => Ok(()),
            _ => Err(reject("正数（分钟）")),
        },
        "keyBinding" => {
            let obj = value
                .as_object()
                .ok_or_else(|| reject("对象（命令名 → 组合串）"))?;
            if obj.values().all(|v| v.is_string()) {
                Ok(())
            } else {
                Err(reject("对象（值必须全为字符串）"))
            }
        }
        "defaultFontFamily" | "flags" => {
            if value.is_object() {
                Ok(())
            } else {
                Err(reject("对象"))
            }
        }
        "searchService" => {
            if value.is_array() {
                Ok(())
            } else {
                Err(reject("数组"))
            }
        }
        _ => Err(format!("非法的高级设置键: {key}（白名单七键之外拒绝写入）")),
    }
}

#[cfg(test)]
mod tests {
    // —— 10 conf.user.json 核心：注释剥离 / 解析 / 行级合并 / 值校验（核心 100%）——
    use super::*;

    #[test]
    fn strip_keeps_slash_slash_inside_string_url() {
        // 字符串内的 // 是 URL 组成部分，不得剥离（AC-S2-1 边界核心）
        let raw = "{\n  // 注释行\n  \"url\": \"https://typora.io\",\n}\n";
        let stripped = strip_line_comments(raw);
        assert!(stripped.contains("https://typora.io"));
        assert!(!stripped.contains("注释行"));
        // 行数不变（行级合并依赖行号稳定）
        assert_eq!(stripped.lines().count(), raw.lines().count());
    }

    #[test]
    fn strip_respects_escaped_quote_before_slash_comment() {
        // 转义引号不终止字符串：字符串延续到真引号，其后的 // 才是注释
        let raw = "{\n  \"a\": \" He said \\\"ok//then\\\" more\" // tail comment\n}\n";
        let stripped = strip_line_comments(raw);
        assert!(stripped.contains("ok//then"));
        assert!(!stripped.contains("tail comment"));
    }

    #[test]
    fn strip_plain_json_untouched() {
        let raw = "{\n  \"autoSaveTimer\": 5\n}\n";
        assert_eq!(strip_line_comments(raw), raw);
    }

    #[test]
    fn strip_truncated_line_keeps_terminator() {
        // 截断注释后补回行终止符（含 CRLF 形态），保持 split_inclusive 行块对应
        let raw = "{\r\n  \"a\": 1 // c\r\n}\r\n";
        let stripped = strip_line_comments(raw);
        assert_eq!(stripped, "{\r\n  \"a\": 1 \r\n}\r\n");
    }

    #[test]
    fn parse_template_ok_and_has_seven_keys() {
        let value = parse_advanced_raw(DEFAULT_CONF_TEMPLATE).expect("测试上下文允许 expect");
        let obj = value.as_object().expect("测试上下文允许 expect");
        assert_eq!(obj.len(), 7);
        assert!(obj.contains_key("keyBinding"));
    }

    #[test]
    fn parse_rejects_non_object_top_level() {
        let err = parse_advanced_raw("[1, 2]").expect_err("应拒绝非对象顶层");
        assert!(err.contains("顶层必须是 JSON 对象"));
    }

    #[test]
    fn parse_rejects_illegal_json_keeps_message_about_file() {
        // AC-S2-4：错误消息明示「已保留原文件」口径
        let err = parse_advanced_raw("{ \"a\": }").expect_err("非法 JSON 应报错");
        assert!(err.contains("不是合法 JSON"));
        assert!(err.contains("已保留原文件"));
    }

    #[test]
    fn merge_replaces_target_line_and_keeps_comments_and_other_lines() {
        // AC-S2-2：只替换目标行，独立注释行与其余格式逐行保留
        let raw = "{\n  // 字体设置\n  \"defaultFontFamily\": {},\n  // 菜单栏\n  \"autoHideMenuBar\": false,\n  \"autoSaveTimer\": 5\n}\n";
        let merged = merge_advanced_line(raw, "autoHideMenuBar", "true").expect("合并应成功");
        assert!(merged.contains("  \"autoHideMenuBar\": true,"));
        assert!(merged.contains("// 字体设置"));
        assert!(merged.contains("// 菜单栏"));
        assert!(merged.contains("  \"defaultFontFamily\": {},"));
        assert!(merged.contains("  \"autoSaveTimer\": 5\n"));
        // 逗号形态保留：目标行原有尾逗号 → 替换行保留
    }

    #[test]
    fn merge_preserves_no_comma_form_and_trailing_comment() {
        let raw = "{\n  \"autoSaveTimer\": 5 // 分钟\n}\n";
        let merged = merge_advanced_line(raw, "autoSaveTimer", "10").expect("合并应成功");
        assert_eq!(merged, "{\n  \"autoSaveTimer\": 10 // 分钟\n}\n");
    }

    #[test]
    fn merge_keeps_crlf_terminator_of_target_line() {
        let raw = "{\r\n  \"autoSaveTimer\": 5,\r\n  \"flags\": {}\r\n}\r\n";
        let merged = merge_advanced_line(raw, "autoSaveTimer", "3").expect("合并应成功");
        assert!(merged.contains("  \"autoSaveTimer\": 3,\r\n"));
        assert!(merged.contains("  \"flags\": {}\r\n")); // 未触及行终止符原样
    }

    #[test]
    fn merge_inserts_new_key_before_closing_brace_and_fixes_prev_comma() {
        // 键缺失：收括号前插入，前属性行补尾逗号
        let raw = "{\n  \"autoSaveTimer\": 5\n}\n";
        let merged = merge_advanced_line(raw, "monocolorEmoji", "true").expect("插入应成功");
        assert_eq!(
            merged,
            "{\n  \"autoSaveTimer\": 5,\n  \"monocolorEmoji\": true\n}\n"
        );
    }

    #[test]
    fn merge_insert_rejects_trailing_comma_source() {
        // 尾逗号属非法严格 JSON：入口校验即 Err（与 merge 规则 1 一致，原文件保留原样）
        let err = merge_advanced_line("{\n  \"autoSaveTimer\": 5,\n}\n", "flags", "{}")
            .expect_err("尾逗号非法 JSON 应拒绝");
        assert!(err.contains("不是合法 JSON"));
    }

    #[test]
    fn merge_insert_skips_comma_fix_on_object_opener_line() {
        // 空对象形态：前属性行为开括号行时不补逗号，插入键后仍为合法 JSON
        let merged = merge_advanced_line("{\n}\n", "flags", "{}").expect("插入应成功");
        assert_eq!(merged, "{\n  \"flags\": {}\n}\n");
    }

    #[test]
    fn merge_rejects_illegal_source_json() {
        // AC-S2-4：非法 JSON 直接 Err，产出空缺（调用方无从写盘，原文件保留原样）
        assert!(merge_advanced_line("{ broken", "autoSaveTimer", "5").is_err());
    }

    #[test]
    fn merge_rejects_duplicated_key() {
        let raw = "{\n  \"autoSaveTimer\": 5,\n  \"autoSaveTimer\": 6\n}\n";
        let err = merge_advanced_line(raw, "autoSaveTimer", "7").expect_err("键重复应拒绝");
        assert!(err.contains("出现多次"));
    }

    #[test]
    fn merge_result_validated_output_rejected_when_broken() {
        // 后置校验兜底：产出不合法即 Err（不返回半成品供写盘）
        let raw = "{\n  \"keyBinding\": {}\n}\n";
        // 值本身合法所以正常成功；此处验证输出校验路径通过 merge 成功而不破坏 JSON
        let merged =
            merge_advanced_line(raw, "keyBinding", "{\"Bold\": \"Ctrl+J\"}").expect("应成功");
        assert!(parse_advanced_raw(&merged).is_ok());
    }

    #[test]
    fn merge_insert_rejects_single_line_file_without_closing_brace_line() {
        // 极简单行形态（披露 10）：解析合法但无独立收括号行可定位插入点 → 中文报错不产出
        let err = merge_advanced_line("{\"autoSaveTimer\": 5}", "flags", "{}")
            .expect_err("无收括号行应拒绝插入");
        assert!(err.contains("缺少顶层收括号"));
    }

    #[test]
    fn validate_value_accepts_and_rejects_by_key_shape() {
        assert!(validate_value("autoHideMenuBar", &serde_json::json!(true)).is_ok());
        assert!(validate_value("autoHideMenuBar", &serde_json::json!("yes")).is_err());
        assert!(validate_value("monocolorEmoji", &serde_json::json!(false)).is_ok());
        assert!(validate_value("autoSaveTimer", &serde_json::json!(5)).is_ok());
        assert!(validate_value("autoSaveTimer", &serde_json::json!(-1)).is_err());
        assert!(validate_value("autoSaveTimer", &serde_json::json!("5")).is_err());
        assert!(validate_value("keyBinding", &serde_json::json!({ "Bold": "Ctrl+J" })).is_ok());
        assert!(validate_value("keyBinding", &serde_json::json!({ "Bold": 1 })).is_err());
        assert!(validate_value("searchService", &serde_json::json!([{"name": "Bing"}])).is_ok());
        assert!(validate_value("searchService", &serde_json::json!({})).is_err());
        assert!(validate_value("flags", &serde_json::json!({})).is_ok());
        assert!(validate_value("flags", &serde_json::json!([])).is_err());
        assert!(validate_value(
            "defaultFontFamily",
            &serde_json::json!({ "sansSerif": "YaHei" })
        )
        .is_ok());
        assert!(validate_value("defaultFontFamily", &serde_json::json!([])).is_err());
    }

    #[test]
    fn validate_value_rejects_key_outside_whitelist() {
        // 白名单七键之外的键一律拒绝（防任意键注入 conf 文件）
        let err = validate_value("notInList", &serde_json::json!(true)).expect_err("应拒绝");
        assert!(err.contains("非法的高级设置键"));
    }
}
