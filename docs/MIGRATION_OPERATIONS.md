# 数据库迁移与升级操作

InfraNexus 的数据库变更由 `backend/internal/bootstrap/migrate.go` 中按版本注册的迁移执行。每个版本号写入 `schema_migrations`，记录和对应 DDL/数据回填处于同一事务；失败时记录回滚，服务下次启动可重试。已经完成的版本会跳过，后续 schema 变更必须新增版本，不能修改已发布迁移的语义。

## 生产升级顺序

1. 确认数据库连接、磁盘空间、迁移版本和回滚负责人；先在与生产相同数据库类型及版本的副本上演练。
2. 创建并验证可恢复备份。SQLite 使用 `.backup` 到另一磁盘；PostgreSQL 使用 custom 格式的 `pg_dump`，并通过 `pg_restore --list` 检查归档。保留应用配置和密钥的受控备份，不把凭据写进命令历史。
3. 停止或摘除所有旧版本应用实例，确认没有旧版本仍能接受请求。M1 引入 `auth_version` 撤销校验，不能让忽略该字段的旧版本与新版本混跑。
4. 使用新版本二进制启动一次迁移并确认启动成功、`schema_migrations` 中包含预期版本。再启动新版本实例并执行登录、当前用户、用户停用/启用和健康检查。
5. 记录迁移版本、备份标识、应用版本、验证结果与操作者。迁移完成前不要开放流量。

SQLite 备份示例：

```sh
sqlite3 ./data/infranexus.db '.backup ./data/infranexus-pre-upgrade.db'
sqlite3 ./data/infranexus-pre-upgrade.db 'PRAGMA integrity_check;'
```

PostgreSQL 备份示例（从受控环境读取 `DATABASE_URL`）：

```sh
pg_dump --format=custom --file=infranexus-pre-upgrade.dump "$DATABASE_URL"
pg_restore --list infranexus-pre-upgrade.dump
```

## 认证凭据与混合版本

存量用户的 `auth_version` 小于 1 或为空时回填为 1。新签发的 Cookie Session、Access Token、Refresh Token 都绑定此版本；账号停用和本地密码重置会原子增加版本，启用账号不会把版本降回去。旧格式中没有有效版本的凭据会被拒绝，用户需重新登录。

旧版实例不校验 `auth_version`，因此滚动升级的重叠窗口会破坏停用/改密后的撤销保证。升级需先停止旧实例，再迁移和启动新版本。若新版本发布需要回退，优先修复前向版本或在网关暂时关闭认证写入/登录入口；不要恢复升级前数据库后直接开放旧实例，因为数据库恢复可能复活已撤销凭据和旧业务数据。只有在完成凭据失效处理并验证旧版本兼容后，才可回退应用二进制。

## 失败恢复

- 迁移启动失败时，保留数据库现场和日志；检查该版本迁移的错误原因。事务回滚后修复问题并重试同一版本。
- 已提交版本不能通过删除 `schema_migrations` 行来强制重跑。需要通过新版本迁移做前向修复，保持旧迁移不可变。
- 恢复备份属于灾难恢复操作，会回退备份时间之后的业务写入和认证撤销状态。恢复后先隔离流量、轮换受影响凭据或提高所有用户 `auth_version`，再执行一致性检查并开放服务。
