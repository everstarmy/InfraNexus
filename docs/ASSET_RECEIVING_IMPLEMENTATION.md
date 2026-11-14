# 到货验收后端实现与验证

日期：2026-11-14。范围：后端领域模型、PostgreSQL 迁移、服务、权限和 HTTP API；前端页面及组件移动操作留待后续开发。

## 已实现

- 组件与设备模型档案、草稿版本、发布冻结、标准配置、槽位及兼容关系。
- 到货单及计划行、开放收货、分批逐台验收、拒收、预检和最终提交。
- 设备 SN、JPEG/PNG 验收照片、库房/库位、实际组件配置；通过验收后按实际数量生成独立设备与组件资产。
- 不可变原始配置、当前安装关系、当前位置、按实物 ID 比较配置差异；组件 SN 可后补，保留补录审计。
- 完成验收、资产生成、照片基线绑定、数量更新、动作审计及幂等回执在同一数据库事务提交。
- 新增 76 个路由及对应权限，统一响应、分页、版本冲突和请求关联。图片内容读取同时检查附件权限和关联验收/设备的读取权限。

实现导航：[领域实体](../backend/internal/domain/receiving.go)、[路由](../backend/internal/domain/receiving_routes.go)、[服务入口](../backend/internal/service/receiving_service.go)、[数据库约束](../backend/internal/bootstrap/receiving_schema.sql)、[API 契约](ASSET_RECEIVING_API.md)。

## 存储与上线边界

新增迁移 `20261114_v13_asset_receiving` 由现有启动迁移流程执行。本次仅在独立临时 PostgreSQL 中执行验证，未迁移开发或生产数据库。

图片字节使用 PostgreSQL `bytea`，附件元数据查询不会加载字节，内容接口单独授权。单图不超过 10 MiB，每台最多 20 张，解码前限制 40 MP；暂不接入外部对象存储。后续迁移对象存储需补充上传确认、孤立文件清理和保留策略。

每份验收最多 50 台设备、4096 件组件。当前写事务使用模块级 advisory lock，并与基础档案修改协调，优先保证跨单据数量与位置一致性；读取使用共享锁。该方案会限制并发吞吐，尚未完成上限规模压测，不能据此承诺高吞吐性能。

原始配置、已发布模型、完成验收及事实审计由数据库约束保护。组件安装历史和当前位置分开持久化，预留移动事件；本批没有移动、上下架、退换货、盘点或采购财务接口。

## 验证覆盖

最终固定代码的 6 项验收场景与 OpenAPI 真实 PostgreSQL race 回归通过（75.869s），`go vet ./...` 通过。预计到货日期的数据库往返已纳入流程测试，保持 YYYY-MM-DD。OpenAPI 重复生成结果一致，既有 paths/schemas 的语义内容保持不变，文档链接与 diff 检查通过。

完整 bootstrap 集成回归运行 555.257s，报告下述既有 LDAP 迁移测试失败。其余后端包完成 race 验证；执行期间新增日期文件造成的旧编译文件清单问题已在代码固定后补跑消除。并行运行测试包时曾出现连接/创建 schema/清理 schema 的测试环境超时，最终按 `-p=1` 串行复测验收及 `TestEnsureRoutePermissionConcurrentSyncIsIdempotent` 均通过（仓储专项 2.273s），未将超时轮次记为通过。

真实 PostgreSQL 集成测试位于 [receiving_api_test.go](../backend/internal/bootstrap/receiving_api_test.go)：

| 测试 | 验证内容 |
| --- | --- |
| AtomicAcceptanceAndImmutableBaseline | 1 台设备生成 16 件组件、幂等重试、键冲突、SN 后补与重复拦截、原始配置/发布版本/完成单据不可改、配置读取与请求关联、历史分页 |
| ConcurrentRemainingQuantity | 两份草稿竞争最后 1 台待收额度，仅一份成功 |
| RollbackAndRoleBoundaries | 注入数据库失败后整体回滚、原键重试、路由权限覆盖、普通角色写入拒绝、附件父资源权限撤销 |
| ConfigurationHistorySurvivesFutureMovement | 通过数据库测试夹具移出 8 件并装入其他设备的 8 件，原始配置不变，差异为 8 移除/8 新增/8 保留；版本冲突及非法当前位置约束 |
| UsesActualComponentQuantity | 计划 16 根、实际 8 根：未说明差异不能提交，说明后只生成 8 件实物和 8 条原始配置记录 |
| BatchActualQuantityAndRejection | 计划 10 台，通过 6 台、拒收 1 台，生成 6 台/96 件，剩余 4 台；嵌套资源归属和缺 SN 筛选 |

组件移动测试只验证存储设计，不能视为已交付移动 API。领域设计中的完整验收清单、浏览器联调与批量压力测试未全部执行。

运行方式（使用隔离、可丢弃的测试数据库）：

```sh
INFRANEXUS_TEST_POSTGRES_DSN='<isolated-postgres-dsn>' go -C backend test -race -count=1 -p=1 ./...
go -C backend vet ./...
python3 scripts/generate-receiving-openapi.py
```

OpenAPI 生成器从固定路由清单和 Go DTO 生成本模块操作，保留既有模块；生成后检查引用完整性。既有真实 Redis 故障注入和真实 AD 联调需要各自专用环境，本次未配置，不作为已覆盖项。

## 已知既有回归问题

`TestLDAPTaskMigrationPreservesLegacySyncRows` 在历史迁移 `20261111_v06_retire_ipam_rack_subnet_binding` 查询缺失的 `permissions` 表时失败。已将当前 HEAD 的未修改后端导出至独立临时目录，在同一隔离 PostgreSQL 环境运行该单测，复现相同错误；因此不归因于本次验收模块，但完整后端回归不能标记为全绿。本次未修改该历史迁移或掩盖该测试。
