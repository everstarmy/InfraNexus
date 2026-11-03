import { createContext } from 'react'

/** Shared by headers, including custom column renderers inside the table. */
export const DataTableSortContext = createContext<{ enabled: boolean; count: number }>({ enabled: false, count: 0 })
