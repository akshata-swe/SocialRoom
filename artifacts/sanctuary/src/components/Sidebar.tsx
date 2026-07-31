import { useState, useRef, useEffect, useCallback } from "react";
import {
  useGetSpaces,
  useGetUnreadCounts,
  useGetMe,
  useCreateSpace,
  useUpdateSpace,
  useDeleteSpace,
  useCreateTag,
  useUpdateTag,
  useDeleteTag,
  getGetSpacesQueryKey,
  type Tag,
} from "@workspace/api-client-react";
import { useClerk } from "@clerk/react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import {
  LogOut,
  Loader2,
  Feather,
  Pencil,
  Trash2,
  Plus,
  Check,
  X,
  GripVertical,
  Lock,
  Unlock,
  Shield,
  UserX,
  ChevronDown,
} from "lucide-react";

// ─── Admin user type ──────────────────────────────────────────────────────────

interface AdminUser {
  userId: string;
  displayName: string;
  isProfileComplete: boolean;
  email: string;
}

// ─── Drag / drop types ────────────────────────────────────────────────────────

type DragItem =
  | { kind: "space"; id: number }
  | { kind: "tag"; id: number; spaceId: number };

type DropTarget =
  | { kind: "space"; id: number; position: "above" | "below" }
  | { kind: "tag"; id: number; spaceId: number; position: "above" | "below" }
  | { kind: "space-body"; spaceId: number }; // drag tag onto space header → end of that space

// ─── Helpers ──────────────────────────────────────────────────────────────────

function reorder<T>(list: T[], from: number, to: number): T[] {
  const r = [...list];
  const [item] = r.splice(from, 1);
  r.splice(to, 0, item);
  return r;
}

function cursorPosition(
  e: React.DragEvent,
  el: HTMLElement,
): "above" | "below" {
  const mid =
    el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2;
  return e.clientY < mid ? "above" : "below";
}

// ─── Inline edit ──────────────────────────────────────────────────────────────

function InlineEdit({
  value,
  onCommit,
  onCancel,
  className = "",
}: {
  value: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setDraft(value);
    setTimeout(() => ref.current?.select(), 0);
  }, [value]);
  const commit = () => {
    const t = draft.trim();
    if (t && t !== value) onCommit(t);
    else onCancel();
  };
  return (
    <div className="flex items-center gap-1 flex-1 min-w-0">
      <input
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") onCancel();
        }}
        t
        onBlur={commit}
        className={`flex-1 min-w-0 bg-sidebar-accent/60 border border-primary/40 rounded px-2 py-0.5 outline-none focus:border-primary/80 ${className}`}
      />
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          commit();
        }}
        className="text-primary hover:text-primary/80 shrink-0"
      >
        <Check size={12} />
      </button>
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          onCancel();
        }}
        className="text-muted-foreground/50 hover:text-foreground shrink-0"
      >
        <X size={12} />
      </button>
    </div>
  );
}

// ─── Two-step delete ──────────────────────────────────────────────────────────

function DeleteButton({
  onDelete,
  size = 11,
}: {
  onDelete: () => void;
  size?: number;
}) {
  const [armed, setArmed] = useState(false);
  if (armed)
    return (
      <>
        <button
          onClick={onDelete}
          className="p-0.5 rounded text-destructive hover:bg-destructive/15 transition-colors"
        >
          <Check size={size} />
        </button>
        <button
          onClick={() => setArmed(false)}
          className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-sidebar-accent/60 transition-colors"
        >
          <X size={size} />
        </button>
      </>
    );
  return (
    <button
      onClick={() => setArmed(true)}
      className="p-0.5 rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
    >
      <Trash2 size={size} />
    </button>
  );
}

// ─── Space header ─────────────────────────────────────────────────────────────

