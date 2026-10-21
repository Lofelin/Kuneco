# 容器浏览器隔离

受管理的 Docker 环境使用独立 Chromium 容器，Kuneco 桌面仅显示 CDP 图像帧和转发键鼠输入。目标页面的 JavaScript、字体、Canvas、WebGL、操作系统信息和站点存储在 Linux 容器执行，不在宿主的网页视图执行。桌面自身仍使用 Electron；改产品名称不等于移除真实桌面运行时依赖。

## 边界

- 容器与卷名由账号、环境 ID 派生；浏览器独占 profile 卷，仅与同账号、同环境工作容器共享 `/workspace` named volume；不挂载宿主项目 bind、工作容器 home、Docker socket、设备或 GPU。
- 浏览器使用环境专属内部网络；浏览器 IPv4 只放行当前模式对应的环境专属 HTTP 转发端点 TCP 8080，IPv6、外部 DNS 与其余连接均被防火墙阻断。使用应用代理时沿用原网关、认证和固定出口核验，失败停止访问。直接连接与自动选择通过同账号、同环境的独立出站转发容器访问公网；转发容器无宿主挂载、站点存储和公开端口，拒绝本机、私网及元数据地址。三种模式均可由用户主动选择，打开浏览器不改写当前选择。
- 控制通道使用 `docker exec` 的匿名管道，不公开调试端口。网页不能调用桌面 IPC；宿主视图只载入受 CSP 限制的本地画面查看器。
- 浏览器由非 root 用户执行，根目录只读，能力和资源受限。Chromium 已开启 namespace、PID/network namespace 和 Seccomp-BPF sandbox。启动前预检无特权 user namespace，再通过 `chrome://sandbox` 核验；失败即阻止浏览器启动，不降级为 `--no-sandbox`。Docker 仍启用 no-new-privileges 与专用 seccomp allowlist，不使用 privileged、SYS_ADMIN 或 seccomp=unconfined。Linux Chromium 的 network utility 不采用 renderer 同级沙箱，仍受外层 seccomp、防火墙和无能力约束；容器不等于绝对不可关联。
- 时区取自已核验出口对应的地区结果，无法取得时使用 UTC；语言取出口国家对应默认语言，无法识别时使用 en-US，不继承宿主设置。WebGL 使用容器的软件渲染。
- 输入仅在用户操作画面时转发；粘贴为用户主动触发的文本传输，不持续同步宿主剪贴板。上传、下载仅在当前环境 `/workspace` 处理，不打开宿主文件选择器、不使用宿主下载中转；扩展安装仍不支持宿主目录。

## 数据保留和兼容性

旧宿主浏览器分区保留，不清空或覆盖。新容器有独立站点存储；已启用的账号 Cookie 同步仍按原账号、环境范围恢复，不擅自切换同步方式或自动上传旧本地数据。旧本地站点存储不会冒充已迁入容器。

网页文件选择显示 Kuneco 容器路径弹窗，用户填写 `/workspace` 下普通文件路径；选中文件在容器内复制为专用只读上传快照，再交给 Chromium 文件输入。单文件上限 512 MB，拒绝越界路径、符号链接到工作区外、目录与特殊文件。文件夹上传和一次选择多个文件尚未支持。下载由 Chromium 直接接收到浏览器卷隔离暂存目录，按现有下载设置询问最终路径，再在容器内原子保存到 `/workspace/Download` 或用户选择的工作区路径；不覆盖同名文件，拒绝目录符号链接，单文件上限 512 MB。取消、账号环境切换和引擎关闭会取消进行中的下载；遗留临时文件在下次启动清理。下载记录仍按原账号和环境保存，菜单可查看容器路径，不隐式导出到宿主；目前不提供暂停/续传。原宿主扩展目录仍拒绝加载，禁止回退宿主网页执行。专用 worker 可做纯计算，时区和语言独立；不支持 Fetch 拦截的 worker 会先阻断全部网络，再恢复计算，fetch/importScripts 请求会失败。原本机环境的能力不变。容器网页权限默认拒绝；真实网站、iframe、worker、弹窗及复杂输入的兼容性必须分别验收，不能只靠构建或模拟测试声称完成迁移。

## 验收

执行 `npm run check`、浏览器与代理单元、品牌包签名检查以及桌面回归。重新启动 Kuneco 后，用当前真实环境访问 https://ip.net.coffee/claude/，核对实际出口与固定记录一致、时区和语言不再继承宿主、系统为 Linux、WebGL 不包含 Apple GPU；另外验证浏览器本体无法绕过转发端点访问公网、DNS或宿主地址，不同账号环境存储不串用；三种模式可切换并真实访问，使用应用代理时断开不回退。自动选择优先代理，只在业务请求发送前的建连阶段失败时尝试直连，成功线路按域名固定；发送过的请求不重放。模拟测试和真实网站结果必须分开记录。

## Seccomp 来源

`docker/browser/seccomp.json` 基于 [Moby profiles 固定版本](https://github.com/moby/profiles/blob/6fe7deb1b9fb7c0397a4593480d7d22b9ee8caef/seccomp/default.json)（Apache-2.0），仅增加 Chromium 所需的受限 clone USER/PID/NET namespace、unshare(CLONE_NEWUSER) 与 chroot；未放宽 setns、mount 或其他 namespace。修改策略必须复测真实 sandbox 和防火墙负例。

文件与 sandbox 专项实测：`node test/integration/test-container-browser-files.mjs`。该测试创建独立临时环境，验证真实文件字节、越界与符号链接拒绝、禁止覆盖、sandbox 状态、代理中断及禁止直连；不会读取或改写用户代理配置。

三模式专项验收：`node test/integration/test-container-browser-modes.mjs`。创建临时环境，验证真实 Chromium 的代理优先、直连出口、自动选择建连回退、模式间存储保留以及私有网络边界，不修改用户代理。直接连接使用 UTC / en-US，不继承宿主设置。
