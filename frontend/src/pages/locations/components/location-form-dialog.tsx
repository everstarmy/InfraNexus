import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertCircle, Building2, Cpu, DoorClosed, Loader2, Server } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { getErrorMessage } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import { newManagedIdempotencyKey } from "@/services/managed"
import {
  locationsService,
  type DatacenterContact,
  type DatacenterExt,
  type LocationNode,
  type LocationType,
  type RackExt,
  type RoomExt,
} from "@/services/locations"
import { locationTypeLabels } from "./location-tree"

const ROW_PATTERN = /^(?:[A-Za-z]|[1-9]|1[0-9]|2[0-5])$/

interface LocationFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  node?: LocationNode | null
  type: LocationType
  parent?: LocationNode | null
  onSuccess?: (saved: LocationNode) => void
}

export function LocationFormDialog({
  open,
  onOpenChange,
  node,
  type,
  parent,
  onSuccess,
}: LocationFormDialogProps) {
  const queryClient = useQueryClient()
  const isEditing = Boolean(node)

  // Common field
  const [name, setName] = useState("")

  // Datacenter fields
  const [address, setAddress] = useState("")
  const [contactName, setContactName] = useState("")
  const [contactPhone, setContactPhone] = useState("")
  const [contactEmail, setContactEmail] = useState("")

  // Room fields
  const [floor, setFloor] = useState<string>("1")

  // Rack fields
  const [row, setRow] = useState("A")
  const [column, setColumn] = useState<string>("1")
  const [heightU, setHeightU] = useState<string>("42")
  const [powerW, setPowerW] = useState<string>("")

  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setError("")
    if (node) {
      setName(node.name)
      const ext = (node.ext ?? {}) as Record<string, any>
      if (node.type === "datacenter") {
        setAddress(String(ext.address ?? ""))
        const contact = (ext.contact ?? {}) as DatacenterContact
        setContactName(String(contact.name ?? ""))
        setContactPhone(String(contact.phone ?? ""))
        setContactEmail(String(contact.email ?? ""))
      } else if (node.type === "room") {
        setFloor(ext.floor != null ? String(ext.floor) : "1")
      } else if (node.type === "rack") {
        setRow(String(ext.row ?? "A"))
        setColumn(ext.column != null ? String(ext.column) : "1")
        setHeightU(ext.height_u != null ? String(ext.height_u) : "42")
        setPowerW(ext.power_capacity_w != null ? String(ext.power_capacity_w) : "")
      }
    } else {
      setName("")
      setAddress("")
      setContactName("")
      setContactPhone("")
      setContactEmail("")
      setFloor("1")
      setRow("A")
      setColumn("1")
      setHeightU("42")
      setPowerW("")
    }
  }, [open, node])

  const isDirty =
    open &&
    (isEditing
      ? name !== node?.name
      : Boolean(name || address || contactName || (type === "rack" && row !== "A")))

  useUnsavedChanges(isDirty, "位置表单尚未保存，关闭后更改将丢失。")

  const validate = (): string | null => {
    const trimmedName = name.trim()
    if (!trimmedName || trimmedName.length > 128) {
      return "名称必须在 1 到 128 个字符之间"
    }

    if (type === "datacenter") {
      const trimmedAddress = address.trim()
      if (!trimmedAddress || trimmedAddress.length > 512) {
        return "地址必须在 1 到 512 个字符之间"
      }
      const trimmedContact = contactName.trim()
      if (!trimmedContact || trimmedContact.length > 128) {
        return "联系人姓名必须在 1 到 128 个字符之间"
      }
      if (contactPhone.trim().length > 64) {
        return "联系人电话不能超过 64 个字符"
      }
      if (contactEmail.trim()) {
        const email = contactEmail.trim()
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return "请输入合法的邮箱地址"
        }
      }
    }

    if (type === "room") {
      const parsedFloor = Number(floor)
      if (isNaN(parsedFloor) || !Number.isInteger(parsedFloor) || parsedFloor < -5 || parsedFloor > 100) {
        return "楼层必须为 -5 到 100 之间的整数"
      }
    }

    if (type === "rack") {
      const upperRow = row.trim().toUpperCase()
      if (!ROW_PATTERN.test(upperRow)) {
        return "机柜行必须为 A–Z 或 1–25"
      }
      const parsedCol = Number(column)
      if (isNaN(parsedCol) || !Number.isInteger(parsedCol) || parsedCol < 1 || parsedCol > 9999) {
        return "机柜列必须为 1 到 9999 之间的整数"
      }
      const parsedHeight = Number(heightU)
      if (isNaN(parsedHeight) || !Number.isInteger(parsedHeight) || parsedHeight < 1 || parsedHeight > 100) {
        return "机柜高度必须为 1 到 100 U 之间的整数"
      }
      if (powerW.trim()) {
        const parsedPower = Number(powerW)
        if (isNaN(parsedPower) || !Number.isInteger(parsedPower) || parsedPower <= 0) {
          return "承载功率必须为大于 0 的整数（瓦特 W）"
        }
      }
    }

    return null
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const validationError = validate()
      if (validationError) throw new Error(validationError)

      let extPayload: Record<string, unknown> = {}
      if (type === "datacenter") {
        extPayload = {
          address: address.trim(),
          contact: {
            name: contactName.trim(),
            phone: contactPhone.trim() || undefined,
            email: contactEmail.trim() || undefined,
          },
        }
      } else if (type === "building") {
        extPayload = {}
      } else if (type === "room") {
        extPayload = {
          floor: Number(floor),
        }
      } else if (type === "rack") {
        const upperRow = row.trim().toUpperCase()
        extPayload = {
          row: upperRow,
          column: Number(column),
          height_u: Number(heightU),
          power_capacity_w: powerW.trim() ? Number(powerW) : null,
        }
      }

      if (isEditing && node) {
        const res = await locationsService.update(node.uid, {
          name: name.trim(),
          ext: extPayload,
          version: node.version,
        })
        return res.data
      } else {
        const res = await locationsService.create(
          {
            name: name.trim(),
            type,
            parent: parent?.uid ?? null,
            ext: extPayload,
          },
          newManagedIdempotencyKey(),
        )
        return res.data
      }
    },
    onSuccess: (saved) => {
      notify.success(
        isEditing
          ? `${locationTypeLabels[type]}已更新`
          : `已新建${locationTypeLabels[type]}「${saved.name}」`,
      )
      void queryClient.invalidateQueries({ queryKey: ["location-nodes"] })
      onSuccess?.(saved)
      onOpenChange(false)
    },
    onError: (err) => {
      setError(getErrorMessage(err, isEditing ? "更新位置失败" : "新建位置失败"))
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    mutation.mutate()
  }

  const renderTypeFields = () => {
    switch (type) {
      case "datacenter":
        return (
          <>
            <Field>
              <FieldLabel>
                机房物理地址 <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="例如：北京市海淀区中关村南大街 1 号"
                maxLength={512}
                required
              />
              <FieldDescription>详细物理位置，用于运维及巡检调度</FieldDescription>
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel>
                  中心现场联系人 <span className="text-destructive">*</span>
                </FieldLabel>
                <Input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="例如：张工"
                  maxLength={128}
                  required
                />
              </Field>

              <Field>
                <FieldLabel>联系电话</FieldLabel>
                <Input
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="手机或值班座机"
                  maxLength={64}
                />
              </Field>
            </div>

            <Field>
              <FieldLabel>联系邮箱</FieldLabel>
              <Input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="noc@example.com"
                maxLength={254}
              />
              <FieldDescription>接收现场工单与告警通知的联络邮箱</FieldDescription>
            </Field>
          </>
        )

      case "building":
        return (
          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            楼栋节点无需额外扩展字段，仅需填写规范的楼栋名称。
          </div>
        )

      case "room":
        return (
          <Field>
            <FieldLabel>
              所在楼层 <span className="text-destructive">*</span>
            </FieldLabel>
            <Input
              type="number"
              min={-5}
              max={100}
              step={1}
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              placeholder="3"
              required
            />
            <FieldDescription>
              整数：-5 到 100（正数表示地上楼层如 3F，负数表示地下楼层如 -1 表示 B1F）
            </FieldDescription>
          </Field>
        )

      case "rack":
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel>
                  机柜排/行 (Row) <span className="text-destructive">*</span>
                </FieldLabel>
                <Input
                  value={row}
                  onChange={(e) => setRow(e.target.value.toUpperCase())}
                  placeholder="A 或 1"
                  maxLength={2}
                  required
                />
                <FieldDescription>单字母 A–Z 或数字 1–25</FieldDescription>
              </Field>

              <Field>
                <FieldLabel>
                  机柜列号 (Column) <span className="text-destructive">*</span>
                </FieldLabel>
                <Input
                  type="number"
                  min={1}
                  max={9999}
                  step={1}
                  value={column}
                  onChange={(e) => setColumn(e.target.value)}
                  placeholder="1"
                  required
                />
                <FieldDescription>1 到 9999 之间的列号</FieldDescription>
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel>
                  机柜高度 (U) <span className="text-destructive">*</span>
                </FieldLabel>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={heightU}
                  onChange={(e) => setHeightU(e.target.value)}
                  placeholder="42"
                  required
                />
                <FieldDescription>标准机柜通常为 42U（范围 1–100U）</FieldDescription>
              </Field>

              <Field>
                <FieldLabel>设计承载功率 (W)</FieldLabel>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={powerW}
                  onChange={(e) => setPowerW(e.target.value)}
                  placeholder="8000"
                />
                <FieldDescription>
                  可选整数（瓦特），{powerW ? `${(Number(powerW) / 1000).toFixed(2)} kW` : "如 8000 W = 8 kW"}
                </FieldDescription>
              </Field>
            </div>
          </div>
        )
    }
  }

  const titleText = isEditing
    ? `编辑${locationTypeLabels[type]}`
    : `新建${locationTypeLabels[type]}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{titleText}</DialogTitle>
            <DialogDescription>
              {isEditing ? (
                <>编辑当前位置节点的属性（类型与上级归属在创建后固定）。</>
              ) : parent ? (
                <>
                  在「{parent.name}」({locationTypeLabels[parent.type]}) 下创建新的
                  {locationTypeLabels[type]}。
                </>
              ) : (
                <>创建顶层{locationTypeLabels[type]}。</>
              )}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <Alert variant="destructive" className="py-2 text-xs">
              <AlertCircle className="size-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <FieldGroup className="space-y-3">
            <Field>
              <FieldLabel>
                {locationTypeLabels[type]}名称 <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`请输入${locationTypeLabels[type]}名称`}
                maxLength={128}
                required
                autoFocus
              />
              <FieldDescription>同级名称不可重复，最多 128 个字符</FieldDescription>
            </Field>

            {renderTypeFields()}
          </FieldGroup>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              取消
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              {isEditing ? "保存变更" : "确认创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
