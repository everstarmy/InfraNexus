# 到货验收、模型与实物资产 API 契约

日期：2026-11-14。状态：已实现后端接口，前端页面尚未建设。领域与事务依据 [领域设计](ASSET_RECEIVING_DOMAIN.md)。本文定义前端交互契约；运行中 OpenAPI 已同步，路由和权限由同一注册表生成。使用 `python3 scripts/generate-receiving-openapi.py` 更新接口结构。接口上线需部署新版本并执行迁移，工作区代码不代表已部署。

## 1. 公共约定

- 全部业务路径前缀 `/api/v1`，Cookie/Bearer 认证沿用 [现有 API](API.md)。Cookie 写请求验证 Origin/Referer。权限只采用现有角色→菜单/按钮/API，不增加数据中心授权。
- 所有 JSON 成功响应 HTTP 200、code=200000；分页 `data={items,total,page,page_size}`，空集合为 `[]`。所有响应带 message、request_id、timestamp。图片内容下载例外：成功返回校验后的图片二进制，失败仍返回统一 JSON。
- ID 是 UUID；下文 `<...>` 仅是示例占位符。时间 RFC3339 UTC，未知字段显式 null；数值规格当前限定在 JavaScript 安全整数范围内，超出范围拒绝；未来支持更大容量时另行增加字符串表示，不能静默丢精度。
- 查询 page 默认 1、page_size 默认 20、最大 100；search 最大 128 字符；默认 created_at DESC,id DESC，事件 history 使用 recorded_at DESC,id DESC，操作审计使用 created_at DESC,id DESC。不承诺 offset 分页跨并发写入的快照一致性。
- 所有新增及业务命令 POST、序列号补录 PATCH、图片上传要求 `Idempotency-Key`（1～128 个可打印 ASCII 字符）。同一次用户动作重试复用键，不同动作换键。GET/preview 不要求。PUT/DELETE 通过 expected_version 防覆盖，响应不明时先 GET 核实结果，不盲目重放旧版本。
- 普通编辑采用 `{expected_version,data:{...}}`；业务命令采用 `{expected_version,...}`；DELETE 的 expected_version 在查询参数。未知输入字段拒绝，状态、审计人、资产 ID、累计数量、完成时间不得由客户端任意写入。
- receipt 的任何子资源写入均传父聚合 expected_version，响应返回 receipt_version；不另用子项版本。模型版本子资源同样由所属 revision.version 控制。两个人编辑不同子项也可能冲突，前端须保留草稿并重读合并。
- 编辑字段 PUT 为完整替换；PATCH 的可编辑字段在各接口明确列出。服务端输出的只读字段不能原样作为保存请求。

统一成功外壳：

```json
{
  "code": 200000,
  "message": "success",
  "data": {"id": "<uuid>", "version": 1},
  "request_id": "<request-id>",
  "timestamp": 1794614400
}
```

## 2. 元数据与选择器

| 方法与路径 | 用途 |
| --- | --- |
| GET `/asset-management/metadata` | 返回设备/组件类别、规格 schema、状态枚举、文件/批量限额、SN 规则说明、支持的能力 |
| GET `/vendor-management/companies?type=1&status=1` | 已有制造商选择器（包含双身份） |
| GET `/vendor-management/companies?type=2&status=1` | 已有供应商选择器 |
| GET `/locations/warehouses?status=1` | 已有库房选择器 |
| GET `/locations/shelves?parent_id=:warehouseID&status=1` | 已有货架选择器 |
| GET `/locations/bins?parent_id=:shelfID&status=1` | 已有库位选择器 |

metadata 的 data：`spec_schemas` 按组件 kind 或统一 device 键返回 schema_version 与 fields（字段名、JSON 类型、required、nullable、enum、单位与范围）；`limits` 包含 max_receipt_devices=50、max_receipt_components=4096、max_component_expand=512、max_photo_bytes=10485760、max_photos_per_item=20；`capabilities.component_movement=false`、`baseline_correction=false`。这些是初始设计值，前端读取元数据，不硬编码为永久值。

规格 schema v1 首批可编辑字段：

