// 文件 IO 命令基座（02 文档管理）
//
// 模块职责：编码探测、原子写、目录遍历、草稿、目录监视的纯函数实现
// 与薄命令层（方案 C：绕开 fs 插件静态 scope，全部 IO 走自研 command）。
// 线程安全：全部纯函数无共享状态；watch 句柄经 AppState 全局持有。
pub mod atomic;
pub mod commands;
pub mod drafts;
pub mod encoding;
pub mod fs;
pub mod watch;
