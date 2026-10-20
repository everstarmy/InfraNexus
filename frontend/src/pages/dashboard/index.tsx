import React from "react";
import {
  Users,
  ShieldCheck,
  Server,
  Zap,
  ArrowUpRight,
  TrendingUp,
  Activity,
  Layers,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function DashboardPage() {
  return (
    <div className="w-full space-y-6">
      {/* 顶部欢迎区 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">系统概览与运维看板</h2>
          <p className="text-sm text-muted-foreground">
            基于 GoFiber v3 内核与 React 19 构建的云原生 SaaS 敏捷架构
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1.5"></span>
            全服务运行中
          </Badge>
          <Button size="sm">
            <span>创建资源</span>
            <ArrowUpRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 12 列流式代码网格：顶部 4 大核心指标卡片 */}
      <div className="grid grid-cols-12 gap-4 md:gap-6 w-full">
        {/* 指标卡 1 */}
        <Card className="col-span-12 sm:col-span-6 lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">总用户量</CardTitle>
            <div className="h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center">
              <Users className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">1,248</div>
            <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 mt-1">
              <TrendingUp className="h-3.5 w-3.5" />
              <span>较上周环比增长 +12.5%</span>
            </div>
          </CardContent>
        </Card>

        {/* 指标卡 2 */}
        <Card className="col-span-12 sm:col-span-6 lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">角色权限矩阵</CardTitle>
            <div className="h-8 w-8 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <ShieldCheck className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">8 个活跃角色</div>
            <div className="text-xs text-muted-foreground mt-1">
              Casbin GORM 动态规则实时同步
            </div>
          </CardContent>
        </Card>

        {/* 指标卡 3 */}
        <Card className="col-span-12 sm:col-span-6 lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">API 请求吞吐</CardTitle>
            <div className="h-8 w-8 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Zap className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">18,920 QPS</div>
            <div className="text-xs text-muted-foreground mt-1">
              Fiber v3 fasthttp 极致高并发
            </div>
          </CardContent>
        </Card>

        {/* 指标卡 4 */}
        <Card className="col-span-12 sm:col-span-6 lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">存储与缓存模式</CardTitle>
            <div className="h-8 w-8 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
              <Server className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">双擎数据库</div>
            <div className="text-xs text-muted-foreground mt-1">
              PostgreSQL / SQLite 无缝切换
            </div>
          </CardContent>
        </Card>

        {/* 主数据分析区 (8 列) */}
        <Card className="col-span-12 lg:col-span-8">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold">架构拓扑与运行链路</CardTitle>
                <CardDescription>InfraNexus 全栈企业脚手架技术栈特性</CardDescription>
              </div>
              <Activity className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg border border-border bg-muted/20">
                  <div className="flex items-center gap-2 font-medium text-sm text-foreground mb-1">
                    <Layers className="h-4 w-4 text-primary" />
                    <span>后端架构亮点 (Go 1.27+)</span>
                  </div>
                  <ul className="text-xs text-muted-foreground space-y-1.5 mt-2">
                    <li>• 全表 UUID 主键自动发号与泛型仓储抽象</li>
                    <li>• GORM 原生支持 JSONB 字段 (datatypes.JSONType)</li>
                    <li>• HttpOnly Session Cookie 与 JWT 双通道认证</li>
                    <li>• Casbin RBAC 细粒度资源拦截</li>
                  </ul>
                </div>

                <div className="p-4 rounded-lg border border-border bg-muted/20">
                  <div className="flex items-center gap-2 font-medium text-sm text-foreground mb-1">
                    <Zap className="h-4 w-4 text-amber-500" />
                    <span>前端架构亮点 (React 19)</span>
                  </div>
                  <ul className="text-xs text-muted-foreground space-y-1.5 mt-2">
                    <li>• 12 列全宽响应式流式画布，大屏不收窄</li>
                    <li>• Base UI 原语 (@base-ui/react) 与 Tailwind v4</li>
                    <li>• 深度集成企业级 TanStack Table v9 数据表格</li>
                    <li>• Axios 拦截器无感滑动刷新与会话延期</li>
                  </ul>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 辅助操作与状态监测区 (4 列) */}
        <Card className="col-span-12 lg:col-span-4">
          <CardHeader>
            <CardTitle className="text-base font-semibold">平台状态快捷指引</CardTitle>
            <CardDescription>关键服务与集成套件监控</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">HTTP 引擎</span>
              <Badge variant="secondary" className="font-mono">GoFiber v3</Badge>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">ORM 引擎</span>
              <Badge variant="secondary" className="font-mono">GORM v1.31+</Badge>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">权限中枢</span>
              <Badge variant="secondary" className="font-mono">Casbin v3 GORM</Badge>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">表格套件</span>
              <Badge variant="secondary" className="font-mono">TanStack Table v9</Badge>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">实时推送</span>
              <Badge variant="secondary" className="font-mono">Server-Sent Events</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