function SpaceHeader({
  space,
  isAdmin,
  dragging,
  dropTarget,
  onRename,
  onDelete,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  space: { id: number; name: string };
  isAdmin: boolean;
  dragging: boolean;
  dropTarget: DropTarget | null;
  onRename: (v: string) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const spaceDropPos =
    dropTarget?.kind === "space" && dropTarget.id === space.id
      ? dropTarget.position
      : null;
  const isBodyTarget =
    dropTarget?.kind === "space-body" && dropTarget.spaceId === space.id;

  return (
    <div
      ref={ref}
      draggable={!editing}
      onDragStart={(e) => {
        e.stopPropagation();
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragOver(e);
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDrop(e);
      }}
      className={[
        "group/space flex items-center gap-1 px-1 mb-2 rounded-md transition-all",
        dragging ? "opacity-40" : "",
        isBodyTarget ? "bg-primary/10 ring-1 ring-primary/30" : "",
        spaceDropPos === "above"
          ? "border-t-2 border-primary/70 pt-0"
          : "border-t-2 border-transparent",
        spaceDropPos === "below"
          ? "border-b-2 border-primary/70"
          : "border-b-2 border-transparent",
      ].join(" ")}
    >
      <span className="cursor-grab text-muted-foreground/20 hover:text-muted-foreground/50 shrink-0 transition-colors touch-none">
        <GripVertical size={12} />
      </span>

      {editing ? (
        <InlineEdit
          value={space.name}
          onCommit={(v) => {
            onRename(v);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          className="text-xs font-medium uppercase tracking-wider"
        />
      ) : (
        <>
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60 flex-1 min-w-0 truncate select-none">
            {space.name}
          </span>
          <div className="flex items-center gap-0.5 opacity-0 group-hover/space:opacity-100 transition-opacity duration-150 shrink-0">
            <button
              onClick={() => setEditing(true)}
              className="p-0.5 rounded text-muted-foreground/50 hover:text-primary hover:bg-sidebar-accent/60 transition-colors"
            >
              <Pencil size={11} />
            </button>
            {isAdmin && <DeleteButton onDelete={onDelete} size={11} />}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tag row ──────────────────────────────────────────────────────────────────

function TagRow({
  tag,
  isActive,
  unread,
  isAdmin,
  dragging,
  dropTarget,
  onSelect,
  onRename,
  onDelete,
  onToggleAdminOnly,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  tag: Tag;
  isActive: boolean;
  unread: number;
  isAdmin: boolean;
  dragging: boolean;
  dropTarget: DropTarget | null;
  onSelect: () => void;
  onRename: (v: string) => void;
  onDelete: () => void;
  onToggleAdminOnly: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const [editing, setEditing] = useState(false);

  const tagDropPos =
    dropTarget?.kind === "tag" && dropTarget.id === tag.id
      ? dropTarget.position
      : null;

  if (editing)
    return (
      <div className="px-2 py-1.5">
        <InlineEdit
          value={tag.name}
          onCommit={(v) => {
            onRename(v);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          className="text-sm text-foreground"
        />
      </div>
    );

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragOver(e);
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDrop(e);
      }}
      className={[
        "group/tag relative flex items-center gap-1 transition-all",
        dragging ? "opacity-40" : "",
        tagDropPos === "above"
          ? "border-t-2 border-primary/70"
          : "border-t-2 border-transparent",
        tagDropPos === "below"
          ? "border-b-2 border-primary/70"
          : "border-b-2 border-transparent",
      ].join(" ")}
    >
      <span className="cursor-grab text-muted-foreground/20 hover:text-muted-foreground/50 shrink-0 pl-1 transition-colors touch-none">
        <GripVertical size={12} />
      </span>

      <button
        onClick={onSelect}
        className={[
          "flex-1 flex items-center justify-between px-2 py-2 rounded-md transition-all duration-200 text-sm min-w-0",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm shadow-black/20"
            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
        ].join(" ")}
      >
        <div className="flex items-center gap-2.5 truncate">
          {tag.icon ? (
            <span
              className={`text-base leading-none shrink-0 transition-transform duration-300 ${isActive ? "scale-110" : "group-hover/tag:scale-110"}`}
            >
              {tag.icon}
            </span>
          ) : (
            <span className="w-4 h-4 rounded-full border border-sidebar-border flex items-center justify-center text-[10px] shrink-0">
              #
            </span>
          )}
          <span className="truncate">{tag.name}</span>
        </div>
        {unread > 0 && (
          <div
            className={`min-w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold px-1.5 shrink-0 ${isActive ? "bg-primary text-primary-foreground" : "bg-sidebar-primary/20 text-sidebar-primary"}`}
          >
            {unread}
          </div>
        )}
      </button>

      {/* Always-visible lock indicator for admin-only tags */}
      {tag.isAdminOnly && !isAdmin && (
        <Lock size={10} className="shrink-0 text-muted-foreground/30 mr-1" />
      )}

      <div className="absolute right-1 flex items-center gap-0.5 opacity-0 group-hover/tag:opacity-100 transition-opacity duration-150 bg-sidebar/80 backdrop-blur-sm rounded px-0.5">
        <button
          onClick={() => setEditing(true)}
          className="p-0.5 rounded text-muted-foreground/50 hover:text-primary hover:bg-sidebar-accent/60 transition-colors"
        >
          <Pencil size={11} />
        </button>
        {isAdmin && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleAdminOnly(); }}
            className={`p-0.5 rounded transition-colors ${tag.isAdminOnly ? "text-primary/60 hover:text-primary" : "text-muted-foreground/50 hover:text-primary/70"} hover:bg-sidebar-accent/60`}
            title={tag.isAdminOnly ? "Remove read-only lock" : "Make read-only (admin-only)"}
          >
            {tag.isAdminOnly ? <Lock size={11} /> : <Unlock size={11} />}
          </button>
        )}
        {isAdmin && <DeleteButton onDelete={onDelete} size={11} />}
      </div>
    </div>
  );
}

// ─── Add tag form ─────────────────────────────────────────────────────────────

function AddTagRow({
  spaceId,
  sortOrder,
  onAdd,
}: {
  spaceId: number;
  sortOrder: number;
  onAdd: (d: {
    spaceId: number;
    name: string;
    type: "postbox" | "chat";
    icon: string;
    sortOrder: number;
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"postbox" | "chat">("postbox");
  const inputRef = useRef<HTMLInputElement>(null);
  const open_ = () => {
    setOpen(true);
    setName("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const submit = () => {
    const t = name.trim();
    if (!t) return;
    onAdd({
      spaceId,
      name: t,
      type,
      icon: type === "postbox" ? "📬" : "💬",
      sortOrder,
    });
    setOpen(false);
    setName("");
    setType("postbox");
  };
  if (!open)
    return (
      <button
        onClick={open_}
        className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-sidebar-accent/30 transition-all duration-200 group/addtag"
      >
        <Plus
          size={11}
          className="shrink-0 group-hover/addtag:text-primary transition-colors"
        />
        <span>Add channel</span>
      </button>
    );
  return (
    <div className="px-2 py-1.5 space-y-1.5">
      <div className="flex gap-1">
        {(["postbox", "chat"] as const).map((t) => (
          <button
            key={t}
            onMouseDown={(e) => {
              e.preventDefault(); // prevent input blur → form-close race
              setType(t);
            }}
            className={`flex-1 text-[11px] py-1 rounded transition-colors ${type === t ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground/50 border border-sidebar-border/50 hover:text-muted-foreground"}`}
          >
            {t === "postbox" ? "📬 Postbox" : "💬 Chat"}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 bg-sidebar-accent/60 border border-primary/40 rounded-md px-2 py-1.5">
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") setOpen(false);
          }}
          onBlur={() => {
            if (!name.trim()) setOpen(false);
          }}
          placeholder="Channel name…"
          className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/40 outline-none"
        />
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            submit();
          }}
          disabled={!name.trim()}
          className="text-primary hover:text-primary/80 disabled:opacity-30 shrink-0"
        >
          <Check size={13} />
        </button>
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            setOpen(false);
          }}
          className="text-muted-foreground/50 hover:text-foreground shrink-0"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

// ─── Add space row ────────────────────────────────────────────────────────────

function AddSpaceRow({ onAdd }: { onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const open_ = () => {
    setOpen(true);
    setName("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const submit = () => {
    const t = name.trim();
    if (t) onAdd(t);
    setOpen(false);
    setName("");
  };
  if (!open)
    return (
      <button
        onClick={open_}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-sidebar-accent/40 transition-all duration-200 group/add"
      >
        <Plus
          size={13}
          className="shrink-0 group-hover/add:text-primary transition-colors"
        />
        <span>New space</span>
      </button>
    );
  return (
    <div className="px-3 py-1.5">
      <div className="flex items-center gap-1.5 bg-sidebar-accent/60 border border-primary/40 rounded-md px-2 py-1.5">
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") setOpen(false);
          }}
          onBlur={() => {
            if (!name.trim()) setOpen(false);
          }}
          placeholder="Space name…"
          className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/40 outline-none"
        />
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            submit();
          }}
          disabled={!name.trim()}
          className="text-primary hover:text-primary/80 disabled:opacity-30 shrink-0"
        >
          <Check size={13} />
        </button>
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            setOpen(false);
          }}
          className="text-muted-foreground/50 hover:text-foreground shrink-0"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

// ─── Main Sidebar ─────────────────────────────────────────────────────────────

interface SidebarProps {
  activeTagId?: number;
  onSelectTag: (tag: Tag) => void;
}

export default function Sidebar({ activeTagId, onSelectTag }: SidebarProps) {
  const queryClient = useQueryClient();
  const { data: spaces, isLoading } = useGetSpaces();
  const { data: unreadData } = useGetUnreadCounts({
    query: { refetchInterval: 10000 },
  });
  const { data: me } = useGetMe();
  const { signOut } = useClerk();

  const invalidateSpaces = useCallback(
    () => queryClient.invalidateQueries({ queryKey: getGetSpacesQueryKey() }),
    [queryClient],
  );

  const createSpace = useCreateSpace({
    mutation: { onSuccess: invalidateSpaces },
  });
  const updateSpace = useUpdateSpace({
    mutation: { onSuccess: invalidateSpaces },
  });
  const deleteSpace = useDeleteSpace({
    mutation: { onSuccess: invalidateSpaces },
  });
  const createTag = useCreateTag({ mutation: { onSuccess: invalidateSpaces } });
  const updateTag = useUpdateTag({ mutation: { onSuccess: invalidateSpaces } });
  const deleteTag = useDeleteTag({ mutation: { onSuccess: invalidateSpaces } });

  const isAdmin = me?.isAdmin ?? false;
  const unreadCounts = unreadData?.counts || {};
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  // ── Admin state ──────────────────────────────────────────────────────────────
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data: adminUsers, refetch: refetchAdminUsers } = useQuery<AdminUser[]>({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
    enabled: isAdmin && showAdminPanel,
    staleTime: 30_000,
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete user");
      return res.json();
    },
    onSuccess: () => {
      setDeleteConfirmId(null);
      refetchAdminUsers();
    },
  });
  const sorted = [...(spaces ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  // ── Drag state — stored in refs to avoid stale-closure bugs ─────────────────
  const dragItemRef = useRef<DragItem | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const [dropTarget, setDropTargetState] = useState<DropTarget | null>(null);

  const setDropTarget = (t: DropTarget | null) => {
    dropTargetRef.current = t;
    setDropTargetState(t);
  };

  const clearDrag = () => {
    dragItemRef.current = null;
    setDropTarget(null);
  };

  useEffect(() => {
    const handler = () => clearDrag();
    document.addEventListener("dragend", handler);
    return () => document.removeEventListener("dragend", handler);
  }, []);

  // ── Commit drop ──────────────────────────────────────────────────────────────

  const commitDrop = useCallback(() => {
    const drag = dragItemRef.current;
    const drop = dropTargetRef.current;
    if (!drag || !drop) {
      clearDrag();
      return;
    }

    // ── Reorder spaces ──────────────────────────────────────────────────────
    if (drag.kind === "space" && drop.kind === "space") {
      if (drag.id === drop.id) {
        clearDrag();
        return;
      }
      const fromIdx = sorted.findIndex((s) => s.id === drag.id);
      const toIdx = sorted.findIndex((s) => s.id === drop.id);
      let insertIdx = drop.position === "above" ? toIdx : toIdx + 1;
      if (fromIdx < insertIdx) insertIdx--; // account for removal
      if (fromIdx === insertIdx) {
        clearDrag();
        return;
      }
      const reordered = reorder(sorted, fromIdx, insertIdx);
      reordered.forEach((s, i) => {
        if (s.sortOrder !== i)
          updateSpace.mutate({ spaceId: s.id, data: { sortOrder: i } });
      });
    }

    // ── Move / reorder tags ─────────────────────────────────────────────────
    if (drag.kind === "tag") {
      const srcSpace = sorted.find((s) => s.id === drag.spaceId);
      if (!srcSpace) {
        clearDrag();
        return;
      }
      const srcTags = [...(srcSpace.tags ?? [])].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      );
      const fromIdx = srcTags.findIndex((t) => t.id === drag.id);

      if (drop.kind === "tag") {
        const dstSpaceId = drop.spaceId;

        if (dstSpaceId === drag.spaceId) {
          // ── Same space reorder ────────────────────────────────────────────
          if (drag.id === drop.id) {
            clearDrag();
            return;
          }
          const toIdx = srcTags.findIndex((t) => t.id === drop.id);
          let insertIdx = drop.position === "above" ? toIdx : toIdx + 1;
          if (fromIdx < insertIdx) insertIdx--;
          if (fromIdx === insertIdx) {
            clearDrag();
            return;
          }
          const reordered = reorder(srcTags, fromIdx, insertIdx);
          reordered.forEach((t, i) => {
            if (t.sortOrder !== i)
              updateTag.mutate({ tagId: t.id, data: { sortOrder: i } });
          });
        } else {
          // ── Cross-space move, drop relative to a tag ──────────────────────
          const dstSpace = sorted.find((s) => s.id === dstSpaceId);
          if (!dstSpace) {
            clearDrag();
            return;
          }
          const dstTags = [...(dstSpace.tags ?? [])].sort(
            (a, b) => a.sortOrder - b.sortOrder,
          );
          const refIdx = dstTags.findIndex((t) => t.id === drop.id);
          const insertAt = drop.position === "above" ? refIdx : refIdx + 1;

          // Remove from source, fix source sort orders
          const newSrc = srcTags.filter((t) => t.id !== drag.id);
          newSrc.forEach((t, i) => {
            if (t.sortOrder !== i)
              updateTag.mutate({ tagId: t.id, data: { sortOrder: i } });
          });
          // Insert into dest, fix dest sort orders
          const newDst = [...dstTags];
          newDst.splice(insertAt, 0, { id: drag.id } as Tag);
          updateTag.mutate({
            tagId: drag.id,
            data: { spaceId: dstSpaceId, sortOrder: insertAt },
          });
          newDst.forEach((t, i) => {
            if (t.id !== drag.id && t.sortOrder !== i)
              updateTag.mutate({ tagId: t.id, data: { sortOrder: i } });
          });
        }
      }

      if (drop.kind === "space-body") {
        // ── Drop tag onto a space header → append at end ──────────────────
        const dstSpaceId = drop.spaceId;
        if (dstSpaceId === drag.spaceId) {
          clearDrag();
          return;
        }
        const dstSpace = sorted.find((s) => s.id === dstSpaceId);
        if (!dstSpace) {
          clearDrag();
          return;
        }
        const dstTags = [...(dstSpace.tags ?? [])].sort(
          (a, b) => a.sortOrder - b.sortOrder,
        );
        const newSrc = srcTags.filter((t) => t.id !== drag.id);
        newSrc.forEach((t, i) => {
          if (t.sortOrder !== i)
            updateTag.mutate({ tagId: t.id, data: { sortOrder: i } });
        });
        updateTag.mutate({
          tagId: drag.id,
          data: { spaceId: dstSpaceId, sortOrder: dstTags.length },
        });
      }
    }

    clearDrag();
  }, [sorted, updateSpace, updateTag]);

  // ── Drag event helpers ────────────────────────────────────────────────────

  const spaceHandlers = (space: { id: number }) => ({
    onDragStart: () => {
      dragItemRef.current = { kind: "space", id: space.id };
    },
    onDragOver: (e: React.DragEvent) => {
      const drag = dragItemRef.current;
      if (!drag) return;
      const el = e.currentTarget as HTMLElement;
      if (drag.kind === "space") {
        setDropTarget({
          kind: "space",
          id: space.id,
          position: cursorPosition(e, el),
        });
      } else if (drag.kind === "tag" && drag.spaceId !== space.id) {
        setDropTarget({ kind: "space-body", spaceId: space.id });
      }
    },
    onDragLeave: () => setDropTarget(null),
    onDrop: (e: React.DragEvent) => commitDrop(),
  });

  const tagHandlers = (tag: Tag, spaceId: number) => ({
    onDragStart: () => {
      dragItemRef.current = { kind: "tag", id: tag.id, spaceId };
    },
    onDragOver: (e: React.DragEvent) => {
      const drag = dragItemRef.current;
      if (!drag || drag.kind !== "tag") return;
      const el = e.currentTarget as HTMLElement;
      setDropTarget({
        kind: "tag",
        id: tag.id,
        spaceId,
        position: cursorPosition(e, el),
      });
    },
    onDragLeave: () => setDropTarget(null),
    onDrop: (e: React.DragEvent) => commitDrop(),
  });

  return (
    <div
      className="flex flex-col h-full w-full select-none"
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Header */}
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border/50 shrink-0">
        <div className="flex items-center gap-3 text-primary">
          {/* <Feather size={20} className="stroke-1" /> */}
          <span className="font-serif text-lg tracking-wide font-medium">
            Kothadi
          </span>
        </div>
      </div>

      {/* Spaces + tags */}
      <div className="flex-1 overflow-y-auto py-6 px-3 space-y-6 custom-scrollbar">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {sorted.map((space) => {
              const spaceTags = [...(space.tags ?? [])].sort(
                (a, b) => a.sortOrder - b.sortOrder,
              );
              const sh = spaceHandlers(space);
              return (
                <div key={space.id}>
                  <SpaceHeader
                    space={space}
                    isAdmin={isAdmin}
                    dragging={
                      dragItemRef.current?.kind === "space" &&
                      dragItemRef.current.id === space.id
                    }
                    dropTarget={dropTarget}
                    onRename={(name) =>
                      updateSpace.mutate({ spaceId: space.id, data: { name } })
                    }
                    onDelete={() => deleteSpace.mutate({ spaceId: space.id })}
                    {...sh}
                  />
                  <div className="space-y-0.5 pl-1">
                    {spaceTags.map((tag) => {
                      const th = tagHandlers(tag, space.id);
                      return (
                        <TagRow
                          key={tag.id}
                          tag={tag}
                          isActive={tag.id === activeTagId}
                          unread={unreadCounts[tag.id] || 0}
                          isAdmin={isAdmin}
                          dragging={
                            dragItemRef.current?.kind === "tag" &&
                            dragItemRef.current.id === tag.id
                          }
                          dropTarget={dropTarget}
                          onSelect={() => onSelectTag(tag)}
                          onRename={(name) =>
                            updateTag.mutate({ tagId: tag.id, data: { name } })
                          }
                          onDelete={() => deleteTag.mutate({ tagId: tag.id })}
                          onToggleAdminOnly={() =>
                            updateTag.mutate({ tagId: tag.id, data: { isAdminOnly: !tag.isAdminOnly } })
                          }
                          {...th}
                        />
                      );
                    })}
                    <AddTagRow
                      spaceId={space.id}
                      sortOrder={spaceTags.length}
                      onAdd={(data) => createTag.mutate({ data })}
                    />
                  </div>
                </div>
              );
            })}
            <AddSpaceRow
              onAdd={(name) =>
                createSpace.mutate({ data: { name, sortOrder: sorted.length } })
              }
            />
          </>
        )}
      </div>

      {/* Admin panel */}
      {isAdmin && (
        <div className="px-3 py-2 border-t border-sidebar-border/30 shrink-0">
          <button
            onClick={() => setShowAdminPanel((v) => !v)}
            className="flex items-center gap-2 w-full text-[11px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors py-1 rounded"
          >
            <Shield size={11} />
            <span className="uppercase tracking-wider font-medium">Admin</span>
            <ChevronDown
              size={11}
              className={`ml-auto transition-transform duration-200 ${showAdminPanel ? "rotate-180" : ""}`}
            />
          </button>

          {showAdminPanel && (
            <div className="mt-2 space-y-1">
              {!adminUsers ? (
                <div className="flex items-center justify-center py-3">
                  <Loader2 size={14} className="animate-spin text-muted-foreground/30" />
                </div>
              ) : adminUsers.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/40 px-2 py-1">No users found.</p>
              ) : (
                adminUsers.map((user) => (
                  <div
                    key={user.userId}
                    className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-sidebar-accent/30 transition-colors group"
                  >
                    {/* Avatar */}
                    <div className="w-6 h-6 rounded-full bg-sidebar-accent border border-sidebar-border flex items-center justify-center text-[10px] font-serif text-primary shrink-0">
                      {user.displayName?.charAt(0)?.toUpperCase() || "?"}
                    </div>

                    {/* Name + email */}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-foreground truncate leading-none mb-0.5">
                        {user.displayName || "—"}
                      </div>
                      <div className="text-[10px] text-muted-foreground/50 truncate leading-none">
                        {user.email}
                      </div>
                    </div>

                    {/* Delete — only shown for other users */}
                    {user.userId !== me?.id && (
                      deleteConfirmId === user.userId ? (
                        <div className="flex items-center gap-1 shrink-0 text-[10px]">
                          <button
                            onClick={() => deleteUserMutation.mutate(user.userId)}
                            disabled={deleteUserMutation.isPending}
                            className="text-destructive hover:text-destructive/80 font-medium transition-colors"
                          >
                            {deleteUserMutation.isPending ? "…" : "Delete"}
                          </button>
                          <span className="text-muted-foreground/30">/</span>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="text-muted-foreground/50 hover:text-foreground transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirmId(user.userId)}
                          className="p-1 text-muted-foreground/20 hover:text-destructive hover:bg-destructive/10 rounded transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                          title={`Delete ${user.displayName}`}
                        >
                          <UserX size={12} />
                        </button>
                      )
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* User profile */}
      <div className="p-4 border-t border-sidebar-border/50 shrink-0">
        <div className="flex items-center justify-between bg-sidebar-accent/30 rounded-xl p-3 border border-sidebar-border/50">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 rounded-full bg-sidebar-accent border border-sidebar-border overflow-hidden shrink-0 flex items-center justify-center text-xs font-serif text-primary">
              {me?.avatarUrl ? (
                <img
                  src={me.avatarUrl}
                  alt={me.displayName}
                  className="w-full h-full object-cover"
                />
              ) : (
                me?.displayName?.charAt(0).toUpperCase() || "?"
              )}
            </div>
            <div className="flex flex-col truncate">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-foreground truncate">
                  {me?.displayName}
                </span>
                {isAdmin && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-primary/70 border border-primary/30 rounded px-1 py-px shrink-0">
                    admin
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground truncate">
                {me?.email}
              </span>
            </div>
          </div>
          <button
            onClick={() => signOut({ redirectUrl: basePath || "/" })}
            className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full transition-colors shrink-0"
            title="Sign out"
            data-testid="button-signout"
          >
            <LogOut size={16} className="stroke-[1.5]" />
          </button>
        </div>
      </div>
    </div>
  );
}
