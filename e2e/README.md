# E2E 测试说明

本项目有两套端到端验证，覆盖相同的验证目标（应用启动、前端渲染、编辑器挂载）：

## 1. CI 冒烟测试（GitHub Actions，确定性验证）

- 脚本：`e2e/smoke-ci.mjs`
- 原理：以进程/网络层证据做确定性断言——
  1. 应用进程启动并存活（tasklist）
  2. WebView2 初始化（子进程存活 + user data 目录建立）
  3. 前端页面真实加载（WebView2 进程与 vite dev server 建立 ESTABLISHED 连接）
- 触发：Build Verification workflow 的 e2e job（PR 与 main 推送）

### 为什么 CI 不用 CDP/WebDriver

CI runner 镜像自带 WebView2 Runtime **150.0.4078.105**，该版本存在微软上游回归
（WebView2Feedback#5639）：宿主进程**提权**时 CDP 调试端口静默不监听。runner 的
job 进程天生提权，导致所有依赖调试端口的方案（msedgedriver/WebdriverIO、
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 注入、固定端口直连）在 CI 均不可用。
已尝试并排除：runas 降权（服务上下文静默失败）、schtasks /IT 降权与新建非管理
用户（疑 runner 禁用 UAC，令牌仍提权）、151 固定版本运行库（不理会调试参数环境
变量与注册表策略注入）、安装器升级（服务会话挂起）。本地（WebView2 151、非提权）
全部正常。

因此 CI 冒烟不依赖调试端口，改验证「应用能启动、WebView2 能初始化、前端能加载」。
待微软修复回归或 runner 镜像升级 WebView2 后，可将 CI 恢复为完整 CDP 方案。

## 2. 完整 WebDriver E2E（本地执行）

- 配置：`e2e/wdio.conf.ts`，用例：`e2e/specs/*.e2e.ts`
- 技术：WebdriverIO 9 + tauri-driver + msedgedriver
- 前置：先启动 Vite dev server 与 tauri-driver，再执行

```bash
npm run dev &                       # 终端 1：前端 dev server
tauri-driver --native-driver e2e/.driver/msedgedriver.exe &   # 终端 2：WebDriver 服务
npm run test:e2e                    # 终端 3：运行测试
```

驱动下载（需与 Edge/WebView2 版本匹配）：

```bash
mkdir -p e2e/.driver
EDGEDRIVER_CACHE_DIR="$PWD/e2e/.driver" npx edgedriver --version
```
