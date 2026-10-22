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
import { filterTree, flattenTree } from "@/lib/tree";
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

interface FlatDepartmentNode {
  node: DepartmentNode;
  depth: number;
  position: number;
  siblingCount: number;
}

const TREE_ROW_HEIGHT = 34;
const TREE_OVERSCAN = 8;
const TREE_VIRTUALIZE_THRESHOLD = 200;

function flattenVisibleNodes(
  nodes: DepartmentNode[],
  expanded: Set<string>,
  forceOpen: boolean,
): FlatDepartmentNode[] {
  const rows: FlatDepartmentNode[] = [];
  const visit = (list: DepartmentNode[], depth: number) => {
    list.forEach((node, index) => {
      rows.push({
        node,
        depth,
        position: index + 1,
        siblingCount: list.length,
      });
      if (node.children.length && (forceOpen || expanded.has(node.id)))
        visit(node.children, depth + 1);
    });
  };
  visit(nodes, 0);
  return rows;
}

function buildDepartmentIndex(nodes: DepartmentNode[]) {
  const byId = new Map<string, DepartmentNode>();
  const pathById = new Map<string, DepartmentNode[]>();
  const subtreeCountById = new Map<string, number>();
  const visit = (list: DepartmentNode[], parents: DepartmentNode[]) => {
    for (const node of list) {
      const path = [...parents, node];
      byId.set(node.id, node);
      pathById.set(node.id, path);
      let count = 1;
      for (const child of node.children) count += visit([child], path);
      subtreeCountById.set(node.id, count);
    }
    return list.reduce(
      (count, node) => count + (subtreeCountById.get(node.id) ?? 0),
      0,
    );
  };
  visit(nodes, []);
  return { byId, pathById, subtreeCountById };
}

function findTreeScrollElement(element: HTMLElement | null) {
  let parent = element?.parentElement ?? null;
  while (parent) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return parent;
    parent = parent.parentElement;
  }
  return null;
}

