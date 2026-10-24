import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { StatusDot } from "@/components/common/badges";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { UserDTO } from "@/services/types";

export function StatusCell({
  user,
  meId,
  canToggle,
  stale,
  onToggle,
}: {
  user: UserDTO;
  meId?: string;
  canToggle: boolean;
  stale: boolean;
  onToggle: (user: UserDTO, enabled: boolean) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const reason =
    user.id === meId
      ? "不能停用当前登录账号"
      : user.built_in
        ? "内置管理员账号不可停用"
        : !canToggle
          ? "没有启停账号的权限"
          : "";
  const active = user.status === 1;
  const control = (
    <div
      className="flex items-center gap-2.5"
      onClick={(e) => e.stopPropagation()}
    >
      <Switch
        checked={active}
        disabled={pending || !!reason || stale}
        aria-label={active ? "停用账号" : "启用账号"}
        onCheckedChange={async (checked) => {
          setPending(true);
          try {
            await onToggle(user, checked);
          } finally {
            setPending(false);
          }
        }}
      />
      <StatusDot active={active} />
    </div>
  );
  if (!reason || user.status !== 1) return control;
  return (
    <Tooltip>
      <TooltipTrigger render={<div className="inline-flex" />}>
        {control}
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
