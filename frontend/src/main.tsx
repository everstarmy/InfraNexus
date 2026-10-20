import React from "react"
import ReactDOM from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import App from "./App"
import { Toaster } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ConfirmProvider } from "@/components/common/confirm-dialog"
import { applyTheme, resolveTheme } from "@/lib/theme"
import { getErrorStatus } from "@/lib/api-error"
import "./index.css"

applyTheme(resolveTheme())

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
      retry: (count, error) => {
        const status = getErrorStatus(error)
        if (status && status >= 400 && status < 500) return false
        return count < 1
      },
    },
  },
})

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Toaster>
        <TooltipProvider delay={300}>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </TooltipProvider>
      </Toaster>
    </QueryClientProvider>
  </React.StrictMode>,
)