| 组件类型 | 字段（? 可空；未标可空者必填） |
| --- | --- |
| memory | capacity_bytes、memory_generation（DDR3/DDR4/DDR5）、speed_mt_s、ecc? |
| disk | capacity_bytes、interface（SATA/SAS/NVMe）、media_type（HDD/SSD）、form_factor? |
| cpu | socket?、cores?、threads?、base_frequency_mhz? |
| nic/hba | protocol?、port_count?、speed_mbps?、interface? |
| power_supply | rated_power_w?、input_type? |
| fan | form_factor?、rated_power_w? |
| controller | interface?、cache_bytes?、has_nonvolatile_cache? |
| optical_module | protocol?、connector?、speed_mbps?、wavelength_nm? |
| other | description?（最多 1024），不接受任意字段 |

所有已知数值 >0（cache_bytes 可为 0），布尔为 true/false/null；threads>=cores（均已知时）。接口/尺寸等未列枚举的字段为长度 ≤64 的受校验字符串。设备额外 spec v1：width_mm?、depth_mm?、weight_kg?、description?，非空数值 >0。通用 spec 都包含 schema_version=1，schema_version 与版本表字段必须一致。

## 3. 模型 API

资源集合 `C` 为 `/model-management/component-models` 或 `/model-management/device-models`。

| 方法与路径 | 请求/返回 |
| --- | --- |
| GET `C` | 支持 manufacturer_id、kind/category、status、search；分页模型摘要，含 latest_published_revision |
| POST `C` | 组件：manufacturer_id、part_no、name、kind、description?；设备：manufacturer_id、model_name、name、category、description?；返回身份档案，不自动发布版本 |
| GET `C/:id` | 档案、version、latest_published_revision、引用计数 |
| PUT `C/:id` | expected_version + data{name,description}；不允许改制造商/料号/类型 |
| PATCH `C/:id/status` | expected_version、status=1/2 |
| DELETE `C/:id` | 只允许无发布版本及业务引用的误建档案；草稿须先删除 |
| GET `C/:id/references` | 返回资源种类与数量 |
| GET `C/:id/history` | 分页审计，独立 history 权限 |
| GET `C/:id/revisions` | 分页版本，支持 state=draft/published |
| POST `C/:id/revisions` | from_revision_id?；有值复制该模型版本为新草稿，无值创建空草稿；返回 revision_id/revision_no/version |
| GET `C/:id/revisions/:revisionID` | 完整版本及模板子项、兼容关系；设备单版本模板上限 4096 项 |
| PUT `C/:id/revisions/:revisionID` | expected_version + 完整 data，原子替换草稿配置；保留已有子项 ID，新增子项不传 ID |
| POST `C/:id/revisions/:revisionID/publish` | expected_version；整体校验并冻结，返回已发布版本 |
| DELETE `C/:id/revisions/:revisionID` | expected_version；只删未引用草稿，不回收已分配 revision_no |

组件版本 data：`{tracking_mode:"individual",unit:"piece",spec:{schema_version:1,...}}`。

设备版本 data：`{mounting_type,height_u,rated_power_w,spec,slots,ports,standard_components,compatibilities}`。子项 API 使用稳定 slot_key 引用槽位，不要求前端知道新槽位数据库 ID；服务端同事务解析并持久化 FK。spec/schema、字段长度与兼容规则见领域文档。

设备版本示例（省略外壳）：

```json
{
  "expected_version": 1,
  "data": {
    "mounting_type": "rack",
    "height_u": 2,
    "rated_power_w": 800,
    "spec": {"schema_version": 1},
    "slots": [{"stable_key": "DIMM_A1", "name": "内存槽 A1", "kind": "memory", "interface": "DDR5", "form_factor": null, "position": {"schema_version": 1}}],
    "ports": [{"stable_key": "MGMT_01", "name": "管理口", "protocol": "ethernet", "connector": "RJ45", "speed_mbps": 1000, "source_kind": "fixed", "slot_key": null}],
    "standard_components": [{"part_model_revision_id": "<memory-revision-id>", "slot_key": "DIMM_A1", "quantity": 1, "required": true}],
    "compatibilities": [{"part_model_revision_id": "<memory-revision-id>", "slot_key": "DIMM_A1", "status": "confirmed", "evidence_note": "厂商兼容清单版本 1"}]
  }
}
```

confirmed_by/at 由本次有发布权限的操作者发布时记录；草稿保存者不能伪造确认人。position v1 仅允许 side?（front/rear/internal）、row?、column?，行列为非负整数；未知可省略。

