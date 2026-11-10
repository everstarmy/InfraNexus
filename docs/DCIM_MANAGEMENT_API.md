# 位置、IPAM、制造商与供应商后端接口

接口统一位于 `/api/v1` 下，沿用现有 Cookie / Bearer 认证、可信来源检查、角色授权和响应信封。数据中心和地址空间是业务关系，角色只按授权的菜单、按钮和 API 访问。数据库使用 PostgreSQL，版本化迁移 `20261109_v05_dcim_foundation` 创建基础表、外键、约束及索引。

## 资源路径和关系

每个集合支持查询、写入和历史操作。位置层级通过各集合的 `parent_id` 查询逐级展开。机房的数据中心和机柜的机房由其上级推导。

| 集合路径 | 主要关系及字段 |
| --- | --- |
| `/locations/datacenters` | `kind` 为 `primary`、`metro_dr` 或 `remote_dr`。可填 `address`、`owner_id` |
| `/locations/buildings` | `datacenter_id` |
| `/locations/floors` | `building_id`、`level` |
| `/locations/rooms` | `floor_id`。同一数据中心内编码唯一 |
| `/locations/rack-rows` | `room_id` |
| `/locations/racks` | `rack_row_id`、`units`，可填 `max_load_kg`、`label`、`security_zone_id`。同一机房内编码唯一 |
| `/locations/warehouses` | `datacenter_id`，可填 `contact_person` |
| `/locations/shelves` | `warehouse_id`、`layer_count`、`capacity` |
| `/locations/bins` | `shelf_id`、`layer`、`capacity` |
| `/locations/temporary-locations` | `datacenter_id`、`owner_id`。责任人必须为启用用户 |
| `/ipam/network-scopes` | 地址唯一性的边界。可填 `routing_domain_ref` |
| `/ipam/security-zones` | `datacenter_id` |
| `/ipam/subnets` | `network_scope_id`、`security_zone_id`、IPv4 `cidr`、`usage_type`、`is_allocatable`。可填 `gateway`、`vlan_id`、`dns_servers` |
| `/ipam/rack-bindings` | `rack_id`、`subnet_id`、`usage_type`、`is_default` |
| `/vendor-management/manufacturers` | 可填 `english_name`、`logo_url`、`website`、`support_url`、`support_phone`、`enterprise_oid`、`protocols`、`serial_number_pattern` |
| `/vendor-management/vendors` | `credit_code`、`service_types`、`cooperation_status`。可填 `short_name`、`primary_contact_id`、派单渠道及分钟制响应时限 |
| `/vendor-management/contacts` | `manufacturer_id` 或 `vendor_id` 二选一，以及 `roles`。可填电话、邮箱、职务、证件类型、脱敏标识和准入申请引用 |
| `/vendor-management/qualifications` | `vendor_id`、`kind`、`certificate_type`、`certificate_no`、`valid_from`、`valid_until`、`evidence_ref`。原厂授权须填 `manufacturer_id` |
| `/vendor-management/contact-certifications` | `contact_id`、`issuer`、`certificate_no`、`valid_from`、`valid_until`，可填 `evidence_ref` |

日期格式为 `YYYY-MM-DD`。网段用途支持 `bmc`、`storage_management`、`business_management`、`production`、`heartbeat`、`vip`、`other`。供应商服务类型支持 `hardware_supplier`、`oem_service`、`third_party_maintenance`、`spare_parts`、`data_destruction`，合作状态支持 `active`、`suspended`、`terminated`。主联系人须为该供应商启用的 `account_manager`。联系人其余角色为 `resident_engineer`、`onsite_engineer`、`escalation_lead`、`commercial_contact`。资质类型为 `oem_authorization` 或 `media_destruction`。

## 通用接口

以下用 `{collection}` 表示表中的路径。

