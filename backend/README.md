# Kuneco 账号服务

Go 1.26（Go 工具链自动下载）、标准库 HTTP、Google OAuth2 + OIDC、PostgreSQL（pgx 驱动、连接池）。代码及入口均在 backend/ 下。

## 本机运行

从项目根目录执行 `npm start` 会先检查本机账号后端：已就绪则复用，否则使用 Go 构建并启动，健康检查通过后打开 Kuneco 桌面应用。后端独立运行，关闭窗口不会停止它，日志位于 `backend/data/account-server.log`；启动失败时终端显示原因。配置远程 `WORKSPACE_ACCOUNT_SERVER_URL` 时不启动本机服务。也可单独执行 `npm run backend:start`；或在本目录执行 `go run ./cmd/server`。配置读取 `backend/.env`。首次使用请复制 `.env.example`，填写自己的数据库连接，并将文件权限设为 `0600`；`.env` 已加入 `.gitignore`，示例文件不包含数据库密码或加密密钥。Google 登录默认使用 `internal/server/google-oauth.json` 中随源码提交并嵌入二进制的共享 OAuth 客户端。在 `.env` 或进程环境中同时设置 `GOOGLE_CLIENT_ID` 与 `GOOGLE_CLIENT_SECRET` 可覆盖；两者留空使用内置配置，单独覆盖一个字段不会混用共享客户端的另一个字段。共享配置不包含用户 token、数据库密码或加密密钥。Google Cloud 测试模式下，仅配置的测试用户可登录；发布状态、回调地址与配额由 OAuth 客户端维护者管理。默认监听 127.0.0.1:8787，PUBLIC_URL=http://localhost:8787。客户端 WORKSPACE_ACCOUNT_SERVER_URL 默认为 http://localhost:8787。

Google Cloud 客户端类型选 Web 应用；授权重定向 URI 必须为 `http://localhost:8787/v1/auth/google/callback`。生产改为 HTTPS 域名后，同步调整 PUBLIC_URL、Google 回调和客户端服务器地址。

`npm run backend:build` 构建 backend/bin/account-server；`npm run backend:test` 执行 Go 竞态测试。账号、会话、登录记录及加密代理数据存储于 DATABASE_URL 指定的 PostgreSQL 数据库；backend/data/ 仅保存加密密钥和旧 SQLite 迁移备份。密钥 backend/data/encryption.key 必须与 PostgreSQL 数据一起备份。不能删除密钥后继续使用原加密配置。

## PostgreSQL 配置与迁移

准备项目独立 PostgreSQL 数据库和账号，在 backend/.env 配置 DATABASE_URL（格式见 .env.example）。新安装的示例使用 `kuneco` 数据库与 `kuneco_app` 专属角色；请自行创建并填写实际连接信息，密码只保存于本地配置。已有安装继续使用原数据库与角色（包括旧名称 `fixed_egress_workspace` / `fixed_egress_app`），无需因品牌改名重建数据库或迁移数据。缺少配置或数据库不可用时，服务启动失败，不回退 SQLite。远程数据库应使用 sslmode=verify-full 并配置受信任 CA；示例中的 sslmode=disable 仅用于本机回环地址。

首次启动自动初始化所需表及索引，应用角色需拥有该数据库/schema 的建表权限。连接池最多 10 个连接，连接超时 5 秒、语句超时 10 秒、锁等待 5 秒；健康检查会实际探测数据库，故障返回 503。同一 Google 用户的并发登录用事务锁串行，保留稳定用户 ID。

已有 SQLite 数据的迁移步骤：

1. 停止旧账号服务，用 sqlite3 的 `.backup` 备份 backend/data/accounts.db，并保留原 encryption.key。
2. 指向空 PostgreSQL 库，执行 `npm run backend:migrate-sqlite`；也可在 backend 执行 `go run ./cmd/migrate-sqlite -source data/accounts.db`。
3. 工具以只读快照读取旧库，事务导入四张表，保留用户 ID、会话摘要、登录事件 ID 和代理加密字节，调整事件序列。目标非空会拒绝导入，失败回滚。
4. 启动 PostgreSQL 版服务，验证原客户端登录及代理恢复；保留 SQLite 备份用于回滚，不删除密钥。

`npm run backend:test` 在真实 PostgreSQL 中创建随机独立 schema，完成后删除该测试 schema。优先使用 TEST_DATABASE_URL，否则读取本机 backend/.env；未配置数据库时集成测试会明确跳过。覆盖 OAuth、防串用户、代理加密、重连持久化、并发登录和 SQLite 导入。生产数据不用于测试写入。

## 登录与数据

客户端通过独立直连 HTTP Agent 请求账号服务，忽略应用代理及 HTTP_PROXY/HTTPS_PROXY。返回授权链接在系统浏览器中打开；Google 执行用户登录，服务端以 OAuth code + PKCE 换取 ID Token，并验证 Google 签名、issuer、audience、有效期和 nonce。state 与 HttpOnly SameSite Cookie 绑定；桌面轮询以另一个 PKCE challenge 绑定，防止其他客户端领取会话。