## 4. 到货单 API

| 方法与路径 | 请求/返回 |
| --- | --- |
| GET `/arrival-orders` | state、supplier_id、search、created_from/to；分页订单、计划/已验收/剩余数量 |
| POST `/arrival-orders` | name、supplier_id、external_order_no?、expected_arrival_date?、description?；服务端生成 number，返回 draft/version=1 |
| GET `/arrival-orders/:id` | 主信息、汇总、version、allowed_actions；行项目另分页 |
| PUT `/arrival-orders/:id` | expected_version + data，更新草稿主信息 |
| GET `/arrival-orders/:id/lines` | 分页行项目，含 device_model_revision、planned/accepted/remaining_quantity 和 expected_components |
| POST `/arrival-orders/:id/lines` | expected_version、device_model_revision_id、planned_quantity、configuration_source="model"、note?；复制标准组件为计划配置 |
| PUT `/arrival-orders/:id/lines/:lineID` | 父订单 expected_version + data{planned_quantity,note,expected_components}；型号不可改，草稿可删行重建 |
| DELETE `/arrival-orders/:id/lines/:lineID` | 父订单 expected_version；仅 draft |
| POST `/arrival-orders/:id/open` | expected_version；确认计划、开放收货 |
| POST `/arrival-orders/:id/close` | expected_version、reason；结束未交付余量，保留已收资产 |
| POST `/arrival-orders/:id/cancel` | expected_version、reason；无成功验收资产且无活动草稿 |
| GET `/arrival-orders/:id/history` | 分页操作审计 |

expected_components 每项为 `{id?,part_model_revision_id,slot_key?,quantity,required}`；完整替换，空数组合法。对已有项以 ID 匹配，不按数组序号匹配。行写入返回 `{line,order_version}`；命令和主信息写入返回订单详情。订单不提供通用 DELETE，误建使用 cancel 留痕。

供应商、型号停用或计划配置不兼容时 open 拒绝。planned_quantity 为 1～10000；单张订单最大 1000 行，超限另建单。订单量不受单次验收 50 台限制。

## 5. 验收草稿 API

| 方法与路径 | 请求/返回 |
| --- | --- |
| GET `/receipts` | purchase_batch_id、state、search、created_from/to；分页摘要 |
| POST `/receipts` | purchase_batch_id、note?；订单必须 open，创建空 draft |
| GET `/receipts/:id` | 主信息、version、设备/组件/判定数量、limits、allowed_actions、完成结果摘要（若有） |
| PUT `/receipts/:id` | expected_version + data{note} |
| GET `/receipts/:id/items` | 分页设备草稿，包含图片摘要、组件数量、校验摘要；不内嵌全部组件 |
| POST `/receipts/:id/items` | expected_version、purchase_line_id、serial_number?、configuration_source="order"；创建一台草稿并展开每台计划组件，返回 item/receipt_version |
| GET `/receipts/:id/items/:itemID` | 逐台详情及 receipt_version，含 location、inspection_result、configuration_confirmed、图片摘要和差异汇总 |
| PUT `/receipts/:id/items/:itemID` | expected_version + data{serial_number,location,inspection_result,inspected_at,difference_reason,reject_reason,configuration_confirmed} |
| DELETE `/receipts/:id/items/:itemID` | expected_version；只删草稿项及其草稿组件，解除草稿附件关联；不删除已冻结证据 |
| GET `/receipts/:id/items/:itemID/components` | 分页组件草稿，支持 kind、serial_status=known/missing、placement_kind |
| POST `/receipts/:id/items/:itemID/components` | 批量按数量添加组件草稿，见下方示例 |
| PATCH `/receipts/:id/items/:itemID/components/:componentID` | expected_version + data，可改 serial_number、slot_key、initial_placement、location；型号错误删旧项后新增，不偷换草稿身份 |
| DELETE `/receipts/:id/items/:itemID/components/:componentID` | expected_version；只删草稿组件 |
| POST `/receipts/:id/preview` | expected_version；只读预检，不修改版本、不预占资源 |
| POST `/receipts/:id/complete` | expected_version；原子验收归档及生成实物 |
| POST `/receipts/:id/cancel` | expected_version、reason；仅 draft |
| GET `/receipts/:id/result` | completed 的稳定结果摘要；未完成返回 STATE_CONFLICT |
| GET `/receipts/:id/result/items` | 分页逐台结果，包含 pass/reject、device_id?、baseline_id?、part_count；每页不嵌入几千个组件 ID |
| GET `/receipts/:id/history` | 分页操作审计 |

