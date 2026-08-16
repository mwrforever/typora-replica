// 编码探测与行尾处理（02 文档管理，C3 编码验收）
//
// 策略（已锁定）：BOM 嗅探优先 → UTF-8 严格校验（无替换字符）→ GBK 回退
// （差异化增强，Typora 无探测直接乱码）→ 双失败判无法识别拒绝读取；
// 内容含 NUL 判二进制拒绝（防误读非文本文件）。
// 线程安全：无共享状态，每次调用独立计算。
use encoding_rs::{GBK, UTF_8};

/// 源文本编码（保存一律转 UTF-8 无 BOM，本枚举仅记录探测结果）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextEncoding {
    /// UTF-8 无 BOM
    Utf8,
    /// UTF-8 带 BOM（读取时已剥离）
    Utf8Bom,
    /// GBK（读取时已转码为 UTF-8 字符串）
    Gbk,
}

/// 行尾形态（读取探测 / 写盘目标）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineEnding {
    /// LF（Unix，默认）
    Lf,
    /// CRLF（Windows，可配）
    Crlf,
}

/// 解码结果：文本内容 + 探测元信息
pub struct DecodedText {
    /// 解码后的文本（GBK 源已转 UTF-8）
    pub text: String,
    /// 探测出的源编码
    pub encoding: TextEncoding,
    /// 探测出的源行尾
    pub line_ending: LineEnding,
}

/// UTF-8 BOM 字节序列
const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

/// 解码文本字节（BOM 剥离 / UTF-8 严格 / GBK 回退 / 二进制拒绝）
///
/// @param bytes 文件原始字节
/// @returns 解码文本与编码/行尾元信息；无法识别或疑似二进制返回错误
pub fn decode_text(bytes: &[u8]) -> Result<DecodedText, String> {
    let (text, encoding) = if bytes.starts_with(UTF8_BOM) {
        // BOM 剥离后按 UTF-8 解码；校验失败（BOM + 非 UTF-8，如部分编辑器写出
        // GBK 带 BOM）回退 GBK 解码，与非 BOM 分支行为一致——修复前丢弃 had_errors
        // 静默输出 U+FFFD 替换字符（BUG-6：同文件两种解码路径行为不一致）
        let (cow, had_errors) = UTF_8.decode_without_bom_handling(&bytes[UTF8_BOM.len()..]);
        if !had_errors {
            (cow.into_owned(), TextEncoding::Utf8Bom)
        } else {
            let (gbk_cow, _gbk_actual_encoding, gbk_errors) = GBK.decode(&bytes[UTF8_BOM.len()..]);
            if gbk_errors {
                return Err("无法识别的文本编码（非 UTF-8 且非 GBK）".to_string());
            }
            (gbk_cow.into_owned(), TextEncoding::Gbk)
        }
    } else {
        let (cow, had_errors) = UTF_8.decode_without_bom_handling(bytes);
        if !had_errors {
            // UTF-8 严格校验通过（无替换字符）
            (cow.into_owned(), TextEncoding::Utf8)
        } else {
            // UTF-8 校验失败：按 GBK 回退解码（Windows 中文环境主流遗留编码）。
            // 注：encoding_rs 0.8.35 的 decode() 返回三元素元组（文本/实际编码/是否出错），
            // 与 brief 的两元素写法存在 API 差异，此处按实际 API 取用文本与出错标志。
            let (gbk_cow, _gbk_actual_encoding, gbk_errors) = GBK.decode(bytes);
            if gbk_errors {
                // 双失败：非 UTF-8 且非 GBK，无法识别编码
                return Err("无法识别的文本编码（非 UTF-8 且非 GBK）".to_string());
            }
            (gbk_cow.into_owned(), TextEncoding::Gbk)
        }
    };
    // 二进制防线：NUL 字节文本文件几乎不可能出现
    if text.contains('\0') {
        return Err("文件疑似二进制（含 NUL 字节），拒绝读取".to_string());
    }
    Ok(DecodedText {
        line_ending: detect_line_ending(&text),
        text,
        encoding,
    })
}

/// 探测行尾：CRLF 出现次数 ≥ 裸 LF 次数判 CRLF（混合行尾以多数为准）
fn detect_line_ending(text: &str) -> LineEnding {
    let crlf = text.matches("\r\n").count();
    // 裸 LF 数 = 全部 \n 减去 CRLF 内含的 \n。brief 原实现直接数 \n 会把
    // CRLF 也计入 LF，CRLF 占多数时仍误判为 LF，与 crlf_detected_when_dominant
    // 测试相悖（如 "a\r\nb\r\nc\n"：crlf=2 应判 Crlf），此处修正为计数裸 LF。
    let lf = text.matches('\n').count() - crlf;
    if crlf > 0 && crlf >= lf {
        LineEnding::Crlf
    } else {
        LineEnding::Lf
    }
}

