<!-- README_SYNC: source=working-tree; updated=2026-10-21 -->

[English](README.md) · **简体中文**

# Kuneco

**把 AI 对话、记忆、浏览器和工作环境放在同一个桌面空间。**

接入 Claude Code、Codex 与 DeepSeek，在本机和容器环境中工作，让不同运行时延续你的偏好与项目约定。

[Star 收藏](https://github.com/Lofelin/Kuneco) · [反馈问题](https://github.com/Lofelin/Kuneco/issues) · [版本 0.1.0](package.json)

[![GitHub Stars](https://img.shields.io/github/stars/Lofelin/Kuneco?style=flat)](https://github.com/Lofelin/Kuneco)
[![GitHub Forks](https://img.shields.io/github/forks/Lofelin/Kuneco?style=flat)](https://github.com/Lofelin/Kuneco/forks)
[![GitHub Issues](https://img.shields.io/github/issues/Lofelin/Kuneco?style=flat)](https://github.com/Lofelin/Kuneco/issues)

![Kuneco 运行时选择](docs/operations/media/runtimes.jpg)

[自动化配置](docs/operations/media/automation.jpg) · [偏好设置](docs/operations/media/preferences.jpg)

*真实桌面界面截图。*

## 核心功能

| 能力 | 可以做什么 |
| --- | --- |
| 多运行时对话 | 接入 Claude Code、Codex，在托管容器中配置 DeepSeek API；按账号和环境管理会话。 |
| 记忆库 | 自动整理偏好、事实与项目约定，在后续对话中跨运行时召回，并保留来源和修订。 |
| 独立工作环境 | 管理本机与 Docker 环境，分别维护运行时、登录状态和工作数据。 |
| 内置浏览器 | 在工作空间内浏览网页；托管环境使用独立 Chromium 容器，上传下载留在环境内。 |
| 代理管理 | 导入代理与订阅节点，为每个环境保存多套配置，核验出口后连接。 |
| 定时对话 | 按计划发送预设问题，指定运行时，保存回复并查看执行状态。 |

可用运行时取决于当前环境的安装与认证状态，选择器中的入口不代表已经可以使用。

### 让不同运行时延续同一份记忆

在「智能 → 记忆库」中，可以集中管理对话里值得长期保留的内容。例如，你在一次对话中确定项目的文档语言，相关约定提取成功后，后续在同一账号、环境和适用项目中使用其他运行时，也可以召回这条约定。

- **自动整理**：从成功完成的对话中提取记忆，保留用户原文作为来源；相同内容合并来源。
- **按需召回**：请求前选择相关且启用的记忆，可将重要条目标记为「始终读取」。
- **可追溯、可修正**：搜索筛选、编辑、启停、查看修订历史；每条来源默认收起，展开后可查看原文或打开来源对话。
- **保留你的决定**：自动提取与手动维护的内容冲突时，由你选择保留现有内容或采用新约定；移除的记忆可以恢复。

记忆按账号和环境隔离，项目专用记忆还按项目路径匹配。自动提取和请求前召回可以分别关闭，更多说明见[记忆库文档](docs/operations/memory-library.md)。

## 日常使用

1. **选择环境**：在本机与托管 Docker 环境之间选择；首次使用容器时按提示初始化引擎。
2. **准备运行时**：检测、安装或配置 AI 工具，完成服务商登录或 API 设置。Kuneco 账号与运行时认证相互独立。
3. **开始工作**：选择连接方式，在对话、浏览器和控制台之间切换。代理模式需先完成出口核验。
4. **延续工作**：继续已有会话，检查自动整理的记忆，或为重复性的提问配置定时对话。

定时对话需要应用保持运行；关闭应用不会执行或补发，切换账号或环境后会等待原环境恢复。

## 从源码启动

目前面向 **macOS** 开发运行，发行安装包及 Windows / Linux 尚未验证。需要兼容依赖的 Node.js / npm、macOS Command Line Tools；本机账号服务还需要 Go 1.26 和 PostgreSQL。

```bash
git clone https://github.com/Lofelin/Kuneco.git
cd Kuneco
npm ci
cp -n backend/.env.example backend/.env
chmod 600 backend/.env
```

创建 PostgreSQL 数据库，在 `backend/.env` 中配置 `DATABASE_URL`，然后启动：

```bash
npm start
```

启动器会构建界面并启动或复用账号服务；关闭桌面窗口后，账号服务仍独立运行。连接已有远程服务可设置 `WORKSPACE_ACCOUNT_SERVER_URL`。数据库配置和 Google 登录说明见[账号服务指南](backend/README.md)。

## 数据与连接边界

- **记忆保存在本机**：加密存储，不跨设备同步。自动提取会产生额外模型请求，召回内容也会随对话发送给所选运行时。
- **环境各自独立**：运行时凭据保留在所属环境，不自动复制本机登录；直接在控制台启动的 CLI 不会自动接入统一记忆服务。
- **代理失败即阻断**：代理模式不自动回退直连；本机支持的直连与自动模式需明确选择，托管容器浏览器不回退直连。这些控制不等同于系统级防火墙，账号服务使用独立连接。

## 文档与开发

桌面端使用 Electron、JavaScript 和 Web Awesome，账号服务使用 Go 与 PostgreSQL，托管环境基于 Docker / Colima / Lima。

| 命令 | 用途 |
| --- | --- |
| `npm run check` | 构建资源并检查 JavaScript 语法 |
| `npm test` | 单元与契约测试 |
| `npm run test:desktop` | 桌面验收，需要图形会话 |
| `npm run backend:test` | Go 测试及竞态检查 |
| `npm run test:docker` | 容器与网络集成验收，需要容器引擎 |

后端集成测试需要数据库配置；构建和单元测试通过不代表真实模型或服务商登录已验证。

[记忆库](docs/operations/memory-library.md) · [容器浏览器](docs/architecture/container-browser.md) · [代理配置](docs/operations/subscription-proxies.md) · [仓库结构](docs/architecture/repository-layout.md) · [开发约定](AGENTS.md)

欢迎通过 [Issue](https://github.com/Lofelin/Kuneco/issues) 反馈问题，附上环境与复现步骤，并移除日志中的凭据和私人内容。

项目正在开发中，仓库暂无项目级 `LICENSE`；第三方依赖与资源遵循各自许可证。