用户按 Google sub 唯一映射，保存邮箱及验证状态、名称、头像 URL、语言、创建及最近登录时间。每次登录记录 IP、来源、连接对端 IP 和 UA。会话令牌为随机值，仅在服务器存 SHA-256 摘要，30 天过期，退出删除会话；Google access/refresh token 不持久保存。

远程服务优先记录直连账号请求的 RemoteAddr。只有显式配置 TRUSTED_PROXY_CIDRS 才接纳可信反向代理链；忽略其他客户端伪造 X-Forwarded-For。本机开发服务看到的通常是 127.0.0.1，此时客户端经独立直连 ipify 的结果记录为 client_direct_probe，连接对端仍单独保存，不能宣称是服务器独立观察的公网 IP；检测失败标为未知。系统级 VPN/TUN 若接管流量，应用不能测到它之前的公网 IP。

代理配置以会话身份所属用户保存，不接收客户端指定的 user_id。密码随配置使用 AES-256-GCM 加密，AAD 绑定用户 ID。读取需登录；客户端只通过受保护主进程取回密码，渲染层恢复时只获得“密码已保存”，不展示秘密。客户端会话以 Electron safeStorage 加密至用户数据 account-session.bin。

填写完整有效代理后 700ms 防抖自动保存，IPRoyal 导入和连接时也保存。换账号或退出停止旧代理与任务，清空旧表单；登录后恢复当前用户配置，仍需手动连接并核验出口。账号接口的独立直连例外不改变浏览器/AI 的代理及禁止直连规则。

## 接口

- GET /health：健康及 OAuth 配置状态。
- POST /v1/auth/google/start、GET /v1/auth/google/authorize、GET /v1/auth/google/callback、POST /v1/auth/google/poll：OAuth 桌面握手。
- GET /v1/me：用户基础信息。
- GET /v1/me/avatar：受登录保护的 Google 头像（只允许 googleusercontent.com HTTPS，拒绝重定向及非图片）。
- POST /v1/auth/logout：撤销当前登录会话。
- GET/PUT /v1/me/proxy：当前用户代理配置。

后四类接口使用 Authorization: Bearer，浏览器页面无法通过 CORS 读取，渲染层不持有会话令牌。生产需部署 HTTPS、限制外部流量、备份数据与密钥。

## 品牌与已有数据兼容

对外应用名称为 Kuneco。macOS 开发启动器会在 `node_modules/.cache/kuneco-desktop/` 生成本机签名的 `Kuneco.app`，原生名称、可执行文件及版本对应项目配置，Bundle ID 为 `io.github.lofelin.kuneco`。这不是已签名公证的发行安装包；应用使用仓库中的 `kuneco.icns`；Dock 使用匹配的 `kuneco-macos.png`，保留透明留白与圆角。品牌原图 `kuneco.png` 用于界面；修改后在 macOS 执行 `npm run build:icon` 重新生成 PNG 与全部 ICNS 尺寸并提交，其他电脑启动无需生成。启动器根据 ICNS 内容更新本机缓存。

旧用户数据目录 `定途工作空间`、浏览器会话分区、Docker 容器/卷/引擎标识及 DeepSeek 配置目录继续保留。不要对这些内部标识做全局替换，也不要删除现有加密密钥；原生品牌信息与数据兼容身份分别管理。

### macOS 钥匙串名称迁移

首次升级启动会在取得单实例锁后、初始化加密存储前，将旧 `定途工作空间 Safe Storage` 条目中的同一密钥复制至 `Kuneco Safe Storage`。旧钥匙串条目及其访问控制保留用于回退，不删除或覆盖已有不同密钥。迁移工具只在原生进程内处理密钥，不输出密钥或通过命令行传递密钥。新条目仅信任本次 Kuneco 可执行文件及迁移工具，后续签名变化仍可能需要系统授权。开发运行首次编译工具需要 macOS Command Line Tools。

迁移前将原资料目录备份到同级 `Kuneco-keychain-backups/before-migration-*/profile`，备份目录仅当前用户可访问。加密文件原样保留，不进行明文导出或重新加密。启动时先验证全部本地账号缓存、对话缓存、连接记录、容器配置和旧代理密码可解密，再允许后台保存；浏览器 Cookie 使用同一密钥，并需通过实际浏览器登录状态验收。

取消系统授权、超时、密钥冲突、备份失败或解密失败都会停止启动，保留旧密钥和数据。成功后在原资料目录写入 `kuneco-keychain-migration-v1.json`，后续启动不再读取旧条目。不要删除旧钥匙串条目、备份或手工覆盖迁移记录。若需回退，可使用迁移前版本（仍以旧身份读取同一密钥）；资料目录无需重命名，备份恢复应在应用关闭后进行。
