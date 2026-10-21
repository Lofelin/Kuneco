<!-- README_SYNC: source=working-tree; updated=2026-10-21 -->

[English](README.md) · **简体中文**

# Kuneco

**在一个桌面工作空间里使用 Claude Code、Codex 与 DeepSeek，按账号和环境管理对话、浏览器与连接。**

如果你也在多个 AI 工具和工作环境之间切换，欢迎 [Star Kuneco](https://github.com/Lofelin/Kuneco)，方便下次找到它。

[版本 0.1.0](package.json) · macOS · 开发中 · [Issues](https://github.com/Lofelin/Kuneco/issues)

使用多个 AI 工具时，真正需要一起管理的还有项目目录、登录状态、浏览器和网络连接。Kuneco 把这些放进同一个桌面应用：先选工作环境，再选运行时，在同一处完成对话、浏览和环境配置。

适合希望从源码运行、同时使用多种 AI 工具，并需要区分本机与容器工作环境的开发者。

> 项目正在持续开发。以下说明对应当前工作树；开发启动流程面向 macOS，发行安装包及 Windows / Linux 支持尚未完成验证。Kuneco 账号与 AI 服务商认证相互独立。

## 一个环境，一套工作上下文

- **在不同运行时之间工作。** 接入 Claude Code、Codex，并在托管容器中配置 DeepSeek API；可用运行时取决于当前环境的安装与认证状态。
- **让浏览器跟着环境走。** 本机环境使用桌面内置浏览器；受管理的 Docker 环境使用独立 Chromium 容器，网页在容器执行，上传下载留在该环境的 `/workspace`。
- **跨运行时保留有来源的记忆。** 统一记忆库按账号和环境隔离，支持对已完成对话自动提取、请求前召回、查看来源和处理冲突。记忆加密保存在本机，不跨设备同步；提取与召回均可关闭。
- **明确控制连接。** 支持代理导入、订阅节点和每个环境的多个已保存配置。代理先核验出口再开放转发，失败时阻断；托管容器浏览器不回退直连。
- **接着已有工作继续。** 按账号和环境组织对话，支持本机恢复与账号服务同步；记忆库、代理配置列表等本机数据有各自的存储范围，不代表所有数据都会同步。

## 开始使用

### 准备工作

- macOS：当前桌面开发流程支持的平台。
- Node.js 与 npm：版本需兼容 `package-lock.json` 中的依赖。
- macOS Command Line Tools：用于启动时的原生集成构建。
- 本机账号服务需要 Go 1.26 和 PostgreSQL；Google 登录默认使用项目内置 OAuth 客户端。
- 你要使用的 AI 运行时或服务商 API Key。AI 工具的认证与 Kuneco 账号登录相互独立。

### 从源码启动

```bash
git clone https://github.com/Lofelin/Kuneco.git
cd Kuneco
npm ci
cp -n backend/.env.example backend/.env
chmod 600 backend/.env
```

创建 PostgreSQL 数据库，在 `backend/.env` 中填写 `DATABASE_URL`。Google 登录默认使用随源码提交的共享 OAuth 客户端，无需复制其他电脑的 `.env`。如需使用自己的 OAuth 客户端，请同时填写 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET`，并登记回调地址：

```text
http://localhost:8787/v1/auth/google/callback
```

然后启动应用：

```bash
npm start
```

启动器会构建界面，启动或复用本机账号服务，再打开 Kuneco。关闭桌面窗口后，账号服务仍会继续运行。如需连接已有的远程服务，可设置 `WORKSPACE_ACCOUNT_SERVER_URL`。

配置、数据库和部署细节见[账号服务指南](backend/README.md)。数据库密码、加密密钥和用户令牌保存在本地；共享 Google OAuth 客户端位于 `backend/internal/server/google-oauth.json`，并编译进账号服务。Google Cloud 若处于测试模式，新账号需要加入测试用户；发布状态、回调地址与配额由客户端维护者管理。

### 建立你的工作空间

1. 登录 Kuneco，选择或创建一个环境。
2. 打开「运行时」，检测、安装或配置支持的 AI 工具，完成对应的登录或 API 设置。
3. 选择连接方式。使用代理时，先添加代理并核验出口 IP。
4. 开始对话，或打开一个浏览器标签页。

使用托管 Docker 环境时，按提示初始化容器引擎。运行时凭据保留在各自环境中，不会自动复制本机的登录信息。

## 连接与数据边界

代理模式会检查上游出口 IP，核验失败时阻断转发，不会悄悄改为直连。直连与自动模式需要明确选择；自动模式可能使用直连。

这些控制作用于应用管理的请求和支持的运行时环境，并非系统级防火墙。固定的代理地址也不意味着服务商会永久分配同一个出口 IP。账号服务使用独立连接，不经过工作空间代理。

容器浏览器目前不支持文件夹上传、一次选择多个文件或下载暂停/续传。记忆自动提取会调用本轮使用的运行时与模型，产生额外模型请求；它不是离线提取。召回内容也会随对话请求发送给所选运行时。直接在控制台启动的 CLI 不会自动接入统一记忆服务。

进一步了解：[容器浏览器隔离](docs/architecture/container-browser.md) · [记忆库](docs/operations/memory-library.md) · [订阅代理](docs/operations/subscription-proxies.md) · [浏览器设置](docs/operations/browser-settings.md)。

## 参与开发

桌面端使用 Electron 与 JavaScript，界面组件基于 Web Awesome；账号服务使用 Go 和 PostgreSQL；托管容器由 Docker / Colima / Lima 提供支持。

| 命令 | 用途 |
| --- | --- |
| `npm start` | 构建界面并启动桌面应用 |
| `npm run check` | 构建界面资源并检查 JavaScript 语法 |
| `npm test` | 运行 Node.js 测试 |
| `npm run test:desktop` | 运行 Kuneco 桌面验收 |
| `npm run backend:test` | 运行 Go 测试及竞态检查 |
| `npm run test:docker` | 验证容器环境与网络行为 |
| `npm run validate` | 运行检查、Node 测试、桌面冒烟测试及 CLI 握手验证 |

桌面测试需要图形会话，容器测试需要容器引擎，后端集成测试需要测试数据库配置。CLI 握手通过不代表真实模型请求一定成功。

```text
src/        桌面应用、浏览器、运行时接入与共享组件
backend/    账号服务、认证与数据存储
docker/     容器运行时、代理网关与隔离浏览器
scripts/    构建、安装、维护与评测工具
test/       自动化测试与验收脚本
```

修改共享组件或应用行为前，请阅读 [AGENTS.md](AGENTS.md)。此前的实现细节和验收记录保留在[历史技术记录](docs/archive/legacy-notes.zh-CN.md)中，记录对应不同开发阶段，不作为当前版本的完整能力保证。

## 接下来的方向

Kuneco 希望成为不同平台 AI 智能体共同工作的空间。跨智能体协作是项目持续探索的方向，具体接入能力会逐步完善。

遇到问题或有新想法，欢迎[提交 Issue](https://github.com/Lofelin/Kuneco/issues)，说说你想完成什么、使用的环境，以及实际发生了什么。分享日志前，请移除凭据和私人对话内容。

目录职责和依赖规则见[仓库组织](docs/architecture/repository-layout.md)。

## 许可

仓库目前没有项目级 `LICENSE` 文件；依赖与第三方资源遵循各自许可证。

如果 Kuneco 适合你的工作方式，欢迎 [Star](https://github.com/Lofelin/Kuneco) 收藏，或通过 [Issue](https://github.com/Lofelin/Kuneco/issues) 反馈实际使用中的问题。
