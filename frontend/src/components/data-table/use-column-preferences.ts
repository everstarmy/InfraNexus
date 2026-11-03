import * as React from "react"
import type { RowData, ColumnPinningState, ColumnVisibilityState } from "@tanstack/react-table"
import type { ColumnDef } from "./types"
import {
  preferenceStorageKey,
  getColumnId,
  readColumnPreferences,
  sanitizePreferences,
  leafDefinitions,
  type ColumnPreferences,
  type TablePreferenceScope,
} from "./data-table-preferences"

export interface UseColumnPreferencesOptions<TData extends RowData> {
  columns: ColumnDef<TData, unknown>[]
  tablePreference?: TablePreferenceScope
  initialColumnVisibility: ColumnVisibilityState
  initialColumnPinning: ColumnPinningState
  layoutState?: { value: ColumnPreferences; onChange: (value: ColumnPreferences) => void }
  layoutControls?: { columns?: boolean }
  advancedQuery?: { initialLayout?: ColumnPreferences }
}
export function useColumnPreferences<TData extends RowData>({
  columns,
  tablePreference,
  initialColumnVisibility,
  initialColumnPinning,
  layoutState,
  layoutControls,
  advancedQuery,
}: UseColumnPreferencesOptions<TData>) {
  const storageKey = preferenceStorageKey(tablePreference)
  const visibilityKey = JSON.stringify(initialColumnVisibility)
  const pinningKey = JSON.stringify(initialColumnPinning)
  const schemaKey = React.useMemo(
    () =>
      JSON.stringify(
        leafDefinitions(columns as ColumnDef<TData, unknown>[]).map((column) => ({
          meta: column.meta,
          id: getColumnId(column as ColumnDef<TData, unknown>),
          min: column.minSize,
          max: column.maxSize,
        })),
      ),
    [columns],
  )
  const preferenceDefaults = React.useMemo(
    () =>
      readColumnPreferences(
        storageKey,
        columns as ColumnDef<TData, unknown>[],
        initialColumnVisibility,
        initialColumnPinning,
        layoutControls?.columns,
      ),
    [layoutControls?.columns, storageKey, schemaKey, visibilityKey, pinningKey],
  )
  const [savedColumnPreferences, setSavedColumnPreferences] = React.useState(() => ({
    key: storageKey,
    value: advancedQuery?.initialLayout
      ? sanitizePreferences(
          advancedQuery.initialLayout,
          columns as ColumnDef<TData, unknown>[],
          initialColumnVisibility,
          initialColumnPinning,
          layoutControls?.columns,
        )
      : preferenceDefaults,
  }))
  const activeColumnPreferences = sanitizePreferences(
    layoutState?.value ??
      (savedColumnPreferences.key === storageKey
        ? savedColumnPreferences.value
        : preferenceDefaults),
    columns as ColumnDef<TData, unknown>[],
    initialColumnVisibility,
    initialColumnPinning,
    layoutControls?.columns,
  )

  React.useLayoutEffect(() => {
    if (savedColumnPreferences.key !== storageKey) {
      setSavedColumnPreferences({ key: storageKey, value: preferenceDefaults })
    }
  }, [savedColumnPreferences.key, storageKey, preferenceDefaults])

  const [preferenceWarning, setPreferenceWarning] = React.useState("")
  const serializedPreferences = JSON.stringify(activeColumnPreferences)
  React.useEffect(() => {
    if (!storageKey || layoutState || savedColumnPreferences.key !== storageKey) return
    try {
      window.localStorage.setItem(storageKey, serializedPreferences)
    } catch {
      setPreferenceWarning("布局无法持久保存，本次会话内仍可使用")
    }
  }, [storageKey, serializedPreferences, savedColumnPreferences.key, layoutState])
  React.useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== storageKey || layoutState) return
      setSavedColumnPreferences({
        key: storageKey,
        value: readColumnPreferences(
          storageKey,
          columns as ColumnDef<TData, unknown>[],
          initialColumnVisibility,
          initialColumnPinning,
          layoutControls?.columns,
        ),
      })
      setPreferenceWarning("已同步其他标签页更新的列布局")
    }
    window.addEventListener("storage", changed)
    return () => window.removeEventListener("storage", changed)
  }, [storageKey, schemaKey, layoutState, layoutControls?.columns])

  const updateColumnPreference = <K extends keyof ColumnPreferences>(
    key: K,
    updater: React.SetStateAction<ColumnPreferences[K]>,
  ) => {
    if (layoutState) {
      const value =
        typeof updater === "function"
          ? (updater as (value: ColumnPreferences[K]) => ColumnPreferences[K])(
              activeColumnPreferences[key],
            )
          : updater
      layoutState.onChange(
        sanitizePreferences(
          { ...activeColumnPreferences, [key]: value },
          columns as ColumnDef<TData, unknown>[],
          initialColumnVisibility,
          initialColumnPinning,
          layoutControls?.columns,
        ),
      )
      return
    }
    setSavedColumnPreferences((current) => {
      const base = current.key === storageKey ? current.value : preferenceDefaults
      const currentValue = base[key]
      const nextValue =
        typeof updater === "function"
          ? (updater as (value: ColumnPreferences[K]) => ColumnPreferences[K])(currentValue)
          : updater
      return { key: storageKey, value: { ...base, [key]: nextValue } }
    })
  }
  const resetColumnPreferences = () => {
    const value = readColumnPreferences(
      null,
      columns,
      initialColumnVisibility,
      initialColumnPinning,
      layoutControls?.columns,
    )
    if (layoutState) layoutState.onChange(value)
    else setSavedColumnPreferences({ key: storageKey, value })
  }
  return {
    resetColumnPreferences,
    storageKey,
    activeColumnPreferences,
    preferenceWarning,
    setSavedColumnPreferences,
    updateColumnPreference,
  }
}