任一组件新增、修改、删除使该设备 `configuration_confirmed=false`，前端最终确认后再设 true。图片变动和设备信息变动递增聚合版本；只调整备注不重置组件确认。新 item 从订单配置展开只是待核验预填，不表示已经到货实物。

location 请求统一为 `{warehouse_id:"<uuid>",bin_id:null}` 或 `{warehouse_id:"<uuid>",bin_id:"<uuid>"}`。输出额外含 custody_location_id、warehouse_name、bin_name、path；客户端不提交这些派生字段。

按数量添加 8 根内存：

```json
{
  "expected_version": 4,
  "part_model_revision_id": "<memory-revision-id>",
  "quantity": 8,
  "initial_placement": "installed",
  "location": null
}
```

可额外传 units，长度必须等于 quantity，每项 `{serial_number:null,slot_key:null}`。不传 units 时服务端生成 quantity 个未知 SN/槽位的草稿组件，不复制相同序列号。响应 `{items:[{id,part_model_revision_id,serial_number,slot_key,initial_placement,location}],receipt_version}`，每项 id 稳定；数量上限 min(512,剩余单批组件额度)。修改时以返回 ID 定位，补录 SN 不依赖数组顺序。

保存逐台验收信息示例：

```json
{
  "expected_version": 5,
  "data": {
    "serial_number": "SERVER-SN-001",
    "location": {"warehouse_id": "<warehouse-id>", "bin_id": "<bin-id>"},
    "inspection_result": "pass",
    "inspected_at": "2026-11-14T03:00:00Z",
    "difference_reason": null,
    "reject_reason": null,
    "configuration_confirmed": true
  }
}
```

inspection_result=reject 时必须给 reject_reason；pending 允许保存不完整数据。最终 pass/reject 均要求 inspected_at，不能晚于服务端当前时间。草稿保存仍校验类型、已知 SN 格式、有效父子关系、槽位重复等，不把所有错误推迟到 complete。

扫码输入也走新增/编辑草稿：相同 Idempotency-Key 重试返回原 item；不同键录入本草稿已有 SN 返回 SERIAL_CONFLICT 及 existing_item_id，前端定位已有项。不同草稿中的重复已知 SN 可预警，最终由提交唯一约束裁决。

## 6. 图片上传与读取

| 方法与路径 | 请求/返回 |
| --- | --- |
| POST `/receipts/:id/items/:itemID/photos` | multipart/form-data：expected_version、file；必带 Idempotency-Key。校验后直接绑定该项，返回 id、mime、size、sha256、content_url、receipt_version |
| GET `/receipts/:id/items/:itemID/photos` | 分页已关联图片摘要；完成后仍可读取 |
| DELETE `/receipts/:id/items/:itemID/photos/:attachmentID` | expected_version；仅草稿解除关联，返回 receipt_version；已归档拒绝 |
| GET `/asset-attachments/:id/content` | 校验当前角色及所属验收/资产的读取权限后返回图片，不公开底层 object_key |

上传字节也参与幂等摘要（服务端 SHA256 + 元数据），同键不同文件返回冲突。每张图片独立上传并更新 receipt_version，前端先串行上传；以后引入并行上传前必须新增不丢失聚合并发语义的设计。

使用同源认证 URL，响应私有缓存策略、正确 Content-Type 和 nosniff，不返回长期公开 URL。资产读取者可查看已通过验收并关联到对应基线的图片；拒收照片仅有验收读取权限者可看。图片权限在每次读取时检查，不凭知道 UUID 或历史上传者身份永久放行。

上传过程中按钮显示进度；上传/关联失败不得展示为已持久化。本批图片字节与关联直接存入 PostgreSQL，删除草稿图片在同一事务删除未冻结附件。完成后不可删除或替换，不涉及对象存储孤立清理。支持格式以 metadata.accepted_image_types 为准，当前为 JPEG/PNG。

## 7. 预检、提交与恢复

