import React, { useState, useEffect, useMemo, useCallback } from "react";
import { ShieldCheck, Plus, MoreHorizontal, Edit, Key, Trash2, CheckCircle2, XCircle, RefreshCw, AlertCircle } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { rolesService, RoleDTO, PermissionDTO } from "@/services/roles";

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleDTO[]>([]);
  const [permissions, setPermissions] = useState<PermissionDTO[]>([]);
  const [loading, setLoading] = useState(false);

  // 弹窗状态
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editRole, setEditRole] = useState<RoleDTO | null>(null);
  const [permRole, setPermRole] = useState<RoleDTO | null>(null);

  // 表单状态
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [selectedPermIDs, setSelectedPermIDs] = useState<string[]>([]);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadRoles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await rolesService.getRoles();
      setRoles(res.data.items || []);
    } catch (err) {
      console.error("加载角色失败", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPermissions = async () => {
    try {
      const res = await rolesService.getPermissionTree();
      setPermissions(res.data || []);
    } catch (err) {
      console.error("加载权限清单失败", err);
    }
  };

  useEffect(() => {
    loadRoles();
    loadPermissions();
  }, [loadRoles]);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCode.trim() || !formName.trim()) {
      setFormError("角色编码与名称为必填项");
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      await rolesService.createRole({
        code: formCode.trim(),
        name: formName.trim(),
        description: formDesc.trim() || undefined,
      });
      setCreateDialogOpen(false);
      loadRoles();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setFormError(axiosErr.response?.data?.message || "创建角色失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editRole) return;
    setSubmitting(true);
    setFormError("");
    try {
      await rolesService.updateRole(editRole.id, {
        name: formName.trim() || undefined,
        description: formDesc.trim() || undefined,
      });
      setEditRole(null);
      loadRoles();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setFormError(axiosErr.response?.data?.message || "修改角色失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignPermissionsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!permRole) return;
    setSubmitting(true);
    try {
      await rolesService.assignPermissions(permRole.id, selectedPermIDs);
      setPermRole(null);
      loadRoles();
    } catch (err) {
      console.error("权限分配失败", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRole = async (id: string) => {
    if (!confirm("确定要删除此角色吗？")) return;
    try {
      await rolesService.deleteRole(id);
      loadRoles();
    } catch (err) {
      console.error("删除角色失败", err);
    }
  };

  const openPermDialog = (role: RoleDTO) => {
    setPermRole(role);
    setSelectedPermIDs(role.permissions?.map((p) => p.id) || []);
  };

  const columns = useMemo<ColumnDef<RoleDTO>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="角色名称" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-primary/10 text-primary flex items-center justify-center">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div className="flex flex-col">
              <span className="font-medium text-foreground text-sm">{row.original.name}</span>
              <span className="text-xs text-muted-foreground">{row.original.description || "无描述"}</span>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "code",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Casbin 角色标识代码" />,
        cell: ({ row }) => (
          <Badge variant="secondary" className="font-mono text-xs">
            {row.original.code}
          </Badge>
        ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="状态" />,
        cell: ({ row }) => {
          const isActive = row.original.status === 1;
          return isActive ? (
            <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 gap-1 text-[11px]">
              <CheckCircle2 className="h-3 w-3" />
              <span>启用</span>
            </Badge>
          ) : (
            <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive gap-1 text-[11px]">
              <XCircle className="h-3 w-3" />
              <span>停用</span>
            </Badge>
          );
        },
      },
      {
        accessorKey: "permissions",
        header: "已授予权限点",
        cell: ({ row }) => {
          const perms = row.original.permissions || [];
          return (
            <div className="flex flex-wrap gap-1 max-w-xs">
              {perms.length === 0 ? (
                <span className="text-xs text-muted-foreground italic">未分配</span>
              ) : (
                perms.map((p) => (
                  <Badge key={p.id} variant="outline" className="text-[10px] font-mono">
                    {p.name}
                  </Badge>
                ))
              )}
            </div>
          );
        },
      },
      {
        id: "actions",
        header: "操作",
        cell: ({ row }) => {
          const role = row.original;
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
                <DropdownMenuItem
                  onClick={() => {
                    setEditRole(role);
                    setFormName(role.name);
                    setFormDesc(role.description || "");
                    setFormError("");
                  }}
                >
                  <Edit className="mr-2 h-4 w-4" />
                  <span>编辑名称/描述</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openPermDialog(role)}>
                  <Key className="mr-2 h-4 w-4" />
                  <span>配置授权资源</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleDeleteRole(role.id)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  <span>删除角色</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    []
  );

  return (
    <div className="w-full space-y-4">
      {/* 顶部操作区 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">角色与权限控制</h2>
          <p className="text-xs text-muted-foreground">
            Casbin RBAC 访问控制角色模型与细粒度授权策略配置
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => loadRoles()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            <span>刷新</span>
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setFormCode("");
              setFormName("");
              setFormDesc("");
              setFormError("");
              setCreateDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            <span>创建角色</span>
          </Button>
        </div>
      </div>

      {/* 企业级数据表格核心容器 */}
      <div className="w-full rounded-xl border border-border bg-card shadow-xs p-4">
        <DataTable
          columns={columns}
          data={roles}
          loading={loading}
          searchKey="name"
          searchPlaceholder="搜索角色名称..."
        />
      </div>

      {/* 创建角色弹窗 */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建安全角色</DialogTitle>
            <DialogDescription>为 Casbin RBAC 鉴权引擎添加新的角色身份定义</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSubmit} className="space-y-4 pt-2">
            {formError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="create-role-code">角色代码 (英文唯一标识) *</Label>
              <Input
                id="create-role-code"
                placeholder="例如：operator, auditor"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="create-role-name">角色名称 *</Label>
              <Input
                id="create-role-name"
                placeholder="例如：运维专员"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="create-role-desc">角色描述</Label>
              <Input
                id="create-role-desc"
                placeholder="简述该角色的职责与职权"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "正在保存..." : "确认创建"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 编辑角色弹窗 */}
      <Dialog open={!!editRole} onOpenChange={(open) => !open && setEditRole(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑角色信息</DialogTitle>
            <DialogDescription>修改该角色的展示名称与说明</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEditSubmit} className="space-y-4 pt-2">
            {formError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label className="text-muted-foreground">角色标识代码 (不可变)</Label>
              <Input value={editRole?.code || ""} disabled className="bg-muted font-mono" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-role-name">角色名称 *</Label>
              <Input
                id="edit-role-name"
                placeholder="例如：审计管理员"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-role-desc">角色描述</Label>
              <Input
                id="edit-role-desc"
                placeholder="简述该角色的职责与职权"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setEditRole(null)}>
                取消
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "正在保存..." : "保存修改"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 权限分配弹窗 */}
      <Dialog open={!!permRole} onOpenChange={(open) => !open && setPermRole(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>为【{permRole?.name}】分配权限</DialogTitle>
            <DialogDescription>勾选授权的菜单或 API 资源，点击确认后实时同步至 Casbin</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAssignPermissionsSubmit} className="space-y-4 pt-2">
            <div className="max-h-72 overflow-y-auto space-y-2 rounded-lg border border-border p-3 bg-muted/20">
              {permissions.length === 0 ? (
                <div className="text-center py-6 text-xs text-muted-foreground">暂无权限配置点</div>
              ) : (
                permissions.map((p) => {
                  const checked = selectedPermIDs.includes(p.id);
                  return (
                    <label
                      key={p.id}
                      className={`flex items-center justify-between p-2.5 rounded-lg border transition-colors cursor-pointer select-none ${
                        checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(val) => {
                            if (val) {
                              setSelectedPermIDs([...selectedPermIDs, p.id]);
                            } else {
                              setSelectedPermIDs(selectedPermIDs.filter((id) => id !== p.id));
                            }
                          }}
                        />
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-foreground">{p.name}</span>
                          <span className="text-[11px] text-muted-foreground font-mono">{p.code}</span>
                        </div>
                      </div>
                      <Badge variant={checked ? "default" : "outline"} className="text-xs">
                        {checked ? "已授权" : "未授予"}
                      </Badge>
                    </label>
                  );
                })
              )}
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setPermRole(null)}>
                取消
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "正在同步..." : "保存权限"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
