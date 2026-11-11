import { Archive } from "lucide-react"
import { PageHeader } from "@/components/common/page-header"
import { ManagedCatalog } from "@/components/managed/managed-catalog"
import type { ManagedLookupSource } from "@/components/managed/managed-editor"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/stores/auth-context"
import {
  binsService,
  datacentersService,
  shelvesService,
  temporaryLocationsService,
  warehousesService,
} from "@/services/locations"
import { usersService } from "@/services/users"

const datacenters = {
  key: "datacenters",
  permission: "locations:datacenters:read",
  list: datacentersService.list,
}
const warehouses = {
  key: "warehouses",
  permission: "locations:warehouses:read",
  list: warehousesService.list,
}
const shelves = { key: "shelves", permission: "locations:shelves:read", list: shelvesService.list }
const owners: ManagedLookupSource = {
  key: "users",
  permission: "api:GET:/api/v1/users",
  list: async ({ search, page_size }, signal) => {
    const result = await usersService.list({ keyword: search, page_size, status: "1" }, signal)
    return {
      ...result,
      data: {
        ...result.data,
        items: result.data.items.map((item) => ({
          id: item.id,
          name: item.nickname || item.username,
        })),
      },
    }
  },
}
const tabs = [
  { value: "warehouses", label: "备件库房" },
  { value: "shelves", label: "货架" },
  { value: "bins", label: "库位" },
  { value: "temporary-locations", label: "临时保管点" },
] as const

export default function WarehousesPage() {
  const { can } = useAuth()
  const availableTabs = tabs.filter(({ value }) =>
    can([
      `locations:${value}:read`,
      `locations:${value}:create`,
      `locations:${value}:import`,
      `locations:${value}:export`,
    ]),
  )
  return (
    <div className="table-workspace flex min-w-0 flex-col gap-2">
      <PageHeader
        title="备件仓储与临时保管"
        description="维护库房、货架、库位和临时保管点。"
        icon={Archive}
      />
      {availableTabs.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">没有仓储资源权限</p>
      ) : (
        <Tabs
          defaultValue={availableTabs[0].value}
          className="table-workspace-body flex min-h-0 flex-col gap-2"
        >
          <TabsList className="max-w-full overflow-x-auto">
            {availableTabs.map(({ value, label }) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="warehouses">
            <ManagedCatalog
              label="备件库房"
              permission="locations:warehouses"
              resourceKey="warehouses"
              service={warehousesService}
              fields={[
                {
                  key: "datacenter_id",
                  label: "所属数据中心",
                  type: "lookup",
                  source: datacenters,
                  required: true,
                },
                { key: "contact_person", label: "库房联系人", type: "text", maxLength: 128 },
              ]}
              columns={[{ accessorKey: "contact_person", header: "联系人" }]}
            />
          </TabsContent>
          <TabsContent value="shelves">
            <ManagedCatalog
              label="货架"
              permission="locations:shelves"
              resourceKey="shelves"
              service={shelvesService}
              fields={[
                {
                  key: "warehouse_id",
                  label: "所属库房",
                  type: "lookup",
                  source: warehouses,
                  required: true,
                },
                {
                  key: "layer_count",
                  label: "层数",
                  type: "number",
                  min: 1,
                  max: 100,
                  required: true,
                },
                { key: "capacity", label: "容量", type: "number", min: 0, required: true },
              ]}
              columns={[
                { accessorKey: "layer_count", header: "层数" },
                { accessorKey: "capacity", header: "容量" },
              ]}
            />
          </TabsContent>
          <TabsContent value="bins">
            <ManagedCatalog
              label="库位"
              permission="locations:bins"
              resourceKey="bins"
              service={binsService}
              fields={[
                {
                  key: "shelf_id",
                  label: "所属货架",
                  type: "lookup",
                  source: shelves,
                  required: true,
                },
                { key: "layer", label: "层号", type: "number", min: 1, max: 100, required: true },
                { key: "capacity", label: "容量", type: "number", min: 0, required: true },
              ]}
              columns={[
                { accessorKey: "layer", header: "层号" },
                { accessorKey: "capacity", header: "容量" },
              ]}
            />
          </TabsContent>
          <TabsContent value="temporary-locations">
            <ManagedCatalog
              label="临时保管点"
              permission="locations:temporary-locations"
              resourceKey="temporaryLocations"
              service={temporaryLocationsService}
              fields={[
                {
                  key: "datacenter_id",
                  label: "所属数据中心",
                  type: "lookup",
                  source: datacenters,
                  required: true,
                },
                {
                  key: "owner_id",
                  label: "责任人",
                  type: "lookup",
                  source: owners,
                  required: true,
                },
              ]}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
