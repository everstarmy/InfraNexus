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