preview 返回 HTTP 200 的业务校验报告；请求版本已过期则 HTTP 409，不以旧数据生成报告：

```json
{
  "receipt_id": "<receipt-id>",
  "checked_version": 9,
  "can_complete": false,
  "summary": {"accepted_device_count": 1, "rejected_device_count": 0, "created_part_count": 16},
  "errors": [{"reason": "EVIDENCE_REQUIRED", "item_id": "<item-id>", "component_id": null, "field": "photos", "message": "至少上传一张验收图片"}],
  "warnings": [{"reason": "PART_SERIAL_MISSING", "item_id": "<item-id>", "component_id": "<component-id>", "field": "serial_number", "message": "组件序列号可后补"}]
}
```

以上仅展示 summary 计数字段和一条提示；实际 summary 使用 ReceiptResult 结构，warnings 按组件逐条返回。

缺组件 SN、已确认装机但槽位未知是提示，不阻止验收。实际与计划差异必须已填写原因且满足兼容性才可提交。所有 pending 判定、缺设备 SN、缺照片、缺位置、不兼容、超收均为 errors。

complete 只提交 `{expected_version:9}`，不让前端重复上传一整份已保存配置。服务端完整重检，不能信任 can_complete。成功 data：

```json
{
  "receipt_id": "<receipt-id>",
  "state": "completed",
  "version": 10,
  "completed_at": "2026-11-14T03:10:00Z",
  "action_id": "<action-id>",
  "accepted_device_count": 1,
  "rejected_device_count": 0,
  "created_part_count": 16,
  "purchase_batch_id": "<order-id>",
  "order_version": 4,
  "result_items_url": "/api/v1/receipts/<receipt-id>/result/items"
}
```

请求超时/断网：保留同键与相同 expected_version 重试，或 GET receipt/result 核实；不能立即新建第二份验收。HTTP 409 要求重读并让用户确认差异，不自动换新 version 提交。已完成不能回到草稿，也不能通过原编辑页面移动组件。

## 8. 设备、组件与配置读取

| 方法与路径 | 参数与返回 |
| --- | --- |
| GET `/assets/devices` | search（编号/SN）、device_model_id、manufacturer_id、supplier_id、warehouse_id、lifecycle_state、source_receipt_id；分页设备摘要 |
| GET `/assets/devices/:id` | 编号、SN、型号版本、状态、当前位置、来源订单/验收、version、configuration_version、组件数量汇总 |
| GET `/assets/devices/:id/original-configuration` | 不可变基线头、验收时型号/位置快照、照片和组件总数；不内嵌全部明细 |
| GET `/assets/devices/:id/original-configuration/items` | 分页原始成员；含 part_item_id、serial_number_at_receipt、original_slot_key、snapshot；include_current_identity=true 可返回独立 current_identity，默认 false |
| GET `/assets/devices/:id/current-configuration` | 当前配置摘要、configuration_version、confirmed_at、是否有未知槽位；不等同于实时采集结果 |
| GET `/assets/devices/:id/current-configuration/items` | 分页有效安装成员；含 part_item_id、当前 SN、slot_key、型号版本、allocation_id |
| GET `/assets/devices/:id/configuration-diff` | 分页按实物 ID 比较原始安装成员与当前安装成员，filter=added/removed/moved/unchanged；返回 baseline_id/configuration_version |
| GET `/assets/devices/:id/history` | 验收和后续资产动作，单独 history 权限 |
| GET `/assets/components` | search、part_model_id、source_device_id、current_device_id、warehouse_id、placement_kind、serial_status；分页组件摘要 |
| GET `/assets/components/:id` | 当前身份、来源基线/验收、当前安装或库房位置、version；source_device 与 current_device 明确分开 |
| PATCH `/assets/components/:id/serial-number` | expected_version、serial_number、reason；只填未知 SN，不移动实物；必带 Idempotency-Key |
| GET `/assets/components/:id/history` | 身份补录、初始收货及未来移动事件，recorded_at 与 effective_at 分开 |

原始配置条目的 current_identity 只是查询时补充，基线序列号不被替换。configuration-diff 以原始 initial_placement=installed 的成员与当前有效安装成员比较；随货 stored 散件在原始成员中可查，但不误判成从设备拆下。相同型号不同 part_item_id 仍显示一移除一新增，不能只比数量。

