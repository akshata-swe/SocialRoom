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
import { useQueryClient } from "@tanstack/react-query";
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
} from "lucide-react";

// ─── Drag state types ─────────────────────────────────────────────────────────

type DragItem =
  | { kind: "space"; id: number; sortOrder: number }
  | { kind: "tag"; id: number; spaceId: number; sortOrder: number };

type DropTarget =
  | { kind: "space-gap"; afterIdx: number }               // gap between space blocks
  | { kind: "tag-gap"; spaceId: number; afterIdx: number } // gap between tags in a space
  | { kind: "space-header"; spaceId: number };             // drop tag onto a space header

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
  useEffect(() => { setDraft(value); setTimeout(() => ref.current?.select(), 0); }, [value]);
  const commit = () => { const t = draft.trim(); if (t && t !== value) onCommit(t); else onCancel(); };
  return (
    <div className="flex items-center gap-1 flex-1 min-w-0">
      <input
        ref={ref} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") onCancel(); }}
        onBlur={commit}
        className={`flex-1 min-w-0 bg-sidebar-accent/60 border border-primary/40 rounded px-2 py-0.5 outline-none focus:border-primary/80 ${className}`}
      />
      <button onMouseDown={(e) => { e.preventDefault(); commit(); }} className="text-primary hover:text-primary/80 shrink-0"><Check size={12} /></button>
      <button onMouseDown={(e) => { e.preventDefault(); onCancel(); }} className="text-muted-foreground/50 hover:text-foreground shrink-0"><X size={12} /></button>
    </div>
  );
}

// ─── Two-step delete ──────────────────────────────────────────────────────────

function DeleteButton({ onDelete, size = 11 }: { onDelete: () => void; size?: number }) {
  const [armed, setArmed] = useState(false);
  if (armed) return (
    <>
      <button onClick={onDelete} title="Confirm delete" className="p-0.5 rounded text-destructive hover:bg-destructive/15 transition-colors"><Check size={size} /></button>
      <button onClick={() => setArmed(false)} title="Cancel" className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-sidebar-accent/60 transition-colors"><X size={size} /></button>
    </>
  );
  return (
    <button onClick={() => setArmed(true)} title="Delete" className="p-0.5 rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors">
      <Trash2 size={size} />
    </button>
  );
}

// ─── Drop gap indicator ───────────────────────────────────────────────────────

function DropGap({
  active,
  onDragOver,
  onDrop,
}: {
  active: boolean;
  onDragOver: () => void;
  onDrop: () => void;
}) {
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); onDragOver(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDrop(); }}
      className={`mx-2 rounded-full transition-all duration-100 ${
        active ? "h-0.5 bg-primary/70 my-1 opacity-100" : "h-px opacity-0 my-0"
      }`}
    />
  );
}

// ─── Space header ─────────────────────────────────────────────────────────────

