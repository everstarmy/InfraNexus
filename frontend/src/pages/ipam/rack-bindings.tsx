import { Server } from "lucide-react"
import { PageHeader } from "@/components/common/page-header"
import { ManagedCatalog } from "@/components/managed/managed-catalog"
import type { EditorField } from "@/components/managed/managed-editor"
import { racksService } from "@/services/locations"
import { rackBindingsService, subnetsService, type RackSubnetBindingDTO } from "@/services/ipam"

const fields: EditorField<RackSubnetBindingDTO>[] = [
  {
    key: "rack_id",
    label: "机柜",
    type: "lookup",
    required: true,
    source: { key: "racks", permission: "locations:racks:read", list: racksService.list },
  },
  {
    key: "subnet_id",
    label: "子网",
    type: "lookup",
    required: true,
    source: {
      key: "subnets",
      permission: "ipam:subnets:read",
      list: async (params, signal) => {
        const result = await subnetsService.list(params, signal)
        return {
          ...result,
          data: {
            ...result.data,
            items: result.data.items
              .filter((item) => item.is_allocatable)
              .map((item) => ({
                id: item.id,
                name: `${item.name} · ${item.cidr} · ${item.usage_type}`,
              })),
          },
        }
      },
    },
  },
  {
    key: "usage_type",
    label: "与子网一致的网络用途",
    type: "select",
    required: true,
    options: [
      { value: "bmc", label: "带外管理" },
      { value: "storage_management", label: "存储管理" },
      { value: "business_management", label: "业务管理" },
      { value: "production", label: "生产业务" },
      { value: "heartbeat", label: "心跳" },
      { value: "vip", label: "VIP" },
      { value: "other", label: "其他" },
    ],
  },
  { key: "is_default", label: "设为该用途的默认绑定", type: "checkbox" },
]

export default function RackBindingsPage() {
  return (
    <div className="table-workspace flex min-w-0 flex-col gap-2">
      <PageHeader
        title="机柜与网段绑定"
        description="将机柜绑定到同一数据中心内用途相容的可分配子网。"
        icon={Server}
      />
      <ManagedCatalog
        label="机柜网段绑定"
        permission="ipam:rack-bindings"
        resourceKey="rackBindings"
        service={rackBindingsService}
        fields={fields}
        columns={[
          { accessorKey: "usage_type", header: "网络用途" },
          {
            accessorKey: "is_default",
            header: "默认绑定",
            cell: ({ row }) => (row.original.is_default ? "是" : "否"),
          },
        ]}
      />
    </div>
  )
}
