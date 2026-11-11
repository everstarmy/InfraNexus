import { ManagedCatalog } from "@/components/managed/managed-catalog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { networkScopesService, securityZonesService } from "@/services/ipam"
import { datacentersService } from "@/services/locations"

export function IpamCatalogSheet({
  resource,
  onClose,
}: {
  resource: "network-scopes" | "security-zones"
  onClose: () => void
}) {
  const scopes = resource === "network-scopes"
  const title = scopes ? "地址空间" : "安全域"
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex flex-col sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{title}管理</SheetTitle>
          <SheetDescription>维护子网规划所需的档案。</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          {scopes ? (
            <ManagedCatalog
              label={title}
              permission="ipam:network-scopes"
              resourceKey="networkScopes"
              service={networkScopesService}
              fields={[
                { key: "routing_domain_ref", label: "路由域引用", type: "text", maxLength: 128 },
              ]}
              columns={[{ accessorKey: "routing_domain_ref", header: "路由域引用" }]}
            />
          ) : (
            <ManagedCatalog
              label={title}
              permission="ipam:security-zones"
              resourceKey="securityZones"
              service={securityZonesService}
              fields={[
                {
                  key: "datacenter_id",
                  label: "所属数据中心",
                  type: "lookup",
                  required: true,
                  source: {
                    key: "datacenters",
                    permission: "locations:datacenters:read",
                    list: datacentersService.list,
                  },
                },
              ]}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