function SpaceHeader({
  space,
  isAdmin,
  isDragging,
  isDropTarget,
  onRename,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  space: { id: number; name: string };
  isAdmin: boolean;
  isDragging: boolean;
  isDropTarget: boolean; // for receiving tags
  onRename: (name: string) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div
      draggable={!editing}
      onDragStart={(e) => { e.stopPropagation(); onDragStart(); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); onDragOver(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDrop(); }}
      className={`group/space flex items-center gap-1 px-1 mb-2 rounded-md transition-colors ${
        isDropTarget ? "bg-primary/10 ring-1 ring-primary/30" : ""
      } ${isDragging ? "opacity-40" : ""}`}
    >
      {/* Grip */}
      <span className="cursor-grab text-muted-foreground/20 hover:text-muted-foreground/50 shrink-0 transition-colors touch-none">
        <GripVertical size={12} />
      </span>

      {editing ? (
        <InlineEdit
          value={space.name}
          onCommit={(v) => { onRename(v); setEditing(false); }}
          onCancel={() => setEditing(false)}
          className="text-xs font-medium uppercase tracking-wider text-foreground"
        />
      ) : (
        <>
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60 flex-1 min-w-0 truncate select-none">
            {space.name}
          </span>
          <div className="flex items-center gap-0.5 opacity-0 group-hover/space:opacity-100 transition-opacity duration-150 shrink-0">
            <button onClick={() => setEditing(true)} title="Rename" className="p-0.5 rounded text-muted-foreground/50 hover:text-primary hover:bg-sidebar-accent/60 transition-colors"><Pencil size={11} /></button>
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
  isDragging,
  onSelect,
  onRename,
  onDelete,
  onDragStart,
}: {
  tag: Tag;
  isActive: boolean;
  unread: number;
  isAdmin: boolean;
  isDragging: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDragStart: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="px-2 py-1.5">
        <InlineEdit
          value={tag.name}
          onCommit={(v) => { onRename(v); setEditing(false); }}
          onCancel={() => setEditing(false)}
          className="text-sm text-foreground"
        />
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={(e) => { e.stopPropagation(); onDragStart(); }}
      className={`group/tag relative flex items-center gap-1 transition-opacity ${isDragging ? "opacity-40" : ""}`}
    >
      {/* Grip handle */}
      <span className="cursor-grab text-muted-foreground/20 hover:text-muted-foreground/50 shrink-0 pl-1 transition-colors touch-none">
        <GripVertical size={12} />
      </span>

      <button
        onClick={onSelect}
        className={`
          flex-1 flex items-center justify-between px-2 py-2 rounded-md transition-all duration-200 text-sm min-w-0
          ${isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm shadow-black/20"
            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
          }
        `}
      >
        <div className="flex items-center gap-2.5 truncate">
          {tag.icon ? (
            <span className={`text-base leading-none shrink-0 transition-transform duration-300 ${isActive ? "scale-110" : "group-hover/tag:scale-110"}`}>{tag.icon}</span>
          ) : (
            <span className="w-4 h-4 rounded-full border border-sidebar-border flex items-center justify-center text-[10px] shrink-0">#</span>
          )}
          <span className="truncate">{tag.name}</span>
        </div>
        {unread > 0 && (
          <div className={`min-w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold px-1.5 shrink-0 ${
            isActive ? "bg-primary text-primary-foreground" : "bg-sidebar-primary/20 text-sidebar-primary"
          }`}>{unread}</div>
        )}
      </button>

      {/* Action controls */}
      <div className="absolute right-1 flex items-center gap-0.5 opacity-0 group-hover/tag:opacity-100 transition-opacity duration-150 bg-sidebar/80 backdrop-blur-sm rounded px-0.5">
        <button onClick={() => setEditing(true)} title="Rename" className="p-0.5 rounded text-muted-foreground/50 hover:text-primary hover:bg-sidebar-accent/60 transition-colors"><Pencil size={11} /></button>
        {isAdmin && <DeleteButton onDelete={onDelete} size={11} />}
      </div>
    </div>
  );
}

// ─── Add tag form ─────────────────────────────────────────────────────────────

function AddTagRow({ spaceId, sortOrder, onAdd }: {
  spaceId: number;
  sortOrder: number;
  onAdd: (data: { spaceId: number; name: string; type: "postbox" | "chat"; icon: string; sortOrder: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"postbox" | "chat">("postbox");
  const inputRef = useRef<HTMLInputElement>(null);
  const open_ = () => { setOpen(true); setName(""); setTimeout(() => inputRef.current?.focus(), 0); };
  const submit = () => {
    const t = name.trim();
    if (!t) return;
    onAdd({ spaceId, name: t, type, icon: type === "postbox" ? "📬" : "💬", sortOrder });
    setOpen(false); setName(""); setType("postbox");
  };
  if (!open) return (
    <button onClick={open_} className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-sidebar-accent/30 transition-all duration-200 group/addtag">
      <Plus size={11} className="shrink-0 group-hover/addtag:text-primary transition-colors" />
      <span>Add channel</span>
    </button>
  );
  return (
    <div className="px-2 py-1.5 space-y-1.5">
      <div className="flex gap-1">
        {(["postbox", "chat"] as const).map((t) => (
          <button key={t} onClick={() => setType(t)} className={`flex-1 text-[11px] py-1 rounded transition-colors ${type === t ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground/50 border border-sidebar-border/50 hover:text-muted-foreground"}`}>
            {t === "postbox" ? "📬 Postbox" : "💬 Chat"}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 bg-sidebar-accent/60 border border-primary/40 rounded-md px-2 py-1.5">
        <input
          ref={inputRef} value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setOpen(false); }}
          onBlur={() => { if (!name.trim()) setOpen(false); }}
          placeholder="Channel name…"
          className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/40 outline-none"
        />
        <button onMouseDown={(e) => { e.preventDefault(); submit(); }} disabled={!name.trim()} className="text-primary hover:text-primary/80 disabled:opacity-30 shrink-0"><Check size={13} /></button>
        <button onMouseDown={(e) => { e.preventDefault(); setOpen(false); }} className="text-muted-foreground/50 hover:text-foreground shrink-0"><X size={13} /></button>
      </div>
    </div>
  );
}

// ─── Add space row ────────────────────────────────────────────────────────────

function AddSpaceRow({ onAdd }: { onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const open_ = () => { setOpen(true); setName(""); setTimeout(() => inputRef.current?.focus(), 0); };
  const submit = () => { const t = name.trim(); if (t) onAdd(t); setOpen(false); setName(""); };
  if (!open) return (
    <button onClick={open_} className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-sidebar-accent/40 transition-all duration-200 group/add">
      <Plus size={13} className="shrink-0 group-hover/add:text-primary transition-colors" />
      <span>New space</span>
    </button>
  );
  return (
    <div className="px-3 py-1.5">
      <div className="flex items-center gap-1.5 bg-sidebar-accent/60 border border-primary/40 rounded-md px-2 py-1.5">
        <input
          ref={inputRef} value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setOpen(false); }}
          onBlur={() => { if (!name.trim()) setOpen(false); }}
          placeholder="Space name…"
          className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/40 outline-none"
        />
        <button onMouseDown={(e) => { e.preventDefault(); submit(); }} disabled={!name.trim()} className="text-primary hover:text-primary/80 disabled:opacity-30 shrink-0"><Check size={13} /></button>
        <button onMouseDown={(e) => { e.preventDefault(); setOpen(false); }} className="text-muted-foreground/50 hover:text-foreground shrink-0"><X size={13} /></button>
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
  const { data: unreadData } = useGetUnreadCounts({ query: { refetchInterval: 10000 } });
  const { data: me } = useGetMe();
  const { signOut } = useClerk();

  const invalidateSpaces = useCallback(
    () => queryClient.invalidateQueries({ queryKey: getGetSpacesQueryKey() }),
    [queryClient]
  );

  const createSpace = useCreateSpace({ mutation: { onSuccess: invalidateSpaces } });
  const updateSpace = useUpdateSpace({ mutation: { onSuccess: invalidateSpaces } });
  const deleteSpace = useDeleteSpace({ mutation: { onSuccess: invalidateSpaces } });
  const createTag   = useCreateTag({ mutation: { onSuccess: invalidateSpaces } });
  const updateTag   = useUpdateTag({ mutation: { onSuccess: invalidateSpaces } });
  const deleteTag   = useDeleteTag({ mutation: { onSuccess: invalidateSpaces } });

  const isAdmin = me?.isAdmin ?? false;
  const unreadCounts = unreadData?.counts || {};
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const sorted = [...(spaces ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  // ── Drag state ──────────────────────────────────────────────────────────────
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const clearDrag = () => { setDragItem(null); setDropTarget(null); };

  // ── Reorder helpers ─────────────────────────────────────────────────────────

  /** Reorder a list by moving `fromIdx` to `toIdx`, return new array */
  function reorder<T>(list: T[], fromIdx: number, toIdx: number): T[] {
    const result = [...list];
    const [item] = result.splice(fromIdx, 1);
    result.splice(toIdx, 0, item);
    return result;
  }

  // ── Drop handlers ───────────────────────────────────────────────────────────

  const handleDrop = useCallback(() => {
    if (!dragItem || !dropTarget) { clearDrag(); return; }

    if (dragItem.kind === "space" && dropTarget.kind === "space-gap") {
      // Reorder spaces
      const fromIdx = sorted.findIndex((s) => s.id === dragItem.id);
      let toIdx = dropTarget.afterIdx + 1; // insert after `afterIdx`
      if (fromIdx < 0) { clearDrag(); return; }
      // Adjust toIdx if moving forward
      const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx;
      if (adjustedTo === fromIdx) { clearDrag(); return; }
      const reordered = reorder(sorted, fromIdx, adjustedTo);
      reordered.forEach((space, i) => {
        if (space.sortOrder !== i) updateSpace.mutate({ spaceId: space.id, data: { sortOrder: i } });
      });
    }

    if (dragItem.kind === "tag") {
      const sourceSpace = sorted.find((s) => s.id === dragItem.spaceId);
      if (!sourceSpace) { clearDrag(); return; }
      const sourceTags = [...(sourceSpace.tags ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
      const fromIdx = sourceTags.findIndex((t) => t.id === dragItem.id);

      if (dropTarget.kind === "tag-gap" && dropTarget.spaceId === dragItem.spaceId) {
        // Reorder within same space
        let toIdx = dropTarget.afterIdx + 1;
        const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx;
        if (adjustedTo === fromIdx) { clearDrag(); return; }
        const reordered = reorder(sourceTags, fromIdx, adjustedTo);
        reordered.forEach((tag, i) => {
          if (tag.sortOrder !== i) updateTag.mutate({ tagId: tag.id, data: { sortOrder: i } });
        });
      } else if (
        (dropTarget.kind === "tag-gap" && dropTarget.spaceId !== dragItem.spaceId) ||
        dropTarget.kind === "space-header"
      ) {
        // Move to different space
        const destSpaceId = dropTarget.kind === "space-header" ? dropTarget.spaceId : dropTarget.spaceId;
        const destSpace = sorted.find((s) => s.id === destSpaceId);
        if (!destSpace) { clearDrag(); return; }
        const destTags = [...(destSpace.tags ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

        // Figure out insert position in dest
        let insertAt = dropTarget.kind === "space-header"
          ? destTags.length
          : dropTarget.afterIdx + 1;

        // Remove from source (update source sort orders)
        const newSource = sourceTags.filter((t) => t.id !== dragItem.id);
        newSource.forEach((tag, i) => {
          if (tag.sortOrder !== i) updateTag.mutate({ tagId: tag.id, data: { sortOrder: i } });
        });

        // Insert into dest
        const newDest = [...destTags];
        newDest.splice(insertAt, 0, { id: dragItem.id } as Tag);
        // Move tag to dest space at correct position
        updateTag.mutate({ tagId: dragItem.id, data: { spaceId: destSpaceId, sortOrder: insertAt } });
        // Fix sort orders of remaining dest tags
        newDest.forEach((tag, i) => {
          if (tag.id !== dragItem.id && tag.sortOrder !== i) {
            updateTag.mutate({ tagId: tag.id, data: { sortOrder: i } });
          }
        });
      }
    }

    clearDrag();
  }, [dragItem, dropTarget, sorted, updateSpace, updateTag]);

  // Attach document-level dragend to clean up if drop lands nowhere
  useEffect(() => {
    const handler = () => clearDrag();
    document.addEventListener("dragend", handler);
    return () => document.removeEventListener("dragend", handler);
  }, []);

  const isSpaceGapActive = (afterIdx: number) =>
    dragItem?.kind === "space" &&
    dropTarget?.kind === "space-gap" &&
    dropTarget.afterIdx === afterIdx;

  const isTagGapActive = (spaceId: number, afterIdx: number) =>
    dragItem?.kind === "tag" &&
    dropTarget?.kind === "tag-gap" &&
    dropTarget.spaceId === spaceId &&
    dropTarget.afterIdx === afterIdx;

  const isSpaceHeaderDropTarget = (spaceId: number) =>
    dragItem?.kind === "tag" &&
    dragItem.spaceId !== spaceId &&
    dropTarget?.kind === "space-header" &&
    dropTarget.spaceId === spaceId;

  return (
    <div
      className="flex flex-col h-full w-full select-none"
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Header */}
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border/50 shrink-0">
        <div className="flex items-center gap-3 text-primary">
          <Feather size={20} className="stroke-1" />
          <span className="font-serif text-lg tracking-wide font-medium">Sanctuary</span>
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
            {/* Gap before first space */}
            <DropGap
              active={isSpaceGapActive(-1)}
              onDragOver={() => dragItem?.kind === "space" && setDropTarget({ kind: "space-gap", afterIdx: -1 })}
              onDrop={handleDrop}
            />

            {sorted.map((space, spaceIdx) => {
              const spaceTags = [...(space.tags ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

              return (
                <div key={space.id}>
                  <SpaceHeader
                    space={space}
                    isAdmin={isAdmin}
                    isDragging={dragItem?.kind === "space" && dragItem.id === space.id}
                    isDropTarget={isSpaceHeaderDropTarget(space.id)}
                    onRename={(name) => updateSpace.mutate({ spaceId: space.id, data: { name } })}
                    onDelete={() => deleteSpace.mutate({ spaceId: space.id })}
                    onDragStart={() => setDragItem({ kind: "space", id: space.id, sortOrder: space.sortOrder })}
                    onDragOver={() => dragItem?.kind === "tag" && setDropTarget({ kind: "space-header", spaceId: space.id })}
                    onDrop={handleDrop}
                  />

                  {/* Tags */}
                  <div className="space-y-0.5 pl-1">
                    {/* Gap before first tag */}
                    <DropGap
                      active={isTagGapActive(space.id, -1)}
                      onDragOver={() => dragItem?.kind === "tag" && setDropTarget({ kind: "tag-gap", spaceId: space.id, afterIdx: -1 })}
                      onDrop={handleDrop}
                    />

                    {spaceTags.map((tag, tagIdx) => (
                      <div key={tag.id}>
                        <TagRow
                          tag={tag}
                          isActive={tag.id === activeTagId}
                          unread={unreadCounts[tag.id] || 0}
                          isAdmin={isAdmin}
                          isDragging={dragItem?.kind === "tag" && dragItem.id === tag.id}
                          onSelect={() => onSelectTag(tag)}
                          onRename={(name) => updateTag.mutate({ tagId: tag.id, data: { name } })}
                          onDelete={() => deleteTag.mutate({ tagId: tag.id })}
                          onDragStart={() => setDragItem({ kind: "tag", id: tag.id, spaceId: space.id, sortOrder: tag.sortOrder })}
                        />
                        {/* Gap after each tag */}
                        <DropGap
                          active={isTagGapActive(space.id, tagIdx)}
                          onDragOver={() => dragItem?.kind === "tag" && setDropTarget({ kind: "tag-gap", spaceId: space.id, afterIdx: tagIdx })}
                          onDrop={handleDrop}
                        />
                      </div>
                    ))}

                    <AddTagRow
                      spaceId={space.id}
                      sortOrder={spaceTags.length}
                      onAdd={(data) => createTag.mutate({ data })}
                    />
                  </div>

                  {/* Gap after this space block */}
                  <DropGap
                    active={isSpaceGapActive(spaceIdx)}
                    onDragOver={() => dragItem?.kind === "space" && setDropTarget({ kind: "space-gap", afterIdx: spaceIdx })}
                    onDrop={handleDrop}
                  />
                </div>
              );
            })}

            <AddSpaceRow
              onAdd={(name) => createSpace.mutate({ data: { name, sortOrder: sorted.length } })}
            />
          </>
        )}
      </div>

      {/* User profile */}
      <div className="p-4 border-t border-sidebar-border/50 shrink-0">
        <div className="flex items-center justify-between bg-sidebar-accent/30 rounded-xl p-3 border border-sidebar-border/50">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 rounded-full bg-sidebar-accent border border-sidebar-border overflow-hidden shrink-0 flex items-center justify-center text-xs font-serif text-primary">
              {me?.avatarUrl
                ? <img src={me.avatarUrl} alt={me.displayName} className="w-full h-full object-cover" />
                : me?.displayName?.charAt(0).toUpperCase() || "?"}
            </div>
            <div className="flex flex-col truncate">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-foreground truncate">{me?.displayName}</span>
                {isAdmin && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-primary/70 border border-primary/30 rounded px-1 py-px shrink-0">admin</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground truncate">{me?.email}</span>
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
