// 文件 IO 命令层（02 文档管理）
//
// 全部命令为薄封装：入参校验（路径安全）→ 纯函数实现 → DTO 序列化。
// DTO 统一 camelCase（serde rename_all），供前端 invoke 消费。
use serde::{Deserialize, Serialize};

/// 目录遍历结果项
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    /// 条目完整路径
    pub path: String,
    /// 相对根目录的路径（/ 分隔，不含根自身）
    pub name: String,
    /// 是否为目录
    pub is_dir: bool,
    /// 扩展名（不含点，目录为空串）
    pub ext: String,
}

/// 读文件结果（内容统一 UTF-8，编码/行尾探测结果）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResultDto {
    /// 解码后的文本内容（GBK 已转 UTF-8）
    pub content: String,
    /// 源编码：utf8 / utf8-bom / gbk
    pub encoding: String,
    /// 源行尾：lf / crlf
    pub line_ending: String,
}

/// 写文件选项
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteOptions {
    /// 落盘行尾：lf / crlf（非法值回落 lf）
    pub line_ending: String,
}

/// 草稿条目
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftEntry {
    /// 草稿完整路径
    pub path: String,
    /// 草稿文件名（含 .md）
    pub name: String,
    /// 文件名中的日期前缀（YYYY-MM-DD）
    pub date: String,
}

/// 目录监视事件
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchEvent {
    /// create / remove / modify / rename
    pub kind: String,
    /// 变更条目的完整路径
    pub path: String,
}

/// 启动命令行参数（02 启动行为，Task 13 实现并注册）
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliArgs {
    /// --new 已传入（覆盖启动设置，新建未命名文档）
    pub new: bool,
    /// --reopen-file=<path> 或 --reopen-file <path> 的目标路径
    pub reopen_file: Option<String>,
}