/// 行尾归一（全文级转换，覆盖 FM 区；02 行尾转换器收口）
///
/// 先剥 CRLF 归 LF 再统一换目标行尾，保证无重复 \r；末尾无换行保持无换行。
/// @param text 待转换文本
/// @param target 目标行尾
/// @returns 转换后文本
pub fn normalize_line_ending(text: &str, target: LineEnding) -> String {
    let lf_normalized = text.replace("\r\n", "\n");
    match target {
        LineEnding::Lf => lf_normalized,
        LineEnding::Crlf => lf_normalized.replace('\n', "\r\n"),
    }
}

/// 编码枚举 → DTO 字符串（前端 TextEncoding 联合）
pub fn encoding_name(e: TextEncoding) -> &'static str {
    match e {
        TextEncoding::Utf8 => "utf8",
        TextEncoding::Utf8Bom => "utf8-bom",
        TextEncoding::Gbk => "gbk",
    }
}

/// 行尾枚举 → DTO 字符串（前端 LineEnding 联合）
pub fn line_ending_name(e: LineEnding) -> &'static str {
    match e {
        LineEnding::Lf => "lf",
        LineEnding::Crlf => "crlf",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_without_bom_detected() {
        let bytes = "中文测试\n第二行".as_bytes();
        let out = decode_text(bytes).unwrap();
        assert_eq!(out.encoding, TextEncoding::Utf8);
        assert_eq!(out.text, "中文测试\n第二行");
        assert_eq!(out.line_ending, LineEnding::Lf);
    }

    #[test]
    fn utf8_bom_stripped() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("中文".as_bytes());
        let out = decode_text(&bytes).unwrap();
        assert_eq!(out.encoding, TextEncoding::Utf8Bom);
        assert_eq!(out.text, "中文");
    }

    #[test]
    fn gbk_fallback_detected() {
        // 「中文测试」GBK 编码（UTF-8 校验必失败）
        let gbk_bytes = [0xD6, 0xD0, 0xCE, 0xC4, 0xB2, 0xE2, 0xCA, 0xD4];
        let out = decode_text(&gbk_bytes).unwrap();
        assert_eq!(out.encoding, TextEncoding::Gbk);
        assert_eq!(out.text, "中文测试");
    }

    #[test]
    fn gbk_with_bom_falls_back_to_gbk() {
        // BUG-6：BOM + GBK（部分编辑器写出形态）不得静默输出 U+FFFD，
        // 须与非 BOM 分支一致回退 GBK（修复前 _had_errors 被丢弃）
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(&[0xD6, 0xD0, 0xCE, 0xC4]);
        let out = decode_text(&bytes).unwrap();
        assert_eq!(out.encoding, TextEncoding::Gbk);
        assert_eq!(out.text, "中文");
        // BOM + 双重无法识别：与非 BOM 分支一致拒绝读取
        let mut bad = vec![0xEF, 0xBB, 0xBF];
        bad.extend_from_slice(&[0x61, 0xFF, 0xFF]);
        assert!(decode_text(&bad).is_err());
    }

    #[test]
    fn unknown_encoding_rejected() {
        // 纯 ASCII 之后接非法 GBK 连字节（0xFF 0xFF）→ 两解码均失败
        let bytes = [0x61, 0xFF, 0xFF];
        assert!(decode_text(&bytes).is_err());
    }

    #[test]
    fn binary_content_rejected() {
        let bytes = [0x61, 0x00, 0x62];
        assert!(decode_text(&bytes).is_err());
    }

    #[test]
    fn crlf_detected_when_dominant() {
        let bytes = "a\r\nb\r\nc\n".as_bytes();
        let out = decode_text(bytes).unwrap();
        assert_eq!(out.line_ending, LineEnding::Crlf);
    }

    #[test]
    fn normalize_to_crlf_and_back() {
        let crlf = normalize_line_ending("a\nb\nc", LineEnding::Crlf);
        assert_eq!(crlf, "a\r\nb\r\nc");
        let lf = normalize_line_ending("a\r\nb\r\nc\r\n", LineEnding::Lf);
        assert_eq!(lf, "a\nb\nc\n");
    }

    #[test]
    fn mixed_line_endings_normalized_by_target() {
        assert_eq!(
            normalize_line_ending("a\r\nb\nc", LineEnding::Crlf),
            "a\r\nb\r\nc"
        );
    }
}
