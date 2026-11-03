import type { ColumnDef } from "@/components/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { AuthSourceBadge, StatusDot } from "@/components/common/badges";
import { UserAvatar } from "@/components/common/user-avatar";
import type { UserDTO } from "@/services/types";
export const memberColumns: ColumnDef<UserDTO>[] = [
  {
    id: "username",
    accessorKey: "username",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="成员" />
    ),
    enableSorting: false,
    cell: ({ row }) => {
      const u = row.original;
      return (
        <div className="flex items-center gap-2.5">
          <UserAvatar
            name={u.nickname || u.username}
            seed={u.username}
            size="sm"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {u.nickname || u.username}
            </p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {u.username}
            </p>
          </div>
        </div>
      );
    },
  },
  {
    id: "department",
    accessorFn: (u) => u.department?.name ?? "",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="所在部门" />
    ),
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-sm">{row.original.department?.name ?? "—"}</span>
    ),
  },
  {
    id: "auth_type",
    accessorKey: "auth_type",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="来源" />
    ),
    enableSorting: false,
    cell: ({ row }) => (
      <AuthSourceBadge
        authType={row.original.auth_type}
        domain={row.original.domain}
      />
    ),
  },
  {
    id: "status",
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="状态" />
    ),
    enableSorting: false,
    cell: ({ row }) => <StatusDot active={row.original.status === 1} />,
  },
];
