# 容器镜像维护

Kuneco 的 worker / gateway 镜像随代码内容生成新版本。旧版本不会自动删除，避免影响正在运行的环境或升级回滚。维护命令位于 `scripts/maintenance/`（手动运维工具），不参与应用启动。

从仓库根目录执行预览，必须显式选择 Docker context：

```sh
node scripts/maintenance/cleanup-container-images.mjs --context colima-dingtu --preview /tmp/kuneco-image-preview.json
```

不传 `--preview FILE` 时仅输出 JSON，不写文件。预览文件必须尚不存在，避免覆盖此前审阅结果。检查 `candidates` 和 `retained` 后，按同一份预览执行：

```sh
node scripts/maintenance/cleanup-container-images.mjs --context colima-dingtu --apply /tmp/kuneco-image-preview.json
```

维护范围：

- 仅 `kuneco-worker:<20 位小写十六进制>`、`kuneco-gateway:<20 位小写十六进制>` 镜像。
- 每类按创建时间保留最近至少两个版本。所有容器（包括停止、回滚容器）引用的镜像均保留。
- 有多个标签或其他仓库摘要引用的镜像均保留（同名仓库的本地内容摘要不算额外共享）；基础镜像、无标签镜像、其他仓库均不处理。
- 执行前逐项重新检查镜像、所有容器引用和 Docker daemon 身份。候选变化则跳过；查询失败则停止。
- 按不可变镜像 ID 删除，不使用 `--force`、`system prune`、volume 删除或构建缓存清理。Docker 拒绝删除则停止并保留剩余候选；成功删除的项不会回滚。若需要继续，请重新预览。

`sizeBytes` 包含共享层，候选大小之和**不等于实际可回收磁盘空间**。清理不改变代理内核、固定出口、防火墙、账号数据卷或环境设置。请在没有环境升级/创建的空闲时段执行；并行新增的容器引用由再次检查和 Docker 非强制删除保护。
