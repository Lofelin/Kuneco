# 仓库目录与能力边界

Kuneco 采用单仓库、按能力组织的目录。参考字节公开项目 [FlowGram](https://github.com/bytedance/flowgram.ai/tree/main/packages) 对 runtime、plugins、materials、engine 等能力的分组方式；这不是字节内部统一规范，也不要求每个目录成为独立 npm 包。

## 目录职责

| 目录 | 职责 |
| --- | --- |
| `src/app/` | Electron 主进程、预加载、渲染装配、启动、桌面生命周期；负责连接能力模块 |
| `src/features/account/` | 账号访问、头像与资料统计 |
| `src/features/environments/` | 环境、容器生命周期、环境策略与镜像准备 |
| `src/features/browser/` | 浏览器路由、Cookie、页面策略与生成的 preload |
| `src/features/proxy/` | 代理内核、出口、连接记录与代理导入 |
| `src/features/chat/` | 对话状态、同步、消息、网络与内容渲染 |
| `src/features/runtimes/` | AI 运行时安装、认证、执行和提供方协议 |
| `src/features/memory/` | 账号与环境隔离的记忆库、分层摘要、本机加密持久化、语义索引及跨运行时上下文 |
| `src/features/automation/` | 自动化调度、题库及界面 |
| `src/features/preferences/` | 本设备偏好持久化、快捷键配置、阅读与动态效果、退出确认 |
| `src/features/notifications/` | 通知偏好、投递控制及设置界面 |
| `src/features/terminal/` | 终端会话与界面 |
| `src/features/projects/` | 项目文件选择、导入与挂载 |
| `src/shared/` | 不依赖具体业务的身份、日期等基础工具 |
| `src/shared/ui/` | 共享 Web Awesome 组件、主题、样式及 UI 工具 |
| `src/index.html` | 桌面文档入口；保留位置以稳定资源 URL 与存储来源 |
| `src/assets/`, `src/data/` | 品牌、图标等静态资源与策略数据 |
| `src/vendor/` | 构建生成的前端产物，禁止手改 |
| `backend/cmd/`, `backend/internal/` | 账号服务 Go 入口与内部包；保持 Go 标准结构 |
| `scripts/build/` | 前端、预加载、策略数据和引擎打包 |
| `scripts/setup/` | 开发依赖安装工具 |
| `scripts/maintenance/` | 显式执行、默认预览的本地运维工具 |
| `scripts/benchmarks/` | 性能及持续运行评测工具 |
| `test/unit/<能力>/` | 自动发现的单元及契约测试 |
| `test/e2e/` | Electron 界面及端到端验收 |
| `test/integration/` | 真实浏览器、容器、代理集成验收 |
| `test/live/` | 依赖真实账号/网络/AI 的在线验收，按需运行 |
| `docker/runtime/` | 容器运行时构建与执行入口 |
| `native/macos/` | macOS 原生集成源码 |
| `docs/architecture/`, `docs/operations/`, `docs/archive/` | 架构约定、运维说明、历史材料 |
| `vendor/`, `artifacts/` | 下载的引擎工具及本地验收产物，均不作为业务源码 |

根目录仅保留 README、AGENTS、包清单与工具需要的配置。`node_modules/`、`backend/bin/`、`backend/data/` 等依赖、构建结果和运行数据保持既定位置，不随源码重构迁移。

## 新代码归属

- 优先放入已有能力目录；新能力才新增目录，不按文件扩展名分类，也不建立兜底的 utils/services 大目录。
- `app` 装配能力，能力模块不得反向导入 `app`。`shared` 不依赖 `features`；跨能力引用须保持单向、直接、明确，避免循环依赖。
- 暂不增加转发文件或 barrel 全量导出层，不留下旧路径兼容壳。只修改必要路径，不在目录迁移中重写业务行为。
- 共享组件与样式仍按 AGENTS 全局规则管理，不因业务分包复制实现。
- 单元测试按能力与源码对应；真实环境验收明确区分 e2e、integration、live，不能混进默认单元测试。
- 脚本从仓库根目录运行。资源使用 `import.meta.url` 时按文件位置解析；仓库根路径与 Docker 镜像内路径必须分别处理。

## 验证入口

`npm run check` 检查构建与语法，`npm test` 执行能力目录下的单元/契约测试。`npm run test:desktop` 为独立桌面验收；真实账号、容器及网络测试按任务范围单独运行。目录迁移需检查 HTML/CSS 资源、Electron preload、容器 COPY、动态读取脚本、测试夹具及文档命令，并重启检查真实页面。
