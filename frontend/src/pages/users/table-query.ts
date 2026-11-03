import type { QueryField } from "@/components/data-table/data-table-query"
export const userQueryFields: readonly QueryField[] = [
  { key: "username", label: "用户名", type: "text", sensitive: true },
  { key: "nickname", label: "昵称", type: "text", sensitive: true },
  { key: "email", label: "邮箱", type: "text", sensitive: true },
  {
    key: "status",
    label: "状态",
    type: "enum",
    options: [
      { value: 1, label: "启用" },
      { value: 2, label: "禁用" },
    ],
  },
  {
    key: "auth_type",
    label: "身份来源",
    type: "enum",
    options: [
      { value: "local", label: "本地" },
      { value: "ad", label: "AD" },
      { value: "ldap", label: "LDAP" },
    ],
  },
  { key: "built_in", label: "内置用户", type: "boolean" },
  { key: "edit_revision", label: "版本号", type: "number" },
  { key: "created_at", label: "创建时间", type: "date" },
  { key: "last_login_at", label: "最近登录", type: "date", nullable: true },
]
