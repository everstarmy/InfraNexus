# 位置、IPAM、制造商与供应商后端接口

接口统一位于 `/api/v1` 下，沿用现有 Cookie / Bearer 认证、可信来源检查、角色授权和响应信封。数据中心和地址空间是业务关系，角色只按授权的菜单、按钮和 API 访问。数据库使用 PostgreSQL，版本化迁移 `20261109_v05_dcim_foundation` 创建基础表、外键、约束及索引。

## 资源路径和关系

以下集合支持通用查询、写入和历史操作。四层空间树使用独立的统一接口，见下节。

| 集合路径 | 主要关系及字段 |
| --- | --- |
| `/locations/warehouses` | `datacenter_id`，可填 `contact_person` |
| `/locations/shelves` | `warehouse_id`、`layer_count`、`capacity` |
| `/locations/bins` | `shelf_id`、`layer`、`capacity` |
| `/locations/temporary-locations` | `datacenter_id`、`owner_id`。责任人必须为启用用户 |
| `/ipam/network-scopes` | 地址唯一性的边界。可填 `routing_domain_ref` |
| `/ipam/security-zones` | `datacenter_id` |
| `/ipam/subnets` | `network_scope_id`、`security_zone_id`、IPv4 `cidr`、`usage_type`、`is_allocatable`。可填 `gateway`、`vlan_id`、`dns_servers` |
| `/vendor-management/companies` | 名称、身份 `type`、备注，可填英文名、简称、官网和统一社会信用代码 |
| `/vendor-management/company-contacts` | `company_id` 外键、姓名、电话、邮箱、职务和备注，使用 `parent_id` 查询指定厂商的联系人 |

厂商身份 `1` 为制造商，`2` 为供应商，`3` 为双身份。列表过滤 `type=1` 返回 1 和 3，`type=2` 返回 2 和 3，`type=3` 仅返回 3。厂商与联系人分别使用 `vendor-management:companies` 和 `vendor-management:company-contacts` 权限。

网段用途支持 `bmc`、`storage_management`、`business_management`、`production`、`heartbeat`、`vip`、`other`。

## 四层位置接口

`/locations/nodes` 管理数据中心、楼栋、机房和机柜。节点使用 `uid/name/type/parent/ext`，另含状态、版本和时间字段。根节点的 `parent` 为 null。所有节点的上级在创建时确定，创建后固定。JSONB 字段定义见 [位置设计](LOCATION_REDESIGN_PLAN.md)。

| 方法与路径 | 请求和结果 |
| --- | --- |
| GET /locations/nodes | 分页直属子节点，`parent=root` 或省略时返回数据中心，支持 `type/status/search/floor/row/column` |
| GET /locations/nodes/search | 全局分页搜索，返回可见祖先路径 |
| GET /locations/nodes/:id | 节点详情，路径参数为节点 UID |
| POST /locations/nodes | 提交 `name/type/parent/ext`，支持 `Idempotency-Key` |
| PUT /locations/nodes/:id | 提交 `name/ext/version`，完整替换扩展属性 |
| PATCH /locations/nodes/:id/status | 提交 `status/version` |
| DELETE /locations/nodes/:id | 查询参数 `version`，软删除 |
| GET /locations/nodes/:id/history | 分页审计，含位置前后快照、操作人和请求 ID |
| GET /locations/nodes/:id/references | 返回引用类型和数量 |
| GET /locations/nodes/:id/units | 返回机柜 U 位 |
| PUT /locations/nodes/:id/security-zone | 提交 `security_zone_id/version`，null 清除关系 |

类型范围与路由操作权限同时生效。列表以名称、UID 稳定排序，每页最多 100 条。

## 通用接口

以下用 `{collection}` 表示表中的路径。

| 方法与路径 | 请求和结果 |
| --- | --- |
| `GET {collection}` | `page`、`page_size`、`search`、`status`、`parent_id`。按名称搜索，按名称、创建时间和 ID 稳定排序 |
| `GET {collection}/:id` | 返回记录及当前 `version` |
| `GET {collection}/:id/references` | 按引用资源及字段返回计数 |
| `GET {collection}/:id/history` | 分页返回操作人、请求 ID、版本及操作时间。证书历史含版本快照 |
| `POST {collection}` | 对象 JSON，包含 `name`、可选 `description` 和资源字段。新增状态为 1，版本为 1 |
| `PUT {collection}/:id` | `{"expected_version":1,"data":{...}}`。完整替换可编辑字段，成功后版本递增 |
| `PATCH {collection}/:id/status` | `{"expected_version":1,"status":2}`。1 为启用，2 为停用 |
| `DELETE {collection}/:id?expected_version=1` | 仅可删除无引用及保留要求的记录。证书使用停用保留版本 |

创建也可传 `Idempotency-Key`。同一操作者、操作及键的重复请求返回原结果，请求内容变化返回 409。并发编辑使用版本检查。受引用的上级不能删除或重挂，有启用子项的上级须先停用子项。厂商可以在关联联系人仍启用时停用，联系人状态和归属保持原样。有联系人关联的厂商仍受删除保护。响应码 `404007` 表示基础记录不存在，版本或引用冲突返回 `409001`。

## 机柜和 IPAM

- `GET /locations/nodes/:id/units` 返回从高位到低位的共享 U 位视图。缩容不能截断占用或预留的 U 位。库位层号不能超过货架层数。
- 子网 CIDR 规范化后，同一地址空间内可分配子网不可重叠。不同隔离空间可重复使用同一地址段。规划前缀不生成池。子网支持按 `parent_id`（地址空间）、`security_zone_id` 和 `usage_type` 筛选。
- `GET /ipam/subnets/:id/addresses` 按 IPv4 数值分页。仅保存有变更或冲突事实的地址，无需为大网段逐一建行。单地址详情为 `GET /ipam/subnets/:id/addresses/:address`。
- `PATCH /ipam/subnets/:id/addresses/:address/reservation` 接受 `expected_version`、布尔值 `reserved` 和 `reason`。未持久化地址的版本为 0。网络地址、广播地址及网关由子网属性推导，不能作为人工保留操作目标。对 /31 和 /32 不套用首尾地址保留规则。
- 地址详情后缀 `/conflicts` 支持 GET 查询和 POST 报告。报告包含 `observed_identity`、`evidence_ref`、`observed_at`。用 `PATCH /conflicts/:conflictID/resolve` 提交处置原因。冲突独立于分配状态，解除冲突后原有人工保留仍生效。
- 地址详情后缀 `/history` 返回人工保留及冲突事件。设备/逻辑系统的分配、冷却和历史回放随资产及工单批次接入。当前接口不会在无资产和工单证据的情况下修改占用状态。

## 授权

基础菜单为 `locations`、`ipam`、`vendor-management`。位置树通过 `locations:nodes` 下的操作权限和 `locations:nodes:type:<type>` 范围共同授权。仓储等通用资源可分别授权查询、历史、创建、更新、启停、删除。子网额外有 `reserve` 和 `conflicts` 写权限。每个实际路由均登记对应的 API 权限。账号或角色无需另外绑定数据中心。

设备型号、资产、工单、合同履约和库存联动属于后续开发批次。本批提供它们所需的基础档案及引用约束。