type TreeRowHandlers = {
  dragStart: (
    event: React.DragEvent<HTMLDivElement>,
    node: DepartmentNode,
  ) => void;
  dragOver: (
    event: React.DragEvent<HTMLDivElement>,
    node: DepartmentNode,
  ) => void;
  drop: (event: React.DragEvent<HTMLDivElement>, node: DepartmentNode) => void;
  leave: (event: React.DragEvent<HTMLDivElement>, node: DepartmentNode) => void;
  end: () => void;
  toggle: (id: string) => void;
  select: (node: DepartmentNode) => void;
  focus: (id: string) => void;
  keyDown: (
    event: React.KeyboardEvent<HTMLButtonElement>,
    node: DepartmentNode,
  ) => void;
};
interface DepartmentTreeRowProps {
  row: FlatDepartmentNode;
  isOpen: boolean;
  selected: boolean;
  disabled: boolean;
  currentDrop: DropPosition | null;
  selectedMatch: boolean;
  active: boolean;
  dragging: boolean;
  keyword: string;
  canMove: boolean;
  showCounts: boolean;
  hasAllItem: boolean;
  hasUnassignedItem: boolean;
  renderActions?: DepartmentTreeProps["renderActions"];
  handlers: React.RefObject<TreeRowHandlers | null>;
}
const DepartmentTreeRow = React.memo(function DepartmentTreeRow({
  row,
  isOpen,
  selected,
  disabled,
  currentDrop,
  selectedMatch,
  active,
  dragging,
  keyword,
  canMove,
  showCounts,
  hasAllItem,
  hasUnassignedItem,
  renderActions,
  handlers,
}: DepartmentTreeRowProps) {
  const { node, depth, position, siblingCount } = row;
  const hasChildren = node.children.length > 0;
  const Icon =
    node.source === "ldap" ? Network : depth === 0 ? Building2 : FolderTree;
  return (
    <li
      key={node.id}
      role="treeitem"
      aria-level={depth + 1}
      aria-posinset={position + (depth === 0 && hasAllItem ? 1 : 0)}
      aria-setsize={
        siblingCount +
        (depth === 0 ? Number(!!hasAllItem) + Number(!!hasUnassignedItem) : 0)
      }
      aria-expanded={hasChildren ? isOpen : undefined}
      aria-selected={selected}
      style={{ height: TREE_ROW_HEIGHT }}
    >
      <div
        className={cn(
          "group/tree-row relative flex h-8 items-center gap-0.5 rounded-lg pr-1 transition-colors motion-reduce:transition-none",
          selected ? "bg-primary/10 text-primary" : "hover:bg-muted/70",
          currentDrop === "before" && "border-t-2 border-primary",
          currentDrop === "after" && "border-b-2 border-primary",
          currentDrop === "inside" && "bg-primary/15 ring-1 ring-primary/50",
        )}
        style={{ paddingLeft: depth * 14 }}
        data-department-tree-row={node.id}
        draggable={canMove && !disabled}
        onDragStart={(event) => handlers.current?.dragStart(event, node)}
        onDragEnd={() => handlers.current?.end()}
        onDragOver={(event) => handlers.current?.dragOver(event, node)}
        onDragLeave={(event) => handlers.current?.leave(event, node)}
        onDrop={(event) => handlers.current?.drop(event, node)}
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
            handlers.current?.toggle(node.id);
          }}
          aria-label={isOpen ? `收起 ${node.name}` : `展开 ${node.name}`}
          tabIndex={-1}
          disabled={!hasChildren}
        >
          <ChevronRight
            className={cn(
              "transition-transform duration-200 motion-reduce:transition-none",
              isOpen && "rotate-90",
            )}
          />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => {
            handlers.current?.select(node);
          }}
          onFocus={() => handlers.current?.focus(node.id)}
          onKeyDown={(event) => handlers.current?.keyDown(event, node)}
          data-tree-focus={node.id}
          data-department-tree-node
          data-current-match={selectedMatch || undefined}
          tabIndex={active ? 0 : -1}
          className={cn(
            "h-8 min-w-0 flex-1 justify-start gap-2 px-1.5 font-normal hover:bg-transparent",
            selected && "font-medium text-primary hover:text-primary",
            node.status !== 1 && "text-muted-foreground",
            dragging && "opacity-50",
            selectedMatch && "ring-1 ring-primary/60",
          )}
        >
          <Icon
            className={cn(
              "size-4 shrink-0",
              selected ? "text-primary" : "text-muted-foreground",
            )}
          />
          <span className="truncate">{highlightMatch(node.name, keyword)}</span>
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
          <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/tree-row:opacity-100 group-focus-within/tree-row:opacity-100 [@media(hover:none)]:opacity-100 [@media(hover:none)]:[&_button]:min-h-10 [@media(hover:none)]:[&_button]:min-w-10">
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
    </li>
  );
});

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
  const scrollElementRef = React.useRef<HTMLElement | null>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(0);
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
  const flatNodes = React.useMemo(
    () => flattenVisibleNodes(visible, expanded, !!keyword),
    [visible, expanded, keyword],
  );
  const treeIndex = React.useMemo(() => buildDepartmentIndex(nodes), [nodes]);
  const visibleIds = React.useMemo(
    () => flatNodes.map(({ node }) => node.id),
    [flatNodes],
  );
  const rootNodeCount = React.useMemo(
    () => flatNodes.reduce((count, row) => count + Number(row.depth === 0), 0),
    [flatNodes],
  );
  const specialKeys = [
    allItem ? ALL_KEY : null,
    ...visibleIds,
    unassignedItem ? UNASSIGNED_KEY : null,
  ].filter((key): key is string => !!key);
  const shouldVirtualize = flatNodes.length > TREE_VIRTUALIZE_THRESHOLD;
  const treeItemCount = specialKeys.length;

  React.useLayoutEffect(() => {
    const tree = treeRef.current;
    const scrollElement = findTreeScrollElement(tree);
    scrollElementRef.current = scrollElement;
    if (!scrollElement) return;
    const updateScroll = () => {
      setScrollTop(scrollElement.scrollTop);
      setViewportHeight(scrollElement.clientHeight);
    };
    const observer = new ResizeObserver(updateScroll);
    observer.observe(scrollElement);
    scrollElement.addEventListener("scroll", updateScroll, { passive: true });
    updateScroll();
    return () => {
      observer.disconnect();
      scrollElement.removeEventListener("scroll", updateScroll);
    };
  }, []);

  const virtualRange = React.useMemo(() => {
    if (!shouldVirtualize) return { start: 0, end: treeItemCount };
    const scrollElement = scrollElementRef.current;
    const tree = treeRef.current;
    if (!scrollElement || !tree)
      return { start: 0, end: Math.min(treeItemCount, 40) };
    const treeTop =
      tree.getBoundingClientRect().top -
      scrollElement.getBoundingClientRect().top +
      scrollElement.scrollTop;
    const firstVisible = Math.floor((scrollTop - treeTop) / TREE_ROW_HEIGHT);
    const start = Math.max(0, firstVisible - TREE_OVERSCAN);
    const rowsInViewport = Math.ceil(viewportHeight / TREE_ROW_HEIGHT);
    return {
      start,
      end: Math.min(treeItemCount, start + rowsInViewport + TREE_OVERSCAN * 2),
    };
  }, [scrollTop, shouldVirtualize, treeItemCount, viewportHeight]);

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
    const index = specialKeys.indexOf(key);
    if (index < 0) return;
    const scrollElement = scrollElementRef.current;
    if (
      shouldVirtualize &&
      scrollElement &&
      (index < virtualRange.start || index >= virtualRange.end)
    ) {
      const tree = treeRef.current;
      const treeTop =
        tree.getBoundingClientRect().top -
        scrollElement.getBoundingClientRect().top +
        scrollElement.scrollTop;
      scrollElement.scrollTop = Math.max(
        0,
        treeTop + index * TREE_ROW_HEIGHT - scrollElement.clientHeight / 2,
      );
      setScrollTop(scrollElement.scrollTop);
      setActiveKey(key);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => focusMountedItem(key)),
      );
      return;
    }
    focusMountedItem(key);
  };

  const focusMountedItem = (key: string) => {
    const button = treeRef.current?.querySelector<HTMLButtonElement>(
      `[data-tree-focus="${CSS.escape(key)}"]:not(:disabled)`,
    );
    button?.focus();
  };

  const handleTreeKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    node?: DepartmentNode,
  ) => {
    const keys = specialKeys.filter(
      (key) =>
        key === ALL_KEY || key === UNASSIGNED_KEY || !disabledKeys?.has(key),
    );
    const currentIndex = keys.indexOf(
      event.currentTarget.dataset.treeFocus ?? "",
    );
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
            ? keys.length - 1
            : currentIndex + (event.key === "ArrowDown" ? 1 : -1);
      const targetKey = keys[Math.max(0, Math.min(nextIndex, keys.length - 1))];
      if (targetKey) {
        setActiveKey(targetKey);
        focusItem(targetKey);
      }
    } else if (event.key === "ArrowRight" && node?.children.length) {
      event.preventDefault();
      const isOpen = keyword || expanded.has(node.id);
      if (!isOpen) {
        toggle(node.id);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => focusItem(node.children[0]?.id)),
        );
      } else focusItem(node.children[0]?.id);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (node?.children.length && (keyword || expanded.has(node.id)))
        toggle(node.id);
      else if (node) {
        const path = treeIndex.pathById.get(node.id) ?? [];
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
    const path = treeIndex.pathById.get(nextMatch.id) ?? [];
    setExpanded(
      (previous) =>
        new Set([...previous, ...path.slice(0, -1).map((node) => node.id)]),
    );
    setMatchIndex(nextIndex);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => focusItem(nextMatch.id)),
    );
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
    const moving = treeIndex.byId.get(sourceId);
    if (
      !moving ||
      (treeIndex.pathById.get(node.id) ?? []).some(
        (item) => item.id === sourceId,
      ) ||
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
    const moving = treeIndex.byId.get(sourceId);
    if (
      !moving ||
      (treeIndex.pathById.get(node.id) ?? []).some(
        (item) => item.id === sourceId,
      ) ||
      disabledKeys?.has(node.id)
    )
      return;
    onMoveDrop(sourceId, node.id, position);
  };

  const dragSource = draggedId ? treeIndex.byId.get(draggedId) : undefined;
  const dragTargetNode = dropTarget
    ? treeIndex.byId.get(dropTarget.id)
    : undefined;
  const targetPath = dragTargetNode
    ? (treeIndex.pathById.get(dragTargetNode.id) ?? [])
        .map((node) => node.name)
        .join(" / ")
    : "";

  const rowHandlers = React.useRef<TreeRowHandlers | null>(null);
  React.useLayoutEffect(() => {
    rowHandlers.current = {
      dragStart: onNodeDragStart,
      dragOver: onNodeDragOver,
      drop: onNodeDrop,
      end: () => {
        draggedIdRef.current = null;
        setDraggedId(null);
        setDropTarget(null);
      },
      leave: (event, node) => {
        if (
          !event.currentTarget.contains(event.relatedTarget as Node | null) &&
          dropTarget?.id === node.id
        )
          setDropTarget(null);
      },
      toggle: (id) => {
        setActiveKey(id);
        toggle(id);
      },
      select: (node) => {
        setActiveKey(node.id);
        onSelect(node.id, node);
      },
      focus: setActiveKey,
      keyDown: handleTreeKeyDown,
    };
  });
  const renderNode = (row: FlatDepartmentNode) => (
    <DepartmentTreeRow
      key={row.node.id}
      row={row}
      isOpen={!!keyword || expanded.has(row.node.id)}
      selected={selectedKey === row.node.id}
      disabled={disabledKeys?.has(row.node.id) ?? false}
      currentDrop={dropTarget?.id === row.node.id ? dropTarget.position : null}
      selectedMatch={match?.id === row.node.id}
      active={activeKey === row.node.id}
      dragging={draggedId === row.node.id}
      keyword={keyword}
      canMove={canMove}
      showCounts={showCounts}
      hasAllItem={!!allItem}
      hasUnassignedItem={!!unassignedItem}
      renderActions={renderActions}
      handlers={rowHandlers}
    />
  );

  const renderedIndexes = Array.from(
    { length: Math.max(0, virtualRange.end - virtualRange.start) },
    (_, offset) => virtualRange.start + offset,
  );
  const draggedIndex = draggedId ? specialKeys.indexOf(draggedId) : -1;
  if (draggedIndex >= 0 && !renderedIndexes.includes(draggedIndex)) {
    renderedIndexes.push(draggedIndex);
    renderedIndexes.sort((a, b) => a - b);
  }
  React.useEffect(() => {
    const element = scrollElementRef.current;
    if (!draggedId || !element) return;
    let speed = 0;
    let frame = 0;
    const track = (event: DragEvent) => {
      const bounds = element.getBoundingClientRect();
      speed =
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
          ? 0
          : event.clientY < bounds.top + 40
            ? -10
            : event.clientY > bounds.bottom - 40
              ? 10
              : 0;
      if (speed) event.preventDefault();
    };
    const scroll = () => {
      if (speed) element.scrollTop += speed;
      frame = requestAnimationFrame(scroll);
    };
    document.addEventListener("dragover", track);
    frame = requestAnimationFrame(scroll);
    return () => {
      document.removeEventListener("dragover", track);
      cancelAnimationFrame(frame);
    };
  }, [draggedId]);

  const virtualItem = (
    key: string,
    label: string,
    count: number | undefined,
    Icon: typeof UsersRound,
  ) => (
    <li
      role="treeitem"
      aria-level={1}
      aria-posinset={
        key === ALL_KEY ? 1 : rootNodeCount + Number(!!allItem) + 1
      }
      aria-setsize={
        rootNodeCount + Number(!!allItem) + Number(!!unassignedItem)
      }
      aria-selected={selectedKey === key}
      style={{ height: TREE_ROW_HEIGHT }}
    >
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
            ? `放到 ${targetPath} ${dropTarget.position === "inside" ? "下级" : dropTarget.position === "before" ? "之前" : "之后"} · 将移动 ${treeIndex.subtreeCountById.get(dragSource.id) ?? 1} 个部门、${dragSource.total_member_count} 位成员`
            : `正在拖动「${dragSource.name}」。拖到节点上方/下方排序，中间区域移入；键盘或触屏可用节点菜单的“移动到…”和上下排序。`}
        </p>
      )}
      <ul
        ref={treeRef}
        id={treeId}
        role="tree"
        aria-label="组织架构"
        data-tree-total={flatNodes.length}
        data-tree-rendered={renderedIndexes.length}
        className="min-h-0 text-sm"
      >
        {renderedIndexes.map((index, offset) => (
          <React.Fragment key={specialKeys[index]}>
            {index > (renderedIndexes[offset - 1] ?? -1) + 1 && (
              <li
                role="none"
                aria-hidden="true"
                style={{
                  height:
                    (index - (renderedIndexes[offset - 1] ?? -1) - 1) *
                    TREE_ROW_HEIGHT,
                }}
              />
            )}
            {(() => {
              if (allItem && index === 0)
                return (
                  <React.Fragment key={ALL_KEY}>
                    {virtualItem(
                      ALL_KEY,
                      allItem.label,
                      allItem.count,
                      UsersRound,
                    )}
                  </React.Fragment>
                );
              const nodeIndex = index - Number(!!allItem);
              if (nodeIndex >= 0 && nodeIndex < flatNodes.length)
                return renderNode(flatNodes[nodeIndex]);
              if (unassignedItem && index === treeItemCount - 1)
                return (
                  <React.Fragment key={UNASSIGNED_KEY}>
                    {virtualItem(
                      UNASSIGNED_KEY,
                      unassignedItem.label,
                      unassignedItem.count,
                      UserX,
                    )}
                  </React.Fragment>
                );
              return null;
            })()}
          </React.Fragment>
        ))}
        {keyword && matchNodes.length === 0 && (
          <li
            role="none"
            className="px-2 py-4 text-center text-xs text-muted-foreground"
          >
            没有匹配「{query}」的部门
          </li>
        )}
        {(renderedIndexes.at(-1) ?? -1) + 1 < treeItemCount && (
          <li
            role="none"
            aria-hidden="true"
            style={{
              height:
                (treeItemCount - (renderedIndexes.at(-1) ?? -1) - 1) *
                TREE_ROW_HEIGHT,
            }}
          />
        )}
      </ul>
    </div>
  );
}
