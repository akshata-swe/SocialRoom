import { useState, useRef, useEffect } from "react";
import {
  useGetSpaces,
  useGetUnreadCounts,
  useGetMe,
  useCreateSpace,
  useUpdateSpace,
  useDeleteSpace,
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
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  Check,
  X,
} from "lucide-react";

interface SidebarProps {
  activeTagId?: number;
  onSelectTag: (tag: Tag) => void;
}

function SpaceHeader({
  space,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onRename,
  onDelete,
}: {
  space: { id: number; name: string };
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(space.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(space.name);
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [editing, space.name]);

  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== space.name) onRename(trimmed);
    setEditing(false);
  };

  return (
    <div className="group/space flex items-center gap-1 px-3 mb-2">
      {editing ? (
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setEditing(false);
            }}
            onBlur={commitRename}
            className="flex-1 min-w-0 bg-sidebar-accent/60 border border-primary/40 rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wider text-foreground outline-none focus:border-primary/80"
          />
          <button
            onMouseDown={(e) => { e.preventDefault(); commitRename(); }}
            className="text-primary hover:text-primary/80 shrink-0"
          >
            <Check size={12} />
          </button>
          <button
            onMouseDown={(e) => { e.preventDefault(); setEditing(false); }}
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <>
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60 flex-1 min-w-0 truncate">
            {space.name}
          </span>

          {/* Controls — visible on hover */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover/space:opacity-100 transition-opacity duration-150 shrink-0">
            <button
              onClick={() => setEditing(true)}
              title="Rename"
              className="p-0.5 rounded text-muted-foreground/50 hover:text-primary hover:bg-sidebar-accent/60 transition-colors"
            >
              <Pencil size={11} />
            </button>
            <button
              onClick={onMoveUp}
              disabled={isFirst}
              title="Move up"
              className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-sidebar-accent/60 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            >
              <ChevronUp size={11} />
            </button>
            <button
              onClick={onMoveDown}
              disabled={isLast}
              title="Move down"
              className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-sidebar-accent/60 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            >
              <ChevronDown size={11} />
            </button>
            {confirmDelete ? (
              <>
                <button
                  onClick={onDelete}
                  title="Confirm delete"
                  className="p-0.5 rounded text-destructive hover:bg-destructive/15 transition-colors"
                >
                  <Check size={11} />
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  title="Cancel"
                  className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-sidebar-accent/60 transition-colors"
                >
                  <X size={11} />
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                title="Delete space"
                className="p-0.5 rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

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
    const trimmed = name.trim();
    if (trimmed) onAdd(trimmed);
    setOpen(false);
    setName("");
  };

  if (!open) {
    return (
      <button
        onClick={open_}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-sidebar-accent/40 transition-all duration-200 group/add"
      >
        <Plus size={13} className="shrink-0 group-hover/add:text-primary transition-colors" />
        <span>New space</span>
      </button>
    );
  }

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
          onBlur={() => { if (!name.trim()) setOpen(false); }}
          placeholder="Space name…"
          className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/40 outline-none"
        />
        <button
          onMouseDown={(e) => { e.preventDefault(); submit(); }}
          disabled={!name.trim()}
          className="text-primary hover:text-primary/80 disabled:opacity-30 shrink-0"
        >
          <Check size={13} />
        </button>
        <button
          onMouseDown={(e) => { e.preventDefault(); setOpen(false); }}
          className="text-muted-foreground/50 hover:text-foreground shrink-0"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

export default function Sidebar({ activeTagId, onSelectTag }: SidebarProps) {
  const queryClient = useQueryClient();
  const { data: spaces, isLoading } = useGetSpaces();
  const { data: unreadData } = useGetUnreadCounts({ query: { refetchInterval: 10000 } });
  const { data: me } = useGetMe();
  const { signOut } = useClerk();

  const createSpace = useCreateSpace({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetSpacesQueryKey() }),
    },
  });
  const updateSpace = useUpdateSpace({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetSpacesQueryKey() }),
    },
  });
  const deleteSpace = useDeleteSpace({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetSpacesQueryKey() }),
    },
  });

  const unreadCounts = unreadData?.counts || {};
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  const sorted = [...(spaces ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  const handleMoveUp = (idx: number) => {
    const a = sorted[idx];
    const b = sorted[idx - 1];
    updateSpace.mutate({ spaceId: a.id, data: { sortOrder: b.sortOrder } });
    updateSpace.mutate({ spaceId: b.id, data: { sortOrder: a.sortOrder } });
  };

  const handleMoveDown = (idx: number) => {
    const a = sorted[idx];
    const b = sorted[idx + 1];
    updateSpace.mutate({ spaceId: a.id, data: { sortOrder: b.sortOrder } });
    updateSpace.mutate({ spaceId: b.id, data: { sortOrder: a.sortOrder } });
  };

  return (
    <div className="flex flex-col h-full w-full select-none">
      {/* Header */}
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border/50 shrink-0">
        <div className="flex items-center gap-3 text-primary">
          <Feather size={20} className="stroke-1" />
          <span className="font-serif text-lg tracking-wide font-medium">Sanctuary</span>
        </div>
      </div>

      {/* Spaces + tags */}
      <div className="flex-1 overflow-y-auto py-6 px-3 space-y-8 custom-scrollbar">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {sorted.map((space, idx) => (
              <div key={space.id} className="space-y-0.5">
                <SpaceHeader
                  space={space}
                  isFirst={idx === 0}
                  isLast={idx === sorted.length - 1}
                  onMoveUp={() => handleMoveUp(idx)}
                  onMoveDown={() => handleMoveDown(idx)}
                  onRename={(name) => updateSpace.mutate({ spaceId: space.id, data: { name } })}
                  onDelete={() => deleteSpace.mutate({ spaceId: space.id })}
                />

                <div className="space-y-0.5">
                  {space.tags?.map((tag) => {
                    const isActive = tag.id === activeTagId;
                    const unread = unreadCounts[tag.id] || 0;
                    return (
                      <button
                        key={tag.id}
                        onClick={() => onSelectTag(tag)}
                        className={`
                          w-full flex items-center justify-between px-3 py-2 rounded-md transition-all duration-200 text-sm group
                          ${isActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm shadow-black/20"
                            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                          }
                        `}
                        data-testid={`tag-${tag.id}`}
                      >
                        <div className="flex items-center gap-3 truncate">
                          {tag.icon ? (
                            <span className={`text-base leading-none transition-transform duration-300 ${isActive ? "scale-110" : "group-hover:scale-110"}`}>
                              {tag.icon}
                            </span>
                          ) : (
                            <span className="w-4 h-4 rounded-full border border-sidebar-border flex items-center justify-center text-[10px]">#</span>
                          )}
                          <span className="truncate">{tag.name}</span>
                        </div>
                        {unread > 0 && (
                          <div className={`
                            min-w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold px-1.5
                            ${isActive ? "bg-primary text-primary-foreground" : "bg-sidebar-primary/20 text-sidebar-primary"}
                          `}>
                            {unread}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Add new space */}
            <AddSpaceRow
              onAdd={(name) =>
                createSpace.mutate({
                  data: { name, sortOrder: sorted.length },
                })
              }
            />
          </>
        )}
      </div>

      {/* User profile */}
      <div className="p-4 border-t border-sidebar-border/50 shrink-0">
        <div className="flex items-center justify-between bg-sidebar-accent/30 rounded-xl p-3 border border-sidebar-border/50">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 rounded-full bg-sidebar-accent border border-sidebar-border overflow-hidden shrink-0 flex items-center justify-center text-xs font-serif text-primary">
              {me?.avatarUrl ? (
                <img src={me.avatarUrl} alt={me.displayName} className="w-full h-full object-cover" />
              ) : (
                me?.displayName?.charAt(0).toUpperCase() || "?"
              )}
            </div>
            <div className="flex flex-col truncate">
              <span className="text-sm font-medium text-foreground truncate">{me?.displayName}</span>
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
