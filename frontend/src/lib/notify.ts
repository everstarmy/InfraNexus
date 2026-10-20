import { toast } from "@/components/ui/toast"
import { getErrorMessage } from "./api-error"

export const notify = {
  success: (title: string, description?: string) => toast.add({ title, description, type: "success" }),
  info: (title: string, description?: string) => toast.add({ title, description, type: "info" }),
  warning: (title: string, description?: string) => toast.add({ title, description, type: "warning" }),
  error: (title: string, description?: string) => toast.add({ title, description, type: "error" }),
  apiError: (error: unknown, title = "操作失败") =>
    toast.add({ title, description: getErrorMessage(error), type: "error" }),
}
