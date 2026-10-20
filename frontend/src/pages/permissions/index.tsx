import React, { useState, useEffect } from "react";
import { KeyRound, Shield, Globe, Terminal, RefreshCw, Layers } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { rolesService, PermissionDTO } from "@/services/roles";

export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<PermissionDTO[]>([]);
  const [loading, setLoading] = useState(false);

  const loadPermissions = async () => {
    setLoading(true);
    try {
      const res = await rolesService.getPermissionTree();
      setPermissions(res.data || []);
    } catch (err) {
      console.error("加载权限清单失败", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPermissions();
  }, []);

  const defaultMockPerms: PermissionDTO[] = [
    {
      id: "perm-1",
      code: "users:view",
      name: "用户列表查看",
      type: "api",
      path: "/api/v1/users",
      method: "GET",
    },
    {
      id: "perm-2",
      code: "users:create",
      name: "创建用户账号",
      type: "api",
      path: "/api/v1/users",
      method: "POST",
    },
    {
      id: "perm-3",
      code: "users:edit",
      name: "修改用户资料",
      type: "api",
      path: "/api/v1/users/:id",
      method: "PUT",
    },
    {
      id: "perm-4",
      code: "roles:view",
      name: "角色列表查看",
      type: "api",
      path: "/api/v1/roles",
      method: "GET",
    },
    {
      id: "perm-5",
      code: "roles:assign",
      name: "分配角色权限",
      type: "api",
      path: "/api/v1/roles/:id/permissions",
      method: "POST",
    },
    {
      id: "perm-6",
      code: "system:sse",
      name: "实时通知订阅通道",
      type: "api",
      path: "/api/v1/sse/notifications",
      method: "GET",
    },
  ];

  const displayList = permissions.length > 0 ? permissions : defaultMockPerms;

  // 按前缀分组
  const groups: { [key: string]: PermissionDTO[] } = {
    "用户管理模块 (Users API)": displayList.filter((p) => p.code.startsWith("users:")),
    "角色鉴权模块 (Roles API)": displayList.filter((p) => p.code.startsWith("roles:")),
    "系统基础模块 (System / SSE)": displayList.filter(
      (p) => !p.code.startsWith("users:") && !p.code.startsWith("roles:")
    ),
  };

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">系统权限清单与 API 资源</h2>
          <p className="text-xs text-muted-foreground">
            Casbin 细粒度拦截策略的受控资源列表与操作点
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={loadPermissions} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          <span>刷新规则</span>
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
        <Accordion className="w-full space-y-4">
          {Object.entries(groups).map(([groupTitle, items], index) => {
            if (items.length === 0) return null;
            return (
              <AccordionItem key={groupTitle} value={`item-${index}`} className="border-border">
                <AccordionTrigger className="hover:no-underline py-3 px-2 rounded-lg hover:bg-muted/40">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-sm">{groupTitle}</span>
                    <Badge variant="secondary" className="ml-2 text-xs">
                      {items.length} 个规则点
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-1">
                    {items.map((p) => (
                      <Card key={p.id} className="border-border/80 hover:border-primary/50 transition-colors shadow-none">
                        <CardHeader className="p-3.5 pb-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <div className="h-7 w-7 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                                <KeyRound className="h-3.5 w-3.5" />
                              </div>
                              <div>
                                <CardTitle className="text-xs font-semibold">{p.name}</CardTitle>
                                <CardDescription className="font-mono text-[10px] text-muted-foreground mt-0.5">
                                  {p.code}
                                </CardDescription>
                              </div>
                            </div>
                            <Badge variant="outline" className="uppercase text-[9px] font-semibold">
                              {p.type}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="p-3.5 pt-0 text-xs">
                          {p.path && (
                            <div className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5 font-mono text-[11px] border border-border/40">
                              <Badge variant="secondary" className="text-[9px] uppercase font-bold py-0 h-4">
                                {p.method || "ALL"}
                              </Badge>
                              <span className="text-muted-foreground truncate">{p.path}</span>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>
    </div>
  );
}