当前配置与差异的分页可传 expected_configuration_version；若设备硬件配置已变化返回 VERSION_CONFLICT，前端重新加载，避免拼接两个配置版本。组件 SN 是独立身份版本，返回 part_version，补录不会增加 configuration_version。当前摘要 confirmed_at 取最近确认配置的动作时间，不使用查询时间。

SN 补录示例：

```json
{
  "expected_version": 1,
  "serial_number": "MEM-SN-0008",
  "reason": "核对内存标签后补录"
}
```

成功返回组件详情（version 递增）及 identity_event_id。NULL→已知才写事件；已经是同一个规范化 SN 时检查 expected_version 后返回无变化结果。已知→不同/清空返回 SERIAL_CORRECTION_REQUIRED。不能通过该接口修改 part_model_revision_id、source_device_id、current_device_id 或位置。

## 9. 错误契约

沿用当前业务码，不直接占用尚未登记的 409xxx 编号。新增 domain sentinel/typed error，由统一错误映射输出安全 data.reason，不将数据库约束名、SQL、驱动文本返回前端。

| HTTP / code | data.reason | 前端处理 |
| --- | --- | --- |
| 400 / 400001 | VALIDATION_FAILED、LIMIT_EXCEEDED | 定位 fields，保留草稿 |
| 401 / 401xxx | 沿用认证错误 | 清理身份并恢复登录流程 |
| 403 / 403001 | PERMISSION_DENIED | 禁止操作，不自动重试 |
| 404 / 404007 | RESOURCE_NOT_FOUND | 资源不存在或嵌套父子关系不匹配 |
| 409 / 409001 | VERSION_CONFLICT | 返回 current_version/resource，重读并保留输入 |
| 409 / 409001 | IDEMPOTENCY_KEY_REUSED | 同键不同请求，必须停止重复提交 |
| 409 / 409001 | STATE_CONFLICT、ORDER_NOT_OPEN、RECEIPT_ALREADY_COMPLETED | 刷新状态，已完成提供 result_url |
| 409 / 409001 | ORDER_QUANTITY_EXCEEDED | 返回 line_id、remaining_quantity，请用户调整本批 |
| 409 / 409001 | SERIAL_CONFLICT | 标明 item/component、字段；只有具备目标读取权限时返回 existing_resource_id |
| 409 / 409001 | REFERENCE_DISABLED、MODEL_NOT_PUBLISHED、RESOURCE_REFERENCED | 提示停用/未发布/被引用原因 |
| 409 / 409001 | INCOMPATIBLE_COMPONENT、SLOT_OCCUPIED | 定位组件/槽位，不能强行跳过 |
| 409 / 409001 | EVIDENCE_REQUIRED、LOCATION_REQUIRED、CONFIGURATION_UNCONFIRMED、INSPECTION_PENDING、DIFFERENCE_REASON_REQUIRED | 返回逐项问题，与 preview 同结构 |
| 409 / 409001 | IMMUTABLE_RECORD、SERIAL_CORRECTION_REQUIRED | 不开放普通修改入口 |
| 413 / 413000 | UPLOAD_TOO_LARGE | 缩小图片；实现时登记领域常量 |
| 415 / 415000 | UNSUPPORTED_IMAGE_TYPE | 更换支持的真实图片；实现时登记领域常量 |
| 503 / 503002 | EVIDENCE_STORAGE_UNAVAILABLE | 保留草稿，稍后使用同动作键重试 |
| 500 / 500001 或 500002 | 安全通用错误 | 展示 request_id，先查询确认提交结果 |

错误示例：

```json
{
  "code": 409001,
  "message": "验收内容已被修改，请重新加载后确认",
  "data": {"reason": "VERSION_CONFLICT", "resource": "receipt", "resource_id": "<receipt-id>", "current_version": 12, "fields": []},
  "request_id": "<request-id>",
  "timestamp": 1794614400
}
```

批量问题 fields 每项 `{item_id?,component_id?,field,reason,message}`；权限不足时不泄漏其他资产 SN/位置/供应商。preview 使用相同问题结构，前端不解析中文 message 分支。

## 10. 权限与路由映射

每条实际 method+route 都登记 API 权限。菜单父节点不会自动授予写权限；allowed_actions 仅表示状态允许的动作，前端必须继续与 can() 权限取交集，后端每次重新校验。表中前缀后接 `:<action>`，不是运行时通配符。

