import React, { useState, useEffect, useMemo, useCallback } from "react";
import { UserPlus, MoreHorizontal, Edit, Trash2, Shield, RefreshCw, AlertCircle } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { usersService } from "@/services/users";
import { rolesService, RoleDTO } from "@/services/roles";
import { UserDTO } from "@/services/auth";

export default function UsersPage() {
  const [data, setData] = useState<UserDTO[]>([]);
  const [roles, setRoles] = useState<RoleDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // 弹窗状态
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserDTO | null>(null);

  // 表单状态
  const [formUsername, setFormUsername] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formNickname, setFormNickname] = useState("");
  const [formRoleIDs, setFormRoleIDs] = useState<string[]>([]);
  const [formError, setFormError] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await usersService.getUsers({
        page,
        page_size: pageSize,
        keyword: keyword.trim() || undefined,
      });
      setData(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      console.error("加载用户列表失败", err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword]);

  const loadRoles = async () => {
    try {
      const res = await rolesService.getRoles();
      setRoles(res.data.items || []);
    } catch (err) {
      console.error("加载角色列表失败", err);
    }
  };

  useEffect(() => {
    loadUsers();
    loadRoles();
  }, [loadUsers]);

  const handleToggleStatus = async (user: UserDTO) => {
    const nextStatus = user.status === 1 ? 2 : 1;
    try {
      await usersService.toggleStatus(user.id, nextStatus);
      loadUsers();
    } catch (err) {
      console.error("切换用户状态失败", err);
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!confirm("确定要删除该用户吗？此操作不可逆。")) return;
    try {
      await usersService.deleteUser(id);
      loadUsers();
    } catch (err) {
      console.error("删除用户失败", err);
    }
  };

  const openCreateDialog = () => {
    setFormUsername("");
    setFormEmail("");
    setFormPassword("");
    setFormNickname("");
    setFormRoleIDs([]);
    setFormError("");
    setCreateDialogOpen(true);
  };

  const openEditDialog = (user: UserDTO) => {
    setEditUser(user);
    setFormNickname(user.nickname || "");
    const initialRoleIDs = (user.roles || [])
      .map((r) => r.id)
      .filter(Boolean);
    setFormRoleIDs(initialRoleIDs);
    setFormError("");
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitting(true);
    setFormError("");
    try {
      await usersService.createUser({
        username: formUsername.trim(),
        email: formEmail.trim(),
        password: formPassword,
        nickname: formNickname.trim() || undefined,
        role_ids: formRoleIDs,
      });
      setCreateDialogOpen(false);
      loadUsers();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setFormError(axiosErr.response?.data?.message || "创建用户失败，请检查参数");
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setFormSubmitting(true);
    setFormError("");
    try {
      await usersService.updateUser(editUser.id, {
        nickname: formNickname.trim() || undefined,
        role_ids: formRoleIDs,
      });
      setEditUser(null);
      loadUsers();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setFormError(axiosErr.response?.data?.message || "更新用户失败");
    } finally {
      setFormSubmitting(false);
    }
  };

  const columns = useMemo<ColumnDef<UserDTO>[]>(
    () => [
      {
        accessorKey: "username",
        header: ({ column }) => <DataTableColumnHeader column={column} title="用户" />,
        cell: ({ row }) => {
          const user = row.original;
          return (
            <div className="flex items-center gap-3">
              <Avatar className="h-8 w-8 border border-border">
                <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xs">
                  {user.nickname?.[0] || user.username[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col">
                <span className="font-medium text-foreground text-sm leading-tight">{user.username}</span>
                <span className="text-xs text-muted-foreground">{user.nickname || "-"}</span>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "email",
        header: ({ column }) => <DataTableColumnHeader column={column} title="电子邮箱" />,
        cell: ({ row }) => <span className="text-xs text-muted-foreground font-mono">{row.original.email}</span>,
      },
      {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="状态开关" />,
        cell: ({ row }) => {
          const isActive = row.original.status === 1;
          return (
            <div className="flex items-center gap-2">
              <Switch
                checked={isActive}
                onCheckedChange={() => handleToggleStatus(row.original)}
                aria-label="快速启停用户状态"
              />
              <span className={`text-xs ${isActive ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                {isActive ? "启用" : "停用"}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "roles",
        header: ({ column }) => <DataTableColumnHeader column={column} title="分派角色" />,
        cell: ({ row }) => {
          const userRoles = row.original.roles || [];
          return (
            <div className="flex flex-wrap gap-1">
              {userRoles.length === 0 ? (
                <span className="text-xs text-muted-foreground italic">未指定</span>
              ) : (
                userRoles.map((role) => (
                  <Badge key={role.id} variant="outline" className="gap-1 text-xs">
                    <Shield className="h-3 w-3 text-primary" />
                    <span>{role.name || role.code}</span>
                  </Badge>
                ))
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "created_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="创建时间" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.created_at
              ? new Date(row.original.created_at).toLocaleString("zh-CN", {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "-"}
          </span>
        ),
      },
      {
        id: "actions",
        header: "操作",
        cell: ({ row }) => {
          const user = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon" className="h-8 w-8 p-0" />
                }
              >
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">打开菜单</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEditDialog(user)}>
                  <Edit className="mr-2 h-4 w-4" />
                  <span>编辑信息</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleDeleteUser(user.id)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  <span>删除用户</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [roles]
  );

  return (
    <div className="w-full space-y-4">
      {/* 顶部操作区 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">用户账号管理</h2>
          <p className="text-xs text-muted-foreground">
            平台人员账号清单、状态控制与角色分派
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => loadUsers()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            <span>刷新</span>
          </Button>
          <Button size="sm" onClick={openCreateDialog}>
            <UserPlus className="h-4 w-4 mr-1.5" />
            <span>新建用户</span>
          </Button>
        </div>
      </div>

      {/* 企业级数据表格核心容器 */}
      <div className="w-full rounded-xl border border-border bg-card shadow-xs p-4">
        <DataTable
          columns={columns}
          data={data}
          loading={loading}
          searchKey="username"
          searchPlaceholder="搜索用户名..."
        />
      </div>

      {/* 新建用户弹窗 */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建平台用户</DialogTitle>
            <DialogDescription>创建新的操作账号并分配初始安全角色</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSubmit} className="space-y-4 pt-2">
            {formError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="create-username">用户名 *</Label>
              <Input
                id="create-username"
                placeholder="例如：developer"
                value={formUsername}
                onChange={(e) => setFormUsername(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="create-email">电子邮箱 *</Label>
              <Input
                id="create-email"
                type="email"
                placeholder="例如：dev@infranexus.com"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="create-password">初始密码 *</Label>
              <Input
                id="create-password"
                type="password"
                placeholder="至少 6 位密码"
                value={formPassword}
                onChange={(e) => setFormPassword(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="create-nickname">昵称 / 姓名</Label>
              <Input
                id="create-nickname"
                placeholder="例如：张三"
                value={formNickname}
                onChange={(e) => setFormNickname(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>分配角色</Label>
              <div className="grid grid-cols-2 gap-2 pt-1 max-h-40 overflow-y-auto">
                {roles.map((r) => {
                  const checked = formRoleIDs.includes(r.id);
                  return (
                    <label
                      key={r.id}
                      className={`flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer transition-colors ${
                        checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(val) => {
                          if (val) {
                            setFormRoleIDs([...formRoleIDs, r.id]);
                          } else {
                            setFormRoleIDs(formRoleIDs.filter((id) => id !== r.id));
                          }
                        }}
                      />
                      <span className="text-xs font-medium leading-none">{r.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={formSubmitting}>
                {formSubmitting ? "正在创建..." : "确认创建"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 编辑用户弹窗 */}
      <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑用户信息</DialogTitle>
            <DialogDescription>修改用户昵称与角色分派</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEditSubmit} className="space-y-4 pt-2">
            {formError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label className="text-muted-foreground">用户名 (不可变)</Label>
              <Input value={editUser?.username || ""} disabled className="bg-muted" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-nickname">昵称 / 姓名</Label>
              <Input
                id="edit-nickname"
                placeholder="例如：李四"
                value={formNickname}
                onChange={(e) => setFormNickname(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>重新指定角色</Label>
              <div className="grid grid-cols-2 gap-2 pt-1 max-h-40 overflow-y-auto">
                {roles.map((r) => {
                  const checked = formRoleIDs.includes(r.id);
                  return (
                    <label
                      key={r.id}
                      className={`flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer transition-colors ${
                        checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(val) => {
                          if (val) {
                            setFormRoleIDs([...formRoleIDs, r.id]);
                          } else {
                            setFormRoleIDs(formRoleIDs.filter((id) => id !== r.id));
                          }
                        }}
                      />
                      <span className="text-xs font-medium leading-none">{r.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setEditUser(null)}>
                取消
              </Button>
              <Button type="submit" disabled={formSubmitting}>
                {formSubmitting ? "正在保存..." : "保存修改"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
