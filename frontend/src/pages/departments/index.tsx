import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { PaginationState } from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  CircleCheck,
  CircleSlash,
  FolderInput,
  FolderPen,
  FolderPlus,
  Mail,
  MoreHorizontal,
  Network,
  Phone,
  Plus,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { AuthSourceBadge, StatusDot } from "@/components/common/badges";
import { useConfirm } from "@/components/common/confirm-dialog";
import { departmentPathLabel } from "@/components/common/department-select";
import { DepartmentTree } from "@/components/common/department-tree";
import { PageHeader } from "@/components/common/page-header";
import {
  QueryErrorState,
  QueryPlaceholderNotice,
  isForbiddenQueryError,
} from "@/components/common/query-error-state";
import { StatCard, StatGrid } from "@/components/common/stat-card";
import { UserAvatar } from "@/components/common/user-avatar";
import { formatPercent } from "@/lib/format";
import { notify } from "@/lib/notify";
import { queryKeys } from "@/lib/query-keys";
import { collectIds, findNode, findPath, flattenTree } from "@/lib/tree";
import {
  departmentsService,
  type DepartmentNode,
} from "@/services/departments";
import type { UserDTO } from "@/services/types";
import { usersService } from "@/services/users";
import { useAuth } from "@/stores/auth-context";
import { DepartmentFormDialog } from "./components/department-form-dialog";
import { DepartmentMoveDialog } from "./components/department-move-dialog";

type FormState =
  | { mode: "create"; parentId: string | null }
  | { mode: "edit"; department: DepartmentNode }
  | null;

function siblingsOf(tree: DepartmentNode[], node: DepartmentNode) {
  if (!node.parent_id) return tree;
  return findNode(tree, node.parent_id)?.children ?? [];
}