| 权限前缀 | action 与覆盖范围 |
| --- | --- |
| `model-management:component-models` / `model-management:device-models` | read=列表/详情/版本读取/引用；create=档案及版本创建；update=档案及草稿版本编辑；publish=发布；status=启停；delete=误建档案/草稿删除；history=审计 |
| `arrival-orders` | read=主单/行查询；create=创建主单；update=主单/行新增编辑删除；open=开放收货；close=提前关闭；cancel=取消；history=审计 |
| `receipts` | read=主单/项/组件/照片列表/完成结果；create=创建主单；update=主单/项/组件编辑增删；evidence=上传/解除照片；complete=最终提交；cancel=取消；history=审计 |
| `assets:devices` | read=设备/原始/当前/差异；history=设备历史 |
| `assets:components` | read=组件及来源/当前位置；serial=补录 SN；history=组件历史 |

preview 对应 receipts:complete API 权限。metadata 对应 asset-management:read；图片下载路由对应 asset-attachments:read，并继续做下面的父对象读取权限检查。文件下载允许 receipts:read（所属验收）或 assets:devices:read（已生成且关联对应设备基线），通过对象关系复核；未归属资产的拒收附件不能靠资产读权限查看。模型选项和库房选项须为业务操作角色配套现有 read 权限；不在前端临时增加免鉴权选择器。

建议角色组合：模型维护员管理模型及发布；收货登记员维护订单/验收草稿和证据；验收员具有读取、预检和 complete；资产查看员只读资产；身份补录员可读组件并补 SN。本批不强制两人审批，由既有角色分配控制，后续工单职责分离另行接入。

## 11. 前端页面对应与实现交付

1. 模型管理：档案列表→版本草稿编辑→发布；型号选择仅显示启用且有已发布版本的模型。
2. 到货单：创建→添加设备型号/数量及每台计划配置→开放收货→查看累计和剩余。
3. 验收工作台：创建草稿→逐台录 SN→按计划预填并核对实际组件→选择库房/库位→上传图片→确认配置/判定→预检→提交。
4. 提交结果：明确成功设备数、拒收数及生成组件数，链接实物资产；网络错误不得宣称完成或再次新建。
5. 设备详情：分别展示到货原始配置、当前确认配置、差异、来源及照片；本批不显示可用的组件移动按钮。
6. 组件列表：按当前位置/所属设备/序列号待补筛选，补录基于实物 ID；不把来源设备当成当前设备。

表格复用项目 DataTable，权限用 can/Can/RequirePermission，危险操作用 useConfirm，结果用 notify；409 保留输入。正式实现需交付与本契约对应的 OpenAPI、Go DTO、前端类型、真实 PostgreSQL 约束测试、普通角色 API 正反例、图片授权及浏览器联调。验证结果见 [后端实现与验收说明](ASSET_RECEIVING_IMPLEMENTATION.md)。


## 12. 实际响应补充

- 模型版本统一返回 model_id 和 id；槽位/端口模板输出 device_model_revision_id，底层列为 revision_id。模型列表/详情另含 latest_published_revision。
- 验收项和组件草稿的 id 仅为草稿身份；结果接口中的 device_id、组件实物接口中的 id 才是最终实物身份。
- 当前配置明细每条是安装关系（id 为 allocation ID、part_item_id 为组件 ID），当前组件信息放在 part 对象。原始明细的 snapshot 是冻结信息，current_identity 是可选的当前身份补充。
- 上传图片响应直接包含附件 id（用作后续 attachmentID）、detected_mime、size_bytes、sha256、content_url 和 receipt_version；不返回图片字节。photos 列表返回相同元数据。
- API 路径中的 childID 是对应 revisionID/lineID，componentID 在 photos 路径表示附件 ID；这些是路由模板参数名，不影响实际 URL。
- 本批组件 PATCH 的 data 是该组件可编辑字段的完整对象（serial_number、slot_key、initial_placement、location），未提供必要的放置方式会被拒绝。前端先读取当前值再提交完整对象。
- 预检响应 data.summary使用 accepted_device_count、rejected_device_count、created_part_count；逐项 errors/warnings 含 item_id、component_id、field、reason、message。缺少组件序列号按实物逐条提示。
