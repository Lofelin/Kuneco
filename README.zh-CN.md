# Kuneco

**让 AI 工具、浏览器和工作环境，在一个地方协同工作。**

[English](README.md) · **简体中文**

Kuneco 将 AI 对话、内置浏览器、本机与容器环境，以及代理设置放进同一个桌面工作空间。常用工具随手可用，不同环境各有自己的工作空间。

我们希望逐步让不同平台的 AI 智能体更容易协作。现在，先把它们工作所需的环境做好。

> Kuneco 正在持续开发中。目前的开发运行流程面向 macOS，安装包发布及 Windows / Linux 支持尚未完成验证。

## 可以用它做什么

- **使用不同的 AI 工具。** 接入 Claude Code、Codex 运行时，也可以在托管容器中配置 DeepSeek API。可用工具取决于当前环境及其配置。
- **分开管理工作环境。** 在本机与 Docker 环境之间切换，分别管理运行时、浏览器会话和工作数据。
- **边工作，边浏览。** 内置 Chromium 浏览器，支持多标签、历史记录和下载。
- **选择连接方式。** 配置代理、导入 TXT / CSV 代理列表，并在支持的场景中选择代理、直连或自动线路。
- **继续之前的对话。** 按账号和环境组织对话，支持本机恢复与账号云端同步。

## 开始使用

### 准备工作

- macOS：当前桌面开发流程支持的平台。
- Node.js 与 npm：版本需兼容 `package-lock.json` 中的依赖。
- 本机账号服务需要 Go 1.26 和 PostgreSQL；启用登录还需要 Google OAuth 凭据。
- 你要使用的 AI 运行时或服务商 API Key。AI 工具的认证与 Kuneco 账号登录相互独立。

### 从源码启动

```bash
git clone https://github.com/Lofelin/Kuneco.git
cd Kuneco
npm ci
cp backend/.env.example backend/.env
```

创建 PostgreSQL 数据库，在 `backend/.env` 中填写 `DATABASE_URL`。如需 Google 登录，还要填写 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET`，并在 OAuth 客户端中登记回调地址：

```text
http://localhost:8787/v1/auth/google/callback
```

然后启动应用：

```bash
npm start
```

启动器会构建界面，启动或复用本机账号服务，再打开 Electron。关闭桌面窗口后，账号服务仍会继续运行。如需连接已有的远程服务，可设置 `WORKSPACE_ACCOUNT_SERVER_URL`。

配置、数据库和部署细节见[账号服务指南](backend/README.md)。凭据只保存在本地配置中，不要提交到版本控制。

### 建立你的工作空间

1. 登录 Kuneco，选择或创建一个环境。
2. 打开「运行时」，检测、安装或配置支持的 AI 工具，完成对应的登录或 API 设置。
3. 选择连接方式。使用代理时，先添加代理并核验出口 IP。
4. 开始对话，或打开一个浏览器标签页。

使用托管 Docker 环境时，按提示初始化容器引擎。运行时凭据保留在各自环境中，不会自动复制本机的登录信息。

## 关于连接方式

代理模式会检查上游出口 IP，核验失败时阻断转发，不会悄悄改为直连。直连与自动模式需要明确选择；自动模式可能使用直连。

这些控制作用于应用管理的请求和支持的运行时环境，并非系统级防火墙。固定的代理地址也不意味着服务商会永久分配同一个出口 IP。账号服务使用独立连接，不经过工作空间代理。

## 参与开发

桌面端使用 Electron 与 JavaScript，界面组件基于 Web Awesome；账号服务使用 Go 和 PostgreSQL；托管容器由 Docker / Colima / Lima 提供支持。

| 命令 | 用途 |
| --- | --- |
| `npm start` | 构建界面并启动桌面应用 |
| `npm run check` | 构建界面资源并检查 JavaScript 语法 |
| `npm test` | 运行 Node.js 测试 |
| `npm run test:desktop` | 运行 Electron 桌面冒烟测试 |
| `npm run backend:test` | 运行 Go 测试及竞态检查 |
| `npm run test:docker` | 验证容器环境与网络行为 |
| `npm run validate` | 运行检查、Node 测试、桌面冒烟测试及 CLI 握手验证 |

桌面测试需要图形会话，容器测试需要容器引擎，后端集成测试需要测试数据库配置。CLI 握手通过不代表真实模型请求一定成功。

```text
src/        桌面应用、浏览器、运行时接入与共享组件
backend/    账号服务、认证与数据存储
docker/     容器运行时与代理网关
scripts/    构建与开发工具
test/       自动化测试与验收脚本
```

修改共享组件或应用行为前，请阅读 [AGENTS.md](AGENTS.md)。此前的实现细节和验收记录保留在[历史技术记录](docs/legacy-notes.zh-CN.md)中，记录对应不同开发阶段，不作为当前版本的完整能力保证。

## 接下来的方向

Kuneco 希望成为不同平台 AI 智能体共同工作的空间。跨智能体协作是项目持续探索的方向，具体接入能力会逐步完善。

遇到问题或有新想法，欢迎[提交 Issue](https://github.com/Lofelin/Kuneco/issues)，说说你想完成什么、使用的环境，以及实际发生了什么。分享日志前，请移除凭据和私人对话内容。