export default function DepartmentsPage() {
  const { can } = useAuth();
  const canManage =
    can("departments:create") ||
    can("departments:update") ||
    can("departments:delete");
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(null);
  const [moving, setMoving] = useState<DepartmentNode | null>(null);
  const [dragMovePending, setDragMovePending] = useState(false);
  const [includeChildren, setIncludeChildren] = useState(true);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });

  const treeQuery = useQuery({
    queryKey: queryKeys.departmentTree,
    queryFn: async ({ signal }) => (await departmentsService.tree(signal)).data,
  });
  const treeForbidden = isForbiddenQueryError(treeQuery.error);
  const treeUnavailable =
    treeQuery.isError && (!treeQuery.data || treeForbidden);
  const tree = useMemo(
    () => (treeForbidden ? [] : (treeQuery.data?.items ?? [])),
    [treeQuery.data, treeForbidden],
  );
  const treeRevision = treeQuery.data?.revision ?? 0;
  const flat = useMemo(() => flattenTree(tree), [tree]);
  const selected = selectedId ? (findNode(tree, selectedId) ?? null) : null;

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let changed = false;
    if (next.get("create") === "1") {
      if (can("departments:create"))
        setForm({ mode: "create", parentId: null });
      next.delete("create");
      changed = true;
    }
    const focusId = next.get("focus");
    if (focusId && treeQuery.data) {
      if (findNode(tree, focusId)) setSelectedId(focusId);
      next.delete("focus");
      changed = true;
    }
    if (changed) setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, can, tree, treeQuery.data]);

  useEffect(() => {
    const nodes = treeQuery.data?.items;
    if (!nodes) return;
    if (!selectedId || !findNode(nodes, selectedId))
      setSelectedId(nodes[0]?.id ?? null);
  }, [treeQuery.data, selectedId]);

  useEffect(() => {
    setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }));
  }, [selectedId, includeChildren]);

  const canListUsers = can("users");
  const membersParams = {
    page: pagination.pageIndex + 1,
    page_size: pagination.pageSize,
    department_id: selectedId ?? undefined,
    include_children: includeChildren,
  };
  const membersQuery = useQuery({
    queryKey: queryKeys.users(membersParams),
    queryFn: async ({ signal }) =>
      (await usersService.list(membersParams, signal)).data,
    enabled: !!selectedId && canListUsers,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["departments"] });
    void queryClient.invalidateQueries({ queryKey: ["options"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }, [queryClient]);

  const moveByDrop = useCallback(
    async (
      sourceId: string,
      targetId: string,
      position: "before" | "inside" | "after",
    ) => {
      if (dragMovePending) return;
      const source = findNode(tree, sourceId);
      const target = findNode(tree, targetId);
      if (!source || !target || collectIds(source).includes(target.id)) return;
      const destination =
        position === "inside"
          ? `${findPath(tree, target.id)
              .map((node) => node.name)
              .join(" / ")} 下级`
          : `${departmentPathLabel(tree, target.parent_id) || "顶级"}中的「${target.name}」${position === "before" ? "之前" : "之后"}`;
      const accepted = await confirm({
        tone: "default",
        title: `确认移动部门「${source.name}」？`,
        description: `目标位置：${destination}。本次操作会整体移动该部门及其全部下级，并保持组织树 revision 一致。`,
        details: (
          <div className="grid grid-cols-2 gap-2 text-center text-xs">
            <div className="rounded-lg border bg-muted/40 py-2">
              <p className="text-lg font-semibold">
                {collectIds(source).length}
              </p>
              <p className="text-muted-foreground">部门（含下级）</p>
            </div>
            <div className="rounded-lg border bg-muted/40 py-2">
              <p className="text-lg font-semibold">
                {source.total_member_count}
              </p>
              <p className="text-muted-foreground">成员（含下级）</p>
            </div>
          </div>
        ),
        confirmText: "确认移动",
      });
      if (!accepted) return;
      setDragMovePending(true);
      try {
        if (position === "inside")
          await departmentsService.move(source.id, target.id, treeRevision);
        else
          await departmentsService.moveRelative(
            source.id,
            target.id,
            position,
            treeRevision,
          );
        setSelectedId(source.id);
        notify.success("部门已移动", `已将「${source.name}」移动到目标位置`);
        invalidate();
      } catch (error) {
        if (
          (error as { response?: { status?: number } })?.response?.status ===
          409
        ) {
          notify.error(
            "组织架构已被其他管理员修改，移动未执行；树已重新载入，请检查后重试。",
          );
        } else {
          notify.apiError(error, "移动部门失败");
        }
        await queryClient.invalidateQueries({
          queryKey: queryKeys.departmentTree,
        });
      } finally {
        setDragMovePending(false);
      }
    },
    [dragMovePending, tree, treeRevision, invalidate, queryClient, confirm],
  );

  const reorder = useCallback(
    async (node: DepartmentNode, direction: -1 | 1) => {
      const siblings = siblingsOf(tree, node);
      const index = siblings.findIndex((s) => s.id === node.id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= siblings.length) return;
      const ordered = [...siblings];
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      try {
        await departmentsService.reorder(
          ordered.map((s, i) => ({ id: s.id, sort_order: (i + 1) * 10 })),
          treeRevision,
        );
        invalidate();
      } catch (error) {
        notify.apiError(error, "调整排序失败");
      }
    },
    [tree, treeRevision, invalidate],
  );

  const remove = useCallback(
    (node: DepartmentNode) =>
      void confirm({
        title: `删除部门「${node.name}」？`,
        description:
          node.children.length > 0 || node.total_member_count > 0
            ? "该部门下仍有子部门或成员，系统会阻止删除。请先迁移子部门并将人员调岗。"
            : "删除后不可恢复，部门编码可被重新使用。",
        details:
          node.children.length > 0 || node.total_member_count > 0 ? (
            <div className="grid grid-cols-2 gap-2 text-center text-xs">
              <div className="rounded-lg border bg-muted/40 py-2">
                <p className="text-lg font-semibold">{node.children.length}</p>
                <p className="text-muted-foreground">子部门</p>
              </div>
              <div className="rounded-lg border bg-muted/40 py-2">
                <p className="text-lg font-semibold">
                  {node.total_member_count}
                </p>
                <p className="text-muted-foreground">成员（含下级）</p>
              </div>
            </div>
          ) : undefined,
        confirmText: "确认删除",
        onConfirm: async () => {
          try {
            await departmentsService.remove(node.id, treeRevision);
            notify.success("部门已删除", node.name);
            if (selectedId === node.id) setSelectedId(node.parent_id);
            invalidate();
          } catch (error) {
            notify.apiError(error, "无法删除部门");
            throw error;
          }
        },
      }),
    [confirm, invalidate, selectedId, treeRevision],
  );

  const actionsFor = (node: DepartmentNode) => {
    const siblings = siblingsOf(tree, node);
    const index = siblings.findIndex((s) => s.id === node.id);
    return (
      <>
        {can("departments:update") && (
          <DropdownMenuItem
            onClick={() => setForm({ mode: "edit", department: node })}
          >
            <FolderPen />
            编辑部门
          </DropdownMenuItem>
        )}
        {can("departments:create") && (
          <DropdownMenuItem
            onClick={() => setForm({ mode: "create", parentId: node.id })}
          >
            <FolderPlus />
            新增子部门
          </DropdownMenuItem>
        )}
        {can("departments:update") && (
          <>
            <DropdownMenuItem onClick={() => setMoving(node)}>
              <FolderInput />
              移动到…
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index <= 0}
              onClick={() => void reorder(node, -1)}
            >
              <ArrowUp />
              上移
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index < 0 || index >= siblings.length - 1}
              onClick={() => void reorder(node, 1)}
            >
              <ArrowDown />
              下移
            </DropdownMenuItem>
          </>
        )}
        {can("departments:delete") && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => remove(node)}
            >
              <Trash2 />
              删除部门
            </DropdownMenuItem>
          </>
        )}
      </>
    );
  };

  const memberColumns = useMemo<ColumnDef<UserDTO>[]>(
    () => [
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
          <span className="text-sm">
            {row.original.department?.name ?? "—"}
          </span>
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
    ],
    [],
  );

  const stats = useMemo(
    () => ({
      total: flat.length,
      enabled: flat.filter((d) => d.status === 1).length,
      disabled: flat.filter((d) => d.status !== 1).length,
      directory: flat.filter((d) => d.source === "ldap").length,
      members: tree.reduce((sum, d) => sum + d.total_member_count, 0),
    }),
    [flat, tree],
  );

  const path = selected ? findPath(tree, selected.id) : [];
  return (
    <>
      <PageHeader
        icon={Network}
        title="部门管理"
        description="维护企业组织架构树，支持多级部门、负责人与排序调整"
        badge={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary dark:text-violet-300">
            <span className="size-1.5 rounded-full bg-primary animate-pulse" />
            {treeQuery.isError && !treeQuery.data
              ? "部门统计暂不可用"
              : `共 ${stats.total} 个部门 · ${stats.members} 名成员`}
          </span>
        }
        actions={
          can("departments:create") && (
            <Button
              onClick={() => setForm({ mode: "create", parentId: null })}
              className="shadow-xs"
            >
              <FolderPlus />
              新建部门
            </Button>
          )
        }
      />

      <StatGrid>
        <StatCard
          label="部门总数"
          value={treeUnavailable ? "—" : stats.total}
          icon={Network}
          tone="primary"
          loading={treeQuery.isLoading}
          hint={
            treeUnavailable ? "部门数据不可用" : `覆盖成员 ${stats.members} 人`
          }
        />
        <StatCard
          label="启用部门"
          value={treeUnavailable ? "—" : stats.enabled}
          icon={CircleCheck}
          tone="success"
          loading={treeQuery.isLoading}
          hint={
            treeUnavailable
              ? "部门数据不可用"
              : `占全部部门 ${formatPercent(stats.enabled, stats.total)}`
          }
        />
        <StatCard
          label="停用部门"
          value={treeUnavailable ? "—" : stats.disabled}
          icon={CircleSlash}
          tone="default"
          loading={treeQuery.isLoading}
          hint="停用部门不可再调入人员"
        />
        <StatCard
          label="目录同步部门"
          value={treeUnavailable ? "—" : stats.directory}
          icon={FolderInput}
          tone="info"
          loading={treeQuery.isLoading}
          hint="由 AD / LDAP 组织单元自动生成"
        />
      </StatGrid>

      {treeQuery.isError && treeQuery.data && !treeForbidden && (
        <QueryErrorState
          error={treeQuery.error}
          label="部门树"
          onRetry={() => void treeQuery.refetch()}
          retrying={treeQuery.isFetching}
        />
      )}

      {treeQuery.isLoading ? (
        <div className="grid grid-cols-12 gap-4">
          <Skeleton className="col-span-12 h-96 rounded-xl lg:col-span-4 xl:col-span-3" />
          <Skeleton className="col-span-12 h-96 rounded-xl lg:col-span-8 xl:col-span-9" />
        </div>
      ) : treeUnavailable ? (
        <QueryErrorState
          error={treeQuery.error}
          label="部门树"
          onRetry={() => void treeQuery.refetch()}
          retrying={treeQuery.isFetching}
        />
      ) : tree.length === 0 ? (
        <Empty className="border border-dashed bg-card/50 py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Network />
            </EmptyMedia>
            <EmptyTitle>还没有任何部门</EmptyTitle>
            <EmptyDescription>
              从顶级部门开始搭建组织架构，或在「目录同步」中按 OU 自动导入
            </EmptyDescription>
          </EmptyHeader>
          {can("departments:create") && (
            <EmptyContent>
              <Button
                onClick={() => setForm({ mode: "create", parentId: null })}
              >
                <Plus />
                创建第一个部门
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <div className="grid grid-cols-12 gap-4">
          <Card className="col-span-12 h-fit gap-3 self-start lg:sticky lg:top-0 lg:col-span-4 xl:col-span-3">
            <CardHeader>
              <CardTitle className="text-sm">组织架构</CardTitle>
              <CardDescription className="text-xs">
                悬停节点可快速新增、编辑或调整顺序
              </CardDescription>
            </CardHeader>
            <CardContent className="max-h-96 overflow-y-auto lg:max-h-[calc(100svh-15rem)]">
              <DepartmentTree
                nodes={tree}
                selectedKey={selectedId}
                onSelect={(key) => setSelectedId(key)}
                canMove={can("departments:update") && !dragMovePending}
                onMoveDrop={(sourceId, targetId, position) =>
                  void moveByDrop(sourceId, targetId, position)
                }
                defaultExpandDepth={3}
                renderActions={
                  canManage
                    ? (node) => (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`${node.name} 的操作`}
                              />
                            }
                          >
                            <MoreHorizontal />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-40">
                            {actionsFor(node)}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )
                    : undefined
                }
              />
            </CardContent>
          </Card>

          <div className="col-span-12 min-w-0 space-y-4 lg:col-span-8 xl:col-span-9">
            {selected && (
              <Card className="gap-0 py-0">
                <div className="flex flex-col gap-4 border-b bg-gradient-to-r from-primary/[0.05] to-transparent p-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-2">
                    <p className="truncate text-xs text-muted-foreground">
                      {path
                        .slice(0, -1)
                        .map((p) => p.name)
                        .join(" / ") || "顶级部门"}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold tracking-tight">
                        {selected.name}
                      </h2>
                      <Badge variant="outline" className="font-mono">
                        {selected.code}
                      </Badge>
                      <StatusDot active={selected.status === 1} />
                      {selected.source === "ldap" && (
                        <Badge
                          variant="outline"
                          className="gap-1 border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                        >
                          <FolderInput />
                          目录同步
                        </Badge>
                      )}
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap gap-2">
                      {can("departments:create") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setForm({ mode: "create", parentId: selected.id })
                          }
                        >
                          <FolderPlus />
                          子部门
                        </Button>
                      )}
                      {can("departments:update") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setForm({ mode: "edit", department: selected })
                          }
                        >
                          <FolderPen />
                          编辑
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              size="icon-sm"
                              variant="outline"
                              aria-label="更多操作"
                            />
                          }
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          {actionsFor(selected)}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-px bg-border/60 sm:grid-cols-4">
                  {[
                    {
                      icon: UserRound,
                      label: "负责人",
                      value: selected.leader_name || "未指定",
                    },
                    {
                      icon: Users,
                      label: "直属 / 含下级成员",
                      value: `${selected.member_count} / ${selected.total_member_count}`,
                    },
                    {
                      icon: Phone,
                      label: "联系电话",
                      value: selected.phone || "—",
                    },
                    {
                      icon: Mail,
                      label: "部门邮箱",
                      value: selected.email || "—",
                    },
                  ].map((item) => (
                    <div key={item.label} className="bg-card px-5 py-3.5">
                      <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <item.icon className="size-3.5" />
                        {item.label}
                      </dt>
                      <dd className="mt-1 truncate text-sm font-medium">
                        {item.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Card>
            )}

            <Card className="min-w-0 gap-3">
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-sm">部门成员</CardTitle>
                  <CardDescription className="text-xs">
                    {departmentPathLabel(tree, selectedId)}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-1.5">
                  <Label
                    htmlFor="dept-include-children"
                    className="text-xs font-normal text-muted-foreground"
                  >
                    含下级部门
                  </Label>
                  <Switch
                    id="dept-include-children"
                    size="sm"
                    checked={includeChildren}
                    onCheckedChange={setIncludeChildren}
                  />
                </div>
              </CardHeader>
              <CardContent>
                {!canListUsers ? (
                  <p className="rounded-lg border border-dashed py-10 text-center text-xs text-muted-foreground">
                    当前角色无权查看人员列表
                  </p>
                ) : membersQuery.isError &&
                  (!membersQuery.data ||
                    isForbiddenQueryError(membersQuery.error)) ? (
                  <QueryErrorState
                    error={membersQuery.error}
                    label="部门成员"
                    onRetry={() => void membersQuery.refetch()}
                    retrying={membersQuery.isFetching}
                  />
                ) : (
                  <>
                    {membersQuery.isPlaceholderData && (
                      <QueryPlaceholderNotice label="部门成员" />
                    )}
                    {membersQuery.isError && membersQuery.data && (
                      <QueryErrorState
                        error={membersQuery.error}
                        label="部门成员"
                        onRetry={() => void membersQuery.refetch()}
                        retrying={membersQuery.isFetching}
                      />
                    )}
                    <DataTable
                      columns={memberColumns}
                      data={membersQuery.data?.items ?? []}
                      loading={membersQuery.isLoading}
                      getRowId={(u) => u.id}
                      serverFiltering
                      hideSearch
                      serverPagination={{
                        pageIndex: pagination.pageIndex,
                        pageSize: pagination.pageSize,
                        total: membersQuery.data?.total ?? 0,
                        onChange: setPagination,
                      }}
                      onRefresh={() => void membersQuery.refetch()}
                      isRefreshing={membersQuery.isFetching}
                      emptyTitle="该部门暂无成员"
                      emptyDescription="可在「用户管理」中通过批量调岗将人员调入此部门"
                    />
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <DepartmentFormDialog
        open={form !== null}
        onOpenChange={(open) => !open && setForm(null)}
        department={form?.mode === "edit" ? form.department : null}
        parentId={form?.mode === "create" ? form.parentId : null}
        departments={tree}
        treeRevision={treeRevision}
        onSaved={(id) => setSelectedId(id)}
      />
      <DepartmentMoveDialog
        department={moving}
        departments={tree}
        treeRevision={treeRevision}
        onOpenChange={(open) => !open && setMoving(null)}
        onMoved={(id) => setSelectedId(id)}
      />
    </>
  );
}
