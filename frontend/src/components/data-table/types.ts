import {
  tableFeatures,
  stockFeatures,
  createExpandedRowModel,
  createFilteredRowModel,
  createSortedRowModel,
  createPaginatedRowModel,
  createFacetedRowModel,
  createFacetedUniqueValues,
  createFacetedMinMaxValues,
  filterFns,
  sortFns,
  type ColumnDef as TanstackColumnDef,
  type Column as TanstackColumn,
  type RowData,
  type ReactTable,
} from "@tanstack/react-table"

/**
 * Standard TanStack Table v9 Features configuration for StorageNet.
 * Bundles stock features with row models and standard registries.
 */
export const appTableFeatures = tableFeatures({
  ...stockFeatures,
  expandedRowModel: createExpandedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  facetedMinMaxValues: createFacetedMinMaxValues(),
  filterFns,
  sortFns,
})

export type AppTableFeatures = typeof appTableFeatures
export type ColumnDef<
  TData extends RowData,
  TValue = unknown,
> = TanstackColumnDef<AppTableFeatures, TData, TValue>
export type Table<TData extends RowData> = ReactTable<
  AppTableFeatures,
  TData
> & {
  getState: () => ReactTable<AppTableFeatures, TData>["state"]
}
export type Column<TData extends RowData, TValue = unknown> = TanstackColumn<
  AppTableFeatures,
  TData,
  TValue
>

// Keep column text configuration typed across grouped and leaf columns.
import type { CellData, TableFeatures } from "@tanstack/react-table"
import type { DataTableText } from "./data-table-layout"
declare module "@tanstack/table-core" {
  interface ColumnMeta<TFeatures extends TableFeatures, TData extends RowData, TValue extends CellData = CellData> {
    text?: DataTableText
    autoSizeText?: (row: TData) => string
    headerClassName?: string
    cellClassName?: string | ((row: TData, value: TValue) => string | undefined)
    layout?: { move?: boolean; pin?: boolean; hide?: boolean }
    /** Consumed by loadedRowsTSV/exportLoadedRowsCSV and host exporters; server authorization remains mandatory. */
    export?: { enabled: boolean; label?: string; value?: (row: TData) => unknown }
    /** @experimental Host capability metadata only; DataTable does not open editing transactions. */
    edit?: { enabled: boolean; input: "text" | "number" | "date" | "enum" | "boolean" }
    /** Host query metadata only; never bypasses server field/operator whitelists. */
    query?: { key: string; type: "text" | "number" | "date" | "enum" | "boolean"; sensitive?: boolean }
  }
}

export type DataTablePreset = "simple" | "standard" | "advanced"
export interface ExternalDateRange { value: import('react-day-picker').DateRange | undefined; onChange: (value: import('react-day-picker').DateRange | undefined) => void; title?: string }
