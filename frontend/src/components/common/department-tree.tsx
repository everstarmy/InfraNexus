import * as React from "react";
import {
  Building2,
  ChevronRight,
  FolderTree,
  Network,
  Search,
  UsersRound,
  UserX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import {
  collectIds,
  filterTree,
  findNode,
  findPath,
  flattenTree,
} from "@/lib/tree";
import type { DepartmentNode } from "@/services/departments";

export const ALL_KEY = "all";
export const UNASSIGNED_KEY = "none";

type DropPosition = "before" | "inside" | "after";

export interface DepartmentTreeProps {
  nodes: DepartmentNode[];
  selectedKey?: string | null;
  onSelect: (key: string, node?: DepartmentNode) => void;
  allItem?: { label: string; count?: number };
  unassignedItem?: { label: string; count?: number };
  showCounts?: boolean;
  searchable?: boolean;
  disabledKeys?: ReadonlySet<string>;
  defaultExpandDepth?: number;
  renderActions?: (node: DepartmentNode) => React.ReactNode;
  canMove?: boolean;
  onMoveDrop?: (
    sourceId: string,
    targetId: string,
    position: DropPosition,
  ) => void;
  className?: string;
}

function collectExpandable(
  nodes: DepartmentNode[],
  depth: number,
  maxDepth: number,
  out: Set<string>,
) {
  for (const node of nodes) {
    if (node.children?.length && depth < maxDepth) {
      out.add(node.id);
      collectExpandable(node.children, depth + 1, maxDepth, out);
    }
  }
  return out;
}

function highlightMatch(value: string, keyword: string) {
  const start = value.toLocaleLowerCase().indexOf(keyword);
  if (start < 0 || !keyword) return value;
  const end = start + keyword.length;
  return (
    <>
      {value.slice(0, start)}
      <mark className="rounded-sm bg-primary/15 px-0.5 text-inherit">
        {value.slice(start, end)}
      </mark>
      {value.slice(end)}
    </>
  );
}

function visibleNodeIds(
  nodes: DepartmentNode[],
  expanded: Set<string>,
  forceOpen: boolean,
) {
  const ids: string[] = [];
  const visit = (list: DepartmentNode[]) => {
    for (const node of list) {
      ids.push(node.id);
      if (node.children.length && (forceOpen || expanded.has(node.id)))
        visit(node.children);
    }
  };
  visit(nodes);
  return ids;
}

export function DepartmentTree({
  nodes,
  selectedKey,
  onSelect,
  allItem,
  unassignedItem,
  showCounts = true,
  searchable = true,
  disabledKeys,
  defaultExpandDepth = 2,
  renderActions,
  canMove = false,
  onMoveDrop,
  className,
}: DepartmentTreeProps) {
  const treeId = React.useId();
  const treeRef = React.useRef<HTMLUListElement>(null);
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState<Set<string>>(() =>
    collectExpandable(nodes, 0, defaultExpandDepth - 1, new Set()),
  );
  const [activeKey, setActiveKey] = React.useState<string | null>(
    selectedKey ?? (allItem ? ALL_KEY : (nodes[0]?.id ?? null)),
  );
  const [matchIndex, setMatchIndex] = React.useState(0);
  const [draggedId, setDraggedId] = React.useState<string | null>(null);
  const draggedIdRef = React.useRef<string | null>(null);
  const [dropTarget, setDropTarget] = React.useState<{
    id: string;
    position: DropPosition;
  } | null>(null);
  const seeded = React.useRef(nodes.length > 0);

  React.useEffect(() => {
    if (!seeded.current && nodes.length > 0) {
      seeded.current = true;
      setExpanded(
        collectExpandable(nodes, 0, defaultExpandDepth - 1, new Set()),
      );
    }
  }, [nodes, defaultExpandDepth]);

  const keyword = query.trim().toLocaleLowerCase();
  const visible = React.useMemo(
    () =>
      keyword
        ? filterTree(
            nodes,
            (node) =>
              node.name.toLocaleLowerCase().includes(keyword) ||
              node.code.toLocaleLowerCase().includes(keyword),
          )
        : nodes,
    [nodes, keyword],
  );
  const matchNodes = React.useMemo(
    () =>
      keyword
        ? flattenTree(visible).filter(
            (node) =>
              node.name.toLocaleLowerCase().includes(keyword) ||
              node.code.toLocaleLowerCase().includes(keyword),
          )
        : [],
    [visible, keyword],
  );
  const visibleIds = React.useMemo(
    () => visibleNodeIds(visible, expanded, !!keyword),
    [visible, expanded, keyword],
  );
  const specialKeys = [
    allItem ? ALL_KEY : null,
    ...visibleIds,
    unassignedItem ? UNASSIGNED_KEY : null,
  ].filter((key): key is string => !!key);

  React.useEffect(() => {
    setMatchIndex(0);
  }, [keyword]);

  React.useEffect(() => {
    if (selectedKey) setActiveKey(selectedKey);
  }, [selectedKey]);

  React.useEffect(() => {
    if (activeKey && specialKeys.includes(activeKey)) return;
    setActiveKey(specialKeys[0] ?? null);
  }, [activeKey, specialKeys]);

  const toggle = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const focusItem = (key: string | undefined) => {
    if (!key || !treeRef.current) return;
    const button = Array.from(
      treeRef.current.querySelectorAll<HTMLButtonElement>(
        "[data-tree-focus]:not(:disabled)",
      ),
    ).find((item) => item.dataset.treeFocus === key);
    button?.focus();
  };

  const handleTreeKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    node?: DepartmentNode,
  ) => {
    const tree = event.currentTarget.closest('[role="tree"]');
    const buttons = Array.from(
      tree?.querySelectorAll<HTMLButtonElement>(
        "[data-tree-focus]:not(:disabled)",
      ) ?? [],
    );
    const currentIndex = buttons.indexOf(event.currentTarget);
    const keys = buttons.map((button) => button.dataset.treeFocus ?? "");
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      event.preventDefault();
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : currentIndex + (event.key === "ArrowDown" ? 1 : -1);
      const target =
        buttons[Math.max(0, Math.min(nextIndex, buttons.length - 1))];
      target?.focus();
      if (target?.dataset.treeFocus) setActiveKey(target.dataset.treeFocus);
    } else if (event.key === "ArrowRight" && node?.children.length) {
      event.preventDefault();
      const isOpen = keyword || expanded.has(node.id);
      if (!isOpen) toggle(node.id);
      else focusItem(node.children[0]?.id);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (node?.children.length && (keyword || expanded.has(node.id)))
        toggle(node.id);
      else if (node) {
        const path = findPath(nodes, node.id);
        const parent = path.at(-2);
        if (parent) focusItem(parent.id);
      }
    }
  };

  const match = matchNodes[matchIndex];
  const goToNextMatch = () => {
    if (!matchNodes.length) return;
    const nextIndex = (matchIndex + 1) % matchNodes.length;
    const nextMatch = matchNodes[nextIndex];
    const path = findPath(nodes, nextMatch.id);
    setExpanded(
      (previous) =>
        new Set([...previous, ...path.slice(0, -1).map((node) => node.id)]),
    );
    setMatchIndex(nextIndex);
    requestAnimationFrame(() => focusItem(nextMatch.id));
  };

  const onNodeDragStart = (
    event: React.DragEvent<HTMLDivElement>,
    node: DepartmentNode,
  ) => {
    if (!canMove || !onMoveDrop) {
      event.preventDefault();
      return;
    }
    draggedIdRef.current = node.id;
    setDraggedId(node.id);
    setDropTarget(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", node.id);
  };

  const onNodeDragOver = (
    event: React.DragEvent<HTMLDivElement>,
    node: DepartmentNode,
  ) => {
    if (!onMoveDrop) return;
    // Accept the drag at the browser level first; validation below still prevents
    // self/descendant drops while avoiding a missing native `drop` event.
    event.preventDefault();
    const sourceId =
      draggedIdRef.current ?? event.dataTransfer.getData("text/plain");
    if (!sourceId || sourceId === node.id) {
      setDropTarget(null);
      return;
    }
    const moving = findNode(nodes, sourceId);
    if (
      !moving ||
      collectIds(moving).includes(node.id) ||
      disabledKeys?.has(node.id)
    ) {
      event.dataTransfer.dropEffect = "none";
      setDropTarget(null);
      return;
    }
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - bounds.top) / Math.max(1, bounds.height);
    const position: DropPosition =
      ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
    setDropTarget({ id: node.id, position });
  };

  const onNodeDrop = (
    event: React.DragEvent<HTMLDivElement>,
    node: DepartmentNode,
  ) => {
    event.preventDefault();
    const sourceId =
      draggedIdRef.current ?? event.dataTransfer.getData("text/plain");
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - bounds.top) / Math.max(1, bounds.height);
    const position: DropPosition =
      ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
    draggedIdRef.current = null;
    setDraggedId(null);
    setDropTarget(null);
    if (!sourceId || !onMoveDrop) return;
    const moving = findNode(nodes, sourceId);
    if (
      !moving ||
      collectIds(moving).includes(node.id) ||
      disabledKeys?.has(node.id)
    )
      return;
    onMoveDrop(sourceId, node.id, position);
  };

  const dragSource = draggedId ? findNode(nodes, draggedId) : undefined;
  const dragTargetNode = dropTarget
    ? findNode(nodes, dropTarget.id)
    : undefined;
  const targetPath = dragTargetNode
    ? findPath(nodes, dragTargetNode.id)
        .map((node) => node.name)
        .join(" / ")
    : "";

  const renderNode = (node: DepartmentNode, depth: number): React.ReactNode => {
    const hasChildren = node.children.length > 0;
    const isOpen = keyword ? true : expanded.has(node.id);
    const selected = selectedKey === node.id;
    const disabled = disabledKeys?.has(node.id) ?? false;
    const Icon =
      node.source === "ldap" ? Network : depth === 0 ? Building2 : FolderTree;
    const currentDrop = dropTarget?.id === node.id ? dropTarget.position : null;
    const selectedMatch = match?.id === node.id;
    return (
      <li
        key={node.id}
        role="treeitem"
        aria-expanded={hasChildren ? isOpen : undefined}
        aria-selected={selected}
      >
        <div
          className={cn(
            "group/tree-row relative flex items-center gap-0.5 rounded-lg pr-1 transition-colors",
            selected ? "bg-primary/10 text-primary" : "hover:bg-muted/70",
            currentDrop === "before" && "border-t-2 border-primary",
            currentDrop === "after" && "border-b-2 border-primary",
            currentDrop === "inside" && "bg-primary/15 ring-1 ring-primary/50",
          )}
          style={{ paddingLeft: depth * 14 }}
          data-department-tree-row={node.id}
          draggable={canMove && !disabled}
          onDragStart={(event) => onNodeDragStart(event, node)}
          onDragEnd={() => {
            draggedIdRef.current = null;
            setDraggedId(null);
            setDropTarget(null);
          }}
          onDragOver={(event) => onNodeDragOver(event, node)}
          onDragLeave={(event) => {
            if (
              !event.currentTarget.contains(
                event.relatedTarget as Node | null,
              ) &&
              dropTarget?.id === node.id
            )
              setDropTarget(null);
          }}
          onDrop={(event) => onNodeDrop(event, node)}
        >
          {selected && (
            <span
              aria-hidden
              className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-primary"
            />
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn(
              "text-muted-foreground hover:bg-transparent",
              !hasChildren && "invisible",
            )}
            onClick={() => {
              setActiveKey(node.id);
              toggle(node.id);
            }}
            aria-label={isOpen ? `收起 ${node.name}` : `展开 ${node.name}`}
            tabIndex={-1}
            disabled={!hasChildren}
          >
            <ChevronRight
              className={cn(
                "transition-transform duration-200",
                isOpen && "rotate-90",
              )}
            />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              setActiveKey(node.id);
              onSelect(node.id, node);
            }}
            onFocus={() => setActiveKey(node.id)}
            onKeyDown={(event) => handleTreeKeyDown(event, node)}
            data-tree-focus={node.id}
            data-department-tree-node
            data-current-match={selectedMatch || undefined}
            tabIndex={activeKey === node.id ? 0 : -1}
            className={cn(
              "h-8 min-w-0 flex-1 justify-start gap-2 px-1.5 font-normal hover:bg-transparent",
              selected && "font-medium text-primary hover:text-primary",
              node.status !== 1 && "text-muted-foreground",
              draggedId === node.id && "opacity-50",
              selectedMatch && "ring-1 ring-primary/60",
            )}
          >
            <Icon
              className={cn(
                "size-4 shrink-0",
                selected ? "text-primary" : "text-muted-foreground",
              )}
            />
            <span className="truncate">
              {highlightMatch(node.name, keyword)}
            </span>
            {keyword && !node.name.toLocaleLowerCase().includes(keyword) && (
              <span className="truncate font-mono text-[10px] text-muted-foreground">
                {highlightMatch(node.code, keyword)}
              </span>
            )}
            {node.status !== 1 && (
              <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                停用
              </span>
            )}
          </Button>
          {renderActions && (
            <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/tree-row:opacity-100 group-focus-within/tree-row:opacity-100">
              {renderActions(node)}
            </div>
          )}
          {showCounts && (
            <span
              className={cn(
                "shrink-0 px-1 font-mono text-[11px] tabular-nums",
                selected ? "text-primary" : "text-muted-foreground",
              )}
            >
              {node.total_member_count}
            </span>
          )}
        </div>
        {hasChildren && isOpen && (
          <ul
            role="group"
            className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1"
          >
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  const virtualItem = (
    key: string,
    label: string,
    count: number | undefined,
    Icon: typeof UsersRound,
  ) => (
    <li role="treeitem" aria-selected={selectedKey === key}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setActiveKey(key);
          onSelect(key);
        }}
        onFocus={() => setActiveKey(key)}
        onKeyDown={(event) => handleTreeKeyDown(event)}
        data-tree-focus={key}
        tabIndex={activeKey === key ? 0 : -1}
        className={cn(
          "relative h-8 w-full justify-start gap-2 pr-2 pl-2 font-normal",
          selectedKey === key
            ? "bg-primary/10 font-medium text-primary hover:bg-primary/10 hover:text-primary dark:text-violet-300 dark:hover:text-violet-300"
            : "hover:bg-muted/70",
        )}
      >
        {selectedKey === key && (
          <span
            aria-hidden
            className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-primary"
          />
        )}
        <Icon className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">{label}</span>
        {count !== undefined && (
          <span className="font-mono text-[11px] tabular-nums opacity-80">
            {count}
          </span>
        )}
      </Button>
    </li>
  );

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      {searchable && (
        <div className="space-y-1.5">
          <InputGroup className="h-8 border-input/50 bg-muted/30 shadow-none focus-within:ring-0 has-[[data-slot=input-group-control]:focus-visible]:ring-0">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索部门名称或编码"
              aria-label="搜索部门名称或编码"
              aria-controls={treeId}
              className="text-xs"
            />
          </InputGroup>
          {keyword && (
            <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
              <span role="status" aria-live="polite">
                {matchNodes.length
                  ? `找到 ${matchNodes.length} 个部门 · ${matchIndex + 1}/${matchNodes.length}`
                  : `没有匹配「${query}」的部门`}
              </span>
              {matchNodes.length > 1 && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={goToNextMatch}
                  className="h-6 px-1.5"
                >
                  下一处
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {dragSource && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5 text-[11px] leading-4 text-muted-foreground"
        >
          {dragTargetNode && dropTarget
            ? `放到 ${targetPath} ${dropTarget.position === "inside" ? "下级" : dropTarget.position === "before" ? "之前" : "之后"} · 将移动 ${collectIds(dragSource).length} 个部门、${dragSource.total_member_count} 位成员`
            : `正在拖动「${dragSource.name}」。拖到节点上方/下方排序，中间区域移入；键盘或触屏可用节点菜单的“移动到…”和上下排序。`}
        </p>
      )}
      <ul
        ref={treeRef}
        id={treeId}
        role="tree"
        aria-label="组织架构"
        className="min-h-0 space-y-0.5 text-sm"
      >
        {allItem &&
          virtualItem(ALL_KEY, allItem.label, allItem.count, UsersRound)}
        {visible.map((node) => renderNode(node, 0))}
        {keyword && matchNodes.length === 0 && (
          <li
            role="none"
            className="px-2 py-4 text-center text-xs text-muted-foreground"
          >
            没有匹配「{query}」的部门
          </li>
        )}
        {unassignedItem &&
          virtualItem(
            UNASSIGNED_KEY,
            unassignedItem.label,
            unassignedItem.count,
            UserX,
          )}
      </ul>
    </div>
  );
}
