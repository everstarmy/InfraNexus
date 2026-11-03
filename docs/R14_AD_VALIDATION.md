# R14 测试环境 AD 验收（2026-10-23）

本轮按用户确认的“尚无正式部署，按测试环境验收”收口。R13 人工 VoiceOver/NVDA 实测按明确要求豁免；不将豁免写成实测通过。R14 在下述范围完成，不等同生产 Ready for Release。

## 环境与边界

用户授权的外部测试 AD、专用一次性 Redis 8、SQLite 临时数据库及 PostgreSQL 17 一次性数据库。凭据仅运行时注入，不写入源码或证据。AD 操作仅 Bind、Search 和带证书校验的 StartTLS 能力探测；同步新增、缺失账号停用与撤权均在隔离应用数据库执行，没有修改 AD 条目或正式部署数据。

## 实际结果

| 检查 | 结果 |
| --- | --- |
| 目录服务与身份 | 服务绑定、有效密码认证、AD GUID/属性映射通过；5 用户，3 启用、2 停用。未进行错误密码压力探测。 |
| 真实分页 | RootDSE 命名上下文和分页控制通过；每页 2 条，3 页返回完整 5 用户集合，无重复/遗漏，GUID 长度正确。生产网关页大小仍为 500。 |
| JIT 与授权 | SQLite、PostgreSQL 均为 3 次并发有效登录→1 个完整档案及默认角色；撤权后全部已发令牌返回 403。 |
| 预览/同步 | 预览不写用户；创建 2 用户，停用 1 个仅存在于临时应用库的合成缺失账号；同幂等键返回同任务；再次全量预览无变更，增量预览无新增或缺失停用。 |
| SSE 与释放 | 真正 HTTP/Redis 事件流收到任务事件，断开重连补发相同结束事件 ID；应用在 3 秒停机预算内结束。 |
| 凭据保护 | API 不返回口令，存储为密文，应用日志不含绑定口令或已签发令牌。 |
| 只读审计 | SQLite/PostgreSQL 均执行只读事务；策略缺失/多余、LDAP 缺默认角色、部门断引用和成功任务计数异常最终全部为 0。PostgreSQL 强制事务只读。历史生产数据核查不适用。 |
| 加密能力 | AD 声明支持 StartTLS，但带证书校验的实际升级未成功；未跳过证书校验，不计为 TLS 验收通过，也不据此推断具体失败原因。 |

## 实测发现并修复

快速同步小于 500ms 时，所有中途进度写入可能被节流。旧逻辑只更新终态报告/状态，没有将最后的 processed/total 写入终态快照；SQLite 和 PostgreSQL 均出现任务成功但 processed 仍为 0 的情况。

`internal/service/ldap_service.go` 在终态保存前无条件写入实际已处理数量和总量；失败或取消保留实际数量，不强行填满进度。固定时钟回归 `TestLDAPSyncTerminalProgressBypassesThrottle` 在修复前稳定复现成功/部分失败的计数缺陷，修复后成功、部分失败、取消三种情况 `-race -count=3` 通过。随后重跑真实 AD 链路和只读审计，两个数据库均通过。首次失败结果不计为通过。

## 验证命令与复跑

正式测试源码位于 `backend/internal/bootstrap/ldap_live{,_directory,_audit}_test.go`；均显式启用。必须使用获授权目录和可丢弃的独立 Redis/PostgreSQL；环境缺失会 Skip，不能将 Skip 计为真实 AD 通过。PostgreSQL 选项使用空的专用数据库 `live_ad` 与用户 `live_ad`，测试会在其中迁移和写入应用数据。

```sh
cd backend
# 从受保护的运行时输入注入，避免口令进入命令历史或日志。
export INFRANEXUS_LIVE_AD_URL='<authorized LDAP or LDAPS URL>'
export INFRANEXUS_LIVE_AD_BIND_USER='<authorized bind identity>'
export INFRANEXUS_LIVE_AD_PASSWORD='<runtime secret>'
export INFRANEXUS_LIVE_AD_DOMAIN='<directory domain>'
export INFRANEXUS_LIVE_AD_BASE_DN='<authorized search base>'
export INFRANEXUS_LIVE_AD_REDIS_ADDR='127.0.0.1:<disposable Redis port>'
go test -race -count=1 -timeout=180s -v ./internal/bootstrap -run '^TestLiveAD'
# 使用新的空数据库；地址必须为 loopback。
export INFRANEXUS_LIVE_AD_POSTGRES_ADDR='127.0.0.1:<disposable PG port>'
export INFRANEXUS_LIVE_AD_POSTGRES_PASSWORD='<runtime disposable database secret>'
go test -race -count=1 -timeout=180s -v ./internal/bootstrap -run '^TestLiveADIsolatedApplicationLifecycle$'
```

本次 SQLite 三项真实 AD 测试实际执行并通过，包耗时 4.322 秒；PostgreSQL 应用链路实际执行并通过，包耗时 3.770 秒，均启用 race。可选 `INFRANEXUS_LIVE_AD_START_TLS=true` 用于将 StartTLS 作为连接必需条件，失败直接拒绝；本轮没有将其启用为已验收传输模式。未配置私有 CA 信任或关闭证书校验。

## 最终代码与镜像检查

修复后 `go test -race -count=1 -p=1 ./...` 全量通过（bootstrap 141.604 秒），`go vet ./...` 通过。该次全量未设置外部集成变量，可选集成用例会跳过；上文真实 AD SQLite/PostgreSQL 结果来自独立显式启用的运行，未将跳过计为通过。

后端正式 Dockerfile 重新构建通过，镜像 `infranexus/backend:local`，Linux/arm64，ID `sha256:d69c21582a3f9bc574bc756c0cfe11b39c65b72300365dd02c9e44ea3d7c43c4`。此次记录为构建验收，先前 Compose 部署证据见 Docker 文档。专用测试 Redis/PostgreSQL 容器与临时数据库口令文件已清理。

## 适用范围

本次 5 用户的跨页实测证明真实 cookie 往返和身份完整性，不能代替 500+ 用户真实目录压力验收；已有 1001 用户模拟服务回归仍作为独立证据保留。生产使用加密目录、不同反向代理或更高负载时需要相应验收。R13 人工读屏仅为豁免；前端源码未变，本轮沿用先前自动化前端证据。镜像漏洞扫描仍沿用 Docker 交付报告中的限制。

结构化结果见 [R14 证据](evidence/r14-ad-2026-10-23.json)。
