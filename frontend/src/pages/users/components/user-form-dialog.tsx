import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-form";
import {
  Info,
  Copy,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  UserRoundPen,
} from "lucide-react";
import { z } from "zod";
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
  FieldDescription,
  FieldGroup,
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
import { FormField, useAppForm } from "@/components/form";
import { getErrorStatus } from "@/lib/api-error";
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

interface UserFormValues {
  username: string;
  email: string;
  nickname: string;
  password: string;
  departmentId: string | null;
  roleIds: string[];
}

function createUserFormSchema(editing: boolean) {
  return z.object({
    username: editing
      ? z.string()
      : z
          .string()
          .trim()
          .min(3, "用户名需为 3-32 个字符")
          .max(32, "用户名需为 3-32 个字符"),
    nickname: z.string().trim().max(64, "姓名 / 昵称不能超过 64 个字符"),
    email: z
      .string()
      .trim()
      .min(1, "请输入有效的邮箱地址")
      .email("请输入有效的邮箱地址")
      .max(128, "邮箱长度不能超过 128 个字符"),
    password: editing
      ? z.string()
      : z
          .string()
          .max(128, "密码不能超过 128 个字符")
          .refine(meetsPolicy, "密码强度不足，请按上方规则调整或使用随机生成"),
    departmentId: z.string().nullable(),
    roleIds: editing
      ? z.array(z.string())
      : z.array(z.string()).max(50, "最多只能分配 50 个初始角色"),
  });
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
  const [editRevision, setEditRevision] = useState(0);
  const [conflictUser, setConflictUser] = useState<UserDTO | null>(null);
  const [conflictDismissed, setConflictDismissed] = useState(false);
  const formErrorRef = useRef<HTMLDivElement>(null);

  const defaultValues = useMemo<UserFormValues>(
    () => ({
      username: user?.username ?? "",
      email: user?.email ?? "",
      nickname: user?.nickname ?? "",
      password: "",
      departmentId: user
        ? (user.department_id ?? null)
        : (defaultDepartmentId ?? null),
      roleIds: [],
    }),
    [user, defaultDepartmentId],
  );

  const schema = useMemo(() => createUserFormSchema(editing), [editing]);

  useEffect(() => {
    if (!open) {
      setConflictUser(null);
      setConflictDismissed(false);
      return;
    }
    setEditRevision(user?.edit_revision ?? 0);
    setConflictUser(null);
    setConflictDismissed(false);
  }, [open, user?.id, user?.edit_revision]);

  const mutation = useMutation({
    mutationFn: async (values: UserFormValues) => {
      if (editing && user) {
        const payload: {
          nickname?: string;
          email?: string;
          expected_revision: number;
        } = {
          expected_revision: editRevision,
        };
        if (values.email.trim() !== (user.email ?? "")) {
          payload.email = values.email.trim();
        }
        if (values.nickname.trim() !== (user.nickname ?? "")) {
          payload.nickname = values.nickname.trim();
        }
        return usersService.update(user.id, payload);
      }
      return usersService.create({
        username: values.username.trim(),
        email: values.email.trim(),
        password: values.password,
        nickname: values.nickname.trim() || undefined,
        expected_revision: treeRevision,
        ...(can("users:move") && { department_id: values.departmentId }),
        ...(can("users:assign-roles") && { role_ids: values.roleIds }),
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
      onOpenChange(false);
    },
  });

  const { form, formRef, submit, hasChanges, formError } = useAppForm<UserFormValues>({
    open,
    resetKey: user?.id ?? "new",
    defaultValues,
    schema,
    serverFieldNames: {
      username: "username",
      email: "email",
      nickname: "nickname",
      password: "password",
      department_id: "departmentId",
      role_ids: "roleIds",
    },
    fallbackErrorMessage: editing ? "更新用户失败" : "创建用户失败",
    onSubmit: async (values) => {
      setConflictDismissed(false);
      await mutation.mutateAsync(values);
    },
    onError: (error) => {
      if (editing && user && getErrorStatus(error) === 409) {
        void usersService
          .get(user.id)
          .then((res) => setConflictUser(res.data))
          .catch(() => setConflictUser(null));
      }
    },
  });

  const draftEmail = useStore(form.store, (state) => state.values.email);
  const draftNickname = useStore(form.store, (state) => state.values.nickname);
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
  const busy = mutation.isPending || isSubmitting;

  const visibleFormError = conflictDismissed ? undefined : formError;

  useEffect(() => {
    if (visibleFormError) formErrorRef.current?.focus();
  }, [visibleFormError]);

  const conflictDifferences = conflictUser
    ? [
        {
          label: "昵称",
          draft: draftNickname.trim(),
          current: conflictUser.nickname ?? "",
        },
        {
          label: "邮箱",
          draft: draftEmail.trim(),
          current: conflictUser.email,
        },
      ].filter((item) => item.draft !== item.current)
    : [];

  useUnsavedChanges(
    open && hasChanges,
    "用户资料尚未保存。离开后这些更改将丢失。",
  );

  const directoryManaged = editing && user?.auth_type !== "local";
  const canSubmit = editing ? editRevision > 0 && hasChanges && !busy : !busy;

  const requestClose = async () => {
    if (busy) return;
    if (hasChanges) {
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
          ref={formRef}
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!editing || canSubmit) {
              void submit();
            }
          }}
        >
          {visibleFormError && (
            <Alert
              ref={formErrorRef}
              tabIndex={-1}
              role="alert"
              aria-live="assertive"
              variant="destructive"
            >
              <Info />
              <AlertDescription>{visibleFormError}</AlertDescription>
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
                    setConflictDismissed(true);
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
              <form.Field name="username">
                {(field) => (
                  <FormField field={field} label="用户名" idPrefix="user" required={!editing}>
                    {(inputProps) => (
                      <Input
                        {...inputProps}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        placeholder="如 zhangsan"
                        disabled={editing || busy}
                        autoComplete="off"
                      />
                    )}
                  </FormField>
                )}
              </form.Field>
              <form.Field name="nickname">
                {(field) => (
                  <FormField field={field} label="姓名 / 昵称" idPrefix="user">
                    {(inputProps) => (
                      <Input
                        {...inputProps}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        placeholder="如 张三"
                        disabled={busy}
                      />
                    )}
                  </FormField>
                )}
              </form.Field>
            </div>
            <form.Field name="email">
              {(field) => (
                <FormField field={field} label="电子邮箱" idPrefix="user" required>
                  {(inputProps) => (
                    <Input
                      {...inputProps}
                      type="email"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="name@company.com"
                      disabled={busy}
                    />
                  )}
                </FormField>
              )}
            </form.Field>
            {!editing && can("users:move") && (
              <form.Field name="departmentId">
                {(field) => (
                  <FormField field={field} label="所属部门" id="user-department" idPrefix="user">
                    {(inputProps) => (
                      <DepartmentSelect
                        id={inputProps.id}
                        nodes={departments}
                        value={field.state.value}
                        onChange={(val) => field.handleChange(val)}
                        placeholder="暂不分配部门"
                        allowClear
                      />
                    )}
                  </FormField>
                )}
              </form.Field>
            )}

            {!editing && (
              <>
                <form.Field name="password">
                  {(field) => (
                    <FormField
                      field={field}
                      label="初始密码"
                      idPrefix="user"
                      required
                    >
                      {(inputProps) => (
                        <>
                          <InputGroup>
                            <InputGroupInput
                              {...inputProps}
                              type="text"
                              value={field.state.value}
                              onChange={(e) => field.handleChange(e.target.value)}
                              onBlur={field.handleBlur}
                              placeholder="至少 8 位，含 3 类字符"
                              autoComplete="new-password"
                              spellCheck={false}
                              disabled={busy}
                              className="font-mono placeholder:font-sans"
                            />
                            <InputGroupAddon align="inline-end">
                              {field.state.value && (
                                <InputGroupButton
                                  size="icon-xs"
                                  aria-label="复制密码"
                                  title="复制密码"
                                  onClick={() => {
                                    void navigator.clipboard
                                      ?.writeText(field.state.value)
                                      .then(() => notify.success("初始密码已复制"))
                                      .catch(() =>
                                        notify.error("复制失败", "请手动选择密码文本复制"),
                                      );
                                  }}
                                >
                                  <Copy />
                                </InputGroupButton>
                              )}
                              <InputGroupButton
                                size="xs"
                                disabled={busy}
                                onClick={() => {
                                  field.handleChange(generatePassword());
                                }}
                              >
                                <RefreshCw />
                                随机生成
                              </InputGroupButton>
                            </InputGroupAddon>
                          </InputGroup>
                          <PasswordStrength password={field.state.value} />
                        </>
                      )}
                    </FormField>
                  )}
                </form.Field>
                {can("users:assign-roles") && (
                  <form.Field name="roleIds">
                    {(field) => (
                      <FormField field={field} label="初始角色" idPrefix="user">
                        {() => (
                          <>
                            <FieldDescription>可多选，角色的权限取并集</FieldDescription>
                            <div className="grid max-h-40 gap-1.5 overflow-y-auto sm:grid-cols-2">
                              {roles.map((role) => {
                                const checked = field.state.value.includes(role.id);
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
                                      disabled={busy}
                                      onCheckedChange={(v) => {
                                        const next = v
                                          ? [...field.state.value, role.id]
                                          : field.state.value.filter((id) => id !== role.id);
                                        field.handleChange(next);
                                      }}
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
                          </>
                        )}
                      </FormField>
                    )}
                  </form.Field>
                )}
              </>
            )}
          </FieldGroup>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => void requestClose()}
              disabled={busy}
            >
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit || busy}>
              {busy && <Spinner />}
              {editing ? "保存修改" : "创建用户"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