| 方法与路径 | 请求和结果 |
| --- | --- |
| `GET {collection}` | `page`、`page_size`、`search`、`status`、`parent_id`。搜索按编码及名称，分页稳定排序 |
| `GET {collection}/:id` | 返回记录及当前 `version` |
| `GET {collection}/:id/references` | 按引用资源及字段返回计数 |
| `GET {collection}/:id/history` | 分页返回操作人、请求 ID、版本及操作时间。证书历史含版本快照 |
| `POST {collection}` | 对象 JSON，包含 `code`、`name`、可选 `description` 和资源字段。新增状态为 1，版本为 1 |
| `PUT {collection}/:id` | `{"expected_version":1,"data":{...}}`。完整替换可编辑字段，成功后版本递增 |
| `PATCH {collection}/:id/status` | `{"expected_version":1,"status":2}`。1 为启用，2 为停用 |
| `DELETE {collection}/:id?expected_version=1` | 仅可删除无引用及保留要求的记录。证书使用停用保留版本 |
| `POST {collection}/import/preview` | `{"items":[...]}`，每批 1–100 条，返回按行编号的错误。预检事务回滚 |
| `POST {collection}/import` | 同预检格式，须传 `Idempotency-Key`。任一行失败整批回滚，响应的 `errors` 返回错误行 |
| `GET {collection}/export` | 按列表筛选导出 JSON，最多 1000 条。超限时缩小筛选条件 |

创建也可传 `Idempotency-Key`。同一操作者、操作及键的重复请求返回原结果，请求内容变化返回 409。并发编辑使用版本检查。受引用的上级不能删除或重挂，有启用子项的上级须先停用子项。响应码 `404007` 表示基础记录不存在，版本或引用冲突返回 `409001`。

## 机柜和 IPAM

- `GET /locations/racks/:id/units` 返回从高位到低位的共享 U 位视图。缩容不能截断占用或预留的 U 位。库位层号不能超过货架层数。
- 子网 CIDR 规范化后，同一地址空间内可分配子网不可重叠。不同隔离空间可重复使用同一地址段。规划前缀不生成池。子网支持按 `parent_id`（地址空间）、`security_zone_id` 和 `usage_type` 筛选。
- 机柜绑定校验所属数据中心、安全域和用途。查询 `/ipam/rack-bindings?parent_id=<rack-id>&status=1&usage_type=bmc` 可获得启用的候选绑定，默认绑定排在前面。同机柜同用途最多一个启用的默认绑定。
- `GET /ipam/subnets/:id/addresses` 按 IPv4 数值分页。仅保存有变更或冲突事实的地址，无需为大网段逐一建行。单地址详情为 `GET /ipam/subnets/:id/addresses/:address`。
- `PATCH /ipam/subnets/:id/addresses/:address/reservation` 接受 `expected_version`、布尔值 `reserved` 和 `reason`。未持久化地址的版本为 0。网络地址、广播地址及网关由子网属性推导，不能作为人工保留操作目标。对 /31 和 /32 不套用首尾地址保留规则。
- 地址详情后缀 `/conflicts` 支持 GET 查询和 POST 报告。报告包含 `observed_identity`、`evidence_ref`、`observed_at`。用 `PATCH /conflicts/:conflictID/resolve` 提交处置原因。冲突独立于分配状态，解除冲突后原有人工保留仍生效。
- 地址详情后缀 `/history` 返回人工保留及冲突事件。设备/逻辑系统的分配、冷却和历史回放随资产及工单批次接入。当前接口不会在无资产和工单证据的情况下修改占用状态。

## 授权

基础菜单为 `locations`、`ipam`、`vendor-management`。资源按钮前缀形如 `locations:datacenters`，可分别授权 `read`、`history`、`create`、`update`、`status`、`delete`、`import`、`export`。子网额外有 `reserve` 和 `conflicts` 写权限。每个实际路由均登记对应的 API 权限。账号或角色无需另外绑定数据中心。

设备型号、资产、工单、合同履约和库存联动属于后续开发批次。本批提供它们所需的基础档案及引用约束。
