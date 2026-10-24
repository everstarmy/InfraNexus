import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Info,
  Copy,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  UserRoundPen,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { DepartmentSelect } from "@/components/common/department-select";
import { useConfirm } from "@/components/common/confirm-dialog";
import { PasswordStrength } from "@/components/common/password-strength";
import {
  getErrorMessage,
  getErrorStatus,
  getFieldErrors,
} from "@/lib/api-error";
import { notify } from "@/lib/notify";
import { generatePassword, meetsPolicy } from "@/lib/password";
import { cn } from "@/lib/utils";
import type { DepartmentNode } from "@/services/departments";
import type { RoleRef, UserDTO } from "@/services/types";
import { usersService } from "@/services/users";
import { useAuth } from "@/stores/auth-context";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";

interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: UserDTO | null;
  departments: DepartmentNode[];
  treeRevision: number;
  roles: RoleRef[];
  defaultDepartmentId?: string | null;
}

export function UserFormDialog({
  open,
  onOpenChange,
  user,
  departments,
  treeRevision,
  roles,
  defaultDepartmentId,
}: UserFormDialogProps) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const confirm = useConfirm();
  const editing = !!user;
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [editRevision, setEditRevision] = useState(0);
  const [baseline, setBaseline] = useState({
    username: "",
    email: "",
    nickname: "",
    departmentId: null as string | null,
  });
  const [conflictUser, setConflictUser] = useState<UserDTO | null>(null);
  const initializedUserRef = useRef<string | null | undefined>(undefined);
  const formErrorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      initializedUserRef.current = undefined;
      return;
    }
    const userID = user?.id ?? null;
    if (initializedUserRef.current === userID) return;
    initializedUserRef.current = userID;
    const initial = {
      username: user?.username ?? "",
      email: user?.email ?? "",
      nickname: user?.nickname ?? "",
      departmentId: user
        ? (user.department_id ?? null)
        : (defaultDepartmentId ?? null),
    };
    setBaseline(initial);
    setUsername(initial.username);
    setEmail(initial.email);
    setNickname(initial.nickname);
    setPassword("");
    setDepartmentId(initial.departmentId);
    setRoleIds([]);
    setFieldErrors({});
    setFormError("");
    setConflictUser(null);
    setEditRevision(user?.edit_revision ?? 0);
  }, [open, user?.id, defaultDepartmentId]);

  useEffect(() => {
    if (formError) formErrorRef.current?.focus();
  }, [formError]);

  const isDirty =
    open &&
    (username !== baseline.username ||
      email.trim() !== baseline.email ||
      nickname.trim() !== baseline.nickname ||
      (!editing &&
        (password !== "" ||
          departmentId !== baseline.departmentId ||
          roleIds.length > 0)));
  const conflictDifferences = conflictUser
    ? [
        {
          label: "昵称",
          draft: nickname.trim(),
          current: conflictUser.nickname ?? "",
        },
        { label: "邮箱", draft: email.trim(), current: conflictUser.email },
      ].filter((item) => item.draft !== item.current)
    : [];
  useUnsavedChanges(isDirty, "用户资料尚未保存。离开后这些更改将丢失。");

  const mutation = useMutation({
    mutationFn: async () => {
      if (editing && user) {
        const payload: {
          nickname?: string;
          email?: string;
          expected_revision: number;
        } = {
          expected_revision: editRevision,
        };
        if (email.trim() !== baseline.email) payload.email = email.trim();
        if (nickname.trim() !== baseline.nickname)
          payload.nickname = nickname.trim();
        return usersService.update(user.id, payload);
      }
      return usersService.create({
        username: username.trim(),
        email: email.trim(),
        password,
        nickname: nickname.trim() || undefined,
        expected_revision: treeRevision,
        ...(can("users:move") && { department_id: departmentId }),
        ...(can("users:assign-roles") && { role_ids: roleIds }),
      });
    },
    onSuccess: (res) => {
      notify.success(
        editing ? "用户资料已更新" : "用户已创建",
        res.data.nickname || res.data.username,
      );
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      void queryClient.invalidateQueries({ queryKey: ["options"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (!editing) {
        void queryClient.invalidateQueries({ queryKey: ["departments"] });
        void queryClient.invalidateQueries({ queryKey: ["roles"] });
      }
      setBaseline({
        username: res.data.username,
        email: res.data.email,
        nickname: res.data.nickname ?? "",
        departmentId: res.data.department_id ?? null,
      });
      onOpenChange(false);
    },
    onError: (error) => {
      setFieldErrors(getFieldErrors(error));
      setFormError(
        getErrorMessage(error, editing ? "更新用户失败" : "创建用户失败"),
      );
      if (editing && user && getErrorStatus(error) === 409) {
        void usersService
          .get(user.id)
          .then((res) => setConflictUser(res.data))
          .catch(() => setConflictUser(null));
      }
    },
  });

  const directoryManaged = editing && user?.auth_type !== "local";
  const canSubmit = editing
    ? editRevision > 0 && !!email.trim() && isDirty && !mutation.isPending
    : true;
  const clearFieldError = (field: string) =>
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  // Creation keeps the submit button available and explains what is missing,
  // instead of a silently disabled button.
  const validateCreate = () => {
    const errors: Record<string, string> = {};
    const name = username.trim();
    if (name.length < 3 || name.length > 32) errors.username = "invalid";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = "invalid";
    if (!meetsPolicy(password)) errors.password = "weak";
    return errors;
  };
  const requestClose = async () => {
    if (mutation.isPending) return;
    if (isDirty) {
      const discard = await confirm({
        tone: "default",
        title: "放弃用户更改？",
        description: "当前表单尚未保存，离开后这些更改将丢失。",
        confirmText: "放弃更改",
      });
      if (!discard) return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : void requestClose())}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {editing ? (
              <UserRoundPen className="size-4.5 text-primary" />
            ) : (
              <UserPlus className="size-4.5 text-primary" />
            )}
            {editing ? "编辑用户" : "新建用户"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? `修改 ${user?.nickname || user?.username} 的基础资料`
              : "创建本地账号，并按当前权限设置初始部门与角色"}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!editing) {
              const errors = validateCreate();
              const first = (["username", "email", "password"] as const).find((field) => errors[field]);
              if (first) {
                setFieldErrors(errors);
                document.getElementById(`user-${first}`)?.focus();
                return;
              }
            }
            if (canSubmit) mutation.mutate();
          }}
        >
          {formError && (
            <Alert
              ref={formErrorRef}
              tabIndex={-1}
              role="alert"
              aria-live="assertive"
              variant="destructive"
            >
              <Info />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          {conflictUser && (
            <Alert role="group" aria-label="用户资料并发冲突">
              <Info />
              <AlertDescription className="space-y-2">
                <span>
                  检测到并发修改。你的草稿仍保留；请比较两侧字段后确认是否继续提交。
                </span>
                {conflictDifferences.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-xs">
                    {conflictDifferences.map((item) => (
                      <li key={item.label}>
                        {item.label}：你的草稿“{item.draft || "（空）"}
                        ”；服务器当前值“{item.current || "（空）"}”
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    setEditRevision(conflictUser.edit_revision);
                    setConflictUser(null);
                    setFormError("");
                  }}
                >
                  确认保留草稿并继续编辑
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {directoryManaged && (
            <Alert>
              <Info />
              <AlertDescription>
                该账号来自目录域 {user?.domain}
                ，昵称、邮箱与部门可能在下次目录同步时被覆盖。
              </AlertDescription>
            </Alert>
          )}

          <FieldGroup className="gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!fieldErrors.username || undefined}>
                <FieldLabel htmlFor="user-username">用户名</FieldLabel>
                <Input
                  id="user-username"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    clearFieldError("username");
                  }}
                  placeholder="如 zhangsan"
                  disabled={editing}
                  autoComplete="off"
                  aria-invalid={!!fieldErrors.username || undefined}
                  aria-describedby={
                    fieldErrors.username ? "user-username-error" : undefined
                  }
                />
                {fieldErrors.username && (
                  <FieldError id="user-username-error">
                    用户名需为 3-32 个字符
                  </FieldError>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor="user-nickname">姓名 / 昵称</FieldLabel>
                <Input
                  id="user-nickname"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="如 张三"
                />
              </Field>
            </div>
            <Field data-invalid={!!fieldErrors.email || undefined}>
              <FieldLabel htmlFor="user-email">电子邮箱</FieldLabel>
              <Input
                id="user-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearFieldError("email");
                }}
                placeholder="name@company.com"
                aria-invalid={!!fieldErrors.email || undefined}
                aria-describedby={
                  fieldErrors.email ? "user-email-error" : undefined
                }
              />
              {fieldErrors.email && (
                <FieldError id="user-email-error">
                  请输入有效的邮箱地址
                </FieldError>
              )}
            </Field>
            {!editing && can("users:move") && (
              <Field>
                <FieldLabel htmlFor="user-department">所属部门</FieldLabel>
                <DepartmentSelect
                  id="user-department"
                  nodes={departments}
                  value={departmentId}
                  onChange={setDepartmentId}
                  placeholder="暂不分配部门"
                  allowClear
                />
              </Field>
            )}

            {!editing && (
              <>
                <Field data-invalid={!!fieldErrors.password || undefined}>
                  <FieldLabel htmlFor="user-password">初始密码</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="user-password"
                      type="text"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        clearFieldError("password");
                      }}
                      placeholder="至少 8 位，含 3 类字符"
                      autoComplete="new-password"
                      spellCheck={false}
                      className="font-mono placeholder:font-sans"
                      aria-invalid={!!fieldErrors.password || undefined}
                      aria-describedby={fieldErrors.password ? "user-password-error" : undefined}
                    />
                    <InputGroupAddon align="inline-end">
                      {password && (
                        <InputGroupButton
                          size="icon-xs"
                          aria-label="复制密码"
                          title="复制密码"
                          onClick={() => {
                            void navigator.clipboard
                              ?.writeText(password)
                              .then(() => notify.success("初始密码已复制"))
                              .catch(() => notify.error("复制失败", "请手动选择密码文本复制"));
                          }}
                        >
                          <Copy />
                        </InputGroupButton>
                      )}
                      <InputGroupButton
                        size="xs"
                        onClick={() => {
                          setPassword(generatePassword());
                          clearFieldError("password");
                        }}
                      >
                        <RefreshCw />
                        随机生成
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  <PasswordStrength password={password} />
                  {fieldErrors.password && (
                    <FieldError id="user-password-error">
                      密码强度不足，请按上方规则调整或使用随机生成
                    </FieldError>
                  )}
                </Field>
                {can("users:assign-roles") && (
                <Field>
                  <FieldLabel>初始角色</FieldLabel>
                  <FieldDescription>可多选，角色的权限取并集</FieldDescription>
                  <div className="grid max-h-40 gap-1.5 overflow-y-auto sm:grid-cols-2">
                    {roles.map((role) => {
                      const checked = roleIds.includes(role.id);
                      return (
                        <label
                          key={role.id}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition-colors",
                            checked
                              ? "border-primary/40 bg-primary/5"
                              : "hover:bg-muted/50",
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) =>
                              setRoleIds((prev) =>
                                v
                                  ? [...prev, role.id]
                                  : prev.filter((id) => id !== role.id),
                              )
                            }
                          />
                          <ShieldCheck className="size-3.5 text-muted-foreground" />
                          <span className="truncate">{role.name}</span>
                          <code className="ml-auto font-mono text-[10px] text-muted-foreground">
                            {role.code}
                          </code>
                        </label>
                      );
                    })}
                  </div>
                </Field>
                )}
              </>
            )}
          </FieldGroup>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => void requestClose()}
              disabled={mutation.isPending}
            >
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit || mutation.isPending}>
              {mutation.isPending && <Spinner />}
              {editing ? "保存修改" : "创建用户"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
