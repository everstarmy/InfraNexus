import { ManagedCatalog } from "@/components/managed/managed-catalog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { certificationsService, contactsService } from "@/services/vendor-management"

export function CertificationsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex flex-col sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>联系人证书</SheetTitle>
          <SheetDescription>登记联系人证书，维护有效期和证明材料。</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          <ManagedCatalog
            label="联系人证书"
            permission="vendor-management:contact-certifications"
            resourceKey="certifications"
            service={certificationsService}
            retain
            fields={[
              {
                key: "contact_id",
                label: "联系人",
                type: "lookup",
                required: true,
                source: {
                  key: "contacts",
                  permission: "vendor-management:contacts:read",
                  list: contactsService.list,
                },
              },
              { key: "issuer", label: "签发机构", type: "text", maxLength: 128, required: true },
              {
                key: "certificate_no",
                label: "证书编号",
                type: "text",
                maxLength: 128,
                required: true,
              },
              { key: "valid_from", label: "生效日期", type: "date", required: true },
              { key: "valid_until", label: "到期日期", type: "date", required: true },
              { key: "evidence_ref", label: "证明材料引用", type: "text", maxLength: 256 },
            ]}
            columns={[
              { accessorKey: "issuer", header: "签发机构" },
              { accessorKey: "valid_until", header: "到期日期" },
            ]}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
