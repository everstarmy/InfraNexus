import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { queryKeys } from "@/lib/query-keys"
import { binsService, shelvesService, warehousesService } from "@/services/locations"
import type { AssetLocationInput } from "@/services/receiving-metadata"

export function AssetLocationPicker({
  value,
  onChange,
  disabled,
  idPrefix = "loc",
  showLabels = true,
  allowClear = false,
}: {
  value: AssetLocationInput | null
  onChange: (next: AssetLocationInput | null) => void
  disabled?: boolean
  idPrefix?: string
  showLabels?: boolean
  allowClear?: boolean
}) {
  const warehouseId = value?.warehouse_id ?? ""
  const binId = value?.bin_id ?? ""
  const [selectedShelfId, setSelectedShelfId] = useState("")

  const warehousesQuery = useQuery({
    queryKey: queryKeys.warehouses({ page: 1, page_size: 100, status: 1 }),
    queryFn: ({ signal }) => warehousesService.list({ page: 1, page_size: 100, status: 1 }, signal),
    staleTime: 60 * 1000,
  })

  const shelvesQuery = useQuery({
    queryKey: queryKeys.shelves({ page: 1, page_size: 100, parent_id: warehouseId, status: 1 }),
    queryFn: ({ signal }) => shelvesService.list({ page: 1, page_size: 100, parent_id: warehouseId, status: 1 }, signal),
    enabled: Boolean(warehouseId),
    staleTime: 60 * 1000,
  })

  const currentBinQuery = useQuery({
    queryKey: ["locations", "bin", binId],
    queryFn: ({ signal }) => binsService.get(binId, signal),
    enabled: Boolean(binId) && !selectedShelfId,
    staleTime: 60 * 1000,
  })

  useEffect(() => {
    const inferredShelf = currentBinQuery.data?.data.shelf_id
    if (inferredShelf && !selectedShelfId) {
      setSelectedShelfId(inferredShelf)
    }
  }, [currentBinQuery.data, selectedShelfId])

  useEffect(() => {
    if (!warehouseId) {
      setSelectedShelfId("")
    }
  }, [warehouseId])

  const binsQuery = useQuery({
    queryKey: queryKeys.bins({ page: 1, page_size: 100, parent_id: selectedShelfId, status: 1 }),
    queryFn: ({ signal }) => binsService.list({ page: 1, page_size: 100, parent_id: selectedShelfId, status: 1 }, signal),
    enabled: Boolean(warehouseId) && Boolean(selectedShelfId),
    staleTime: 60 * 1000,
  })

  const warehouses = warehousesQuery.data?.data.items ?? []
  const shelves = shelvesQuery.data?.data.items ?? []
  const bins = binsQuery.data?.data.items ?? []

  return (
    <div className="grid grid-cols-12 gap-2.5">
      <div className="col-span-12 md:col-span-4 space-y-1">
        {showLabels && (
          <Label htmlFor={`${idPrefix}-warehouse`} className="text-xs">
            库房
          </Label>
        )}
        <NativeSelect
          id={`${idPrefix}-warehouse`}
          aria-label="选择库房"
          disabled={disabled}
          value={warehouseId}
          onChange={(e) => {
            const nextWh = e.target.value
            setSelectedShelfId("")
            if (!nextWh) {
              onChange(allowClear ? null : null)
            } else {
              onChange({ warehouse_id: nextWh, bin_id: null })
            }
          }}
        >
          <NativeSelectOption value="">请选择库房</NativeSelectOption>
          {warehouses.map((wh) => (
            <NativeSelectOption key={wh.id} value={wh.id}>
              {wh.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <div className="col-span-12 md:col-span-4 space-y-1">
        {showLabels && (
          <Label htmlFor={`${idPrefix}-shelf`} className="text-xs">
            货架（可选）
          </Label>
        )}
        <NativeSelect
          id={`${idPrefix}-shelf`}
          aria-label="选择货架"
          disabled={disabled || !warehouseId}
          value={selectedShelfId}
          onChange={(e) => {
            const nextShelf = e.target.value
            setSelectedShelfId(nextShelf)
            if (warehouseId) {
              onChange({ warehouse_id: warehouseId, bin_id: null })
            }
          }}
        >
          <NativeSelectOption value="">不指定货架 / 库位</NativeSelectOption>
          {shelves.map((shelf) => (
            <NativeSelectOption key={shelf.id} value={shelf.id}>
              {shelf.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <div className="col-span-12 md:col-span-4 space-y-1">
        {showLabels && (
          <Label htmlFor={`${idPrefix}-bin`} className="text-xs">
            库位（可选）
          </Label>
        )}
        <NativeSelect
          id={`${idPrefix}-bin`}
          aria-label="选择库位"
          disabled={disabled || !warehouseId || !selectedShelfId}
          value={binId}
          onChange={(e) => {
            const nextBin = e.target.value
            if (warehouseId) {
              onChange({ warehouse_id: warehouseId, bin_id: nextBin || null })
            }
          }}
        >
          <NativeSelectOption value="">放在库房默认区域</NativeSelectOption>
          {bins.map((bin) => (
            <NativeSelectOption key={bin.id} value={bin.id}>
              {bin.name} (L{bin.layer})
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
    </div>
  )
}
