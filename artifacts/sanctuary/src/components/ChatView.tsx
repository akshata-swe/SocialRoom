import { useState, useRef, useEffect, useCallback } from "react";
import {
  useGetMessages,
  useSendMessage,
  useUpdateMessage,
  useDeleteMessage,
  useReactToMessage,
  useClearChatHistory,
  useGetMe,
  getGetMessagesQueryKey,
} from "@workspace/api-client-react";
import type { Tag, Message } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, Pencil, Trash2, Check, X, Lock, Eraser, Smile, Camera, Clock, Eye, EyeOff } from "lucide-react";
import { isToday, isYesterday, format, formatDistanceToNow } from "date-fns";
import EmojiPickerPopup from "./EmojiPickerPopup";

interface ChatViewProps {
  tag: Tag;
}

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const diffSeconds = (Date.now() - date.getTime()) / 1000;
  if (diffSeconds < 60) return "Just now";
  const timeStr = format(date, "h:mm a");
  if (isToday(date)) return timeStr;
  if (isYesterday(date)) return `Yesterday at ${timeStr}`;
  return format(date, "MMM d") + ` at ${timeStr}`;
}

// ---------------------------------------------------------------------------
// SSE hook
// ---------------------------------------------------------------------------

interface ChatStreamHandlers {
  onNew: (msg: Message) => void;
  onEdit: (payload: { id: number; content: string }) => void;
  onDelete: (payload: { id: number }) => void;
  onRead: (payload: { upToId: number }) => void;
  onReaction: (payload: { messageId: number; reactions: Record<string, string[]> }) => void;
  onClear: () => void;
  onViewOnceViewed: (payload: { messageId: number }) => void;
}

function useChatStream(
  tagId: number,
  handlers: ChatStreamHandlers,
): "connecting" | "open" | "error" {
  const [status, setStatus] = useState<"connecting" | "open" | "error">("connecting");
  const handlersRef = useRef(handlers);
  useEffect(() => { handlersRef.current = handlers; });

  useEffect(() => {
    setStatus("connecting");
    const es = new EventSource(`/api/messages/stream?tagId=${tagId}`, { withCredentials: true });

    es.addEventListener("connected", () => setStatus("open"));
    es.addEventListener("new", (e: MessageEvent) => {
      try { handlersRef.current.onNew(JSON.parse(e.data) as Message); } catch { /* ignore */ }
    });
    es.addEventListener("edit", (e: MessageEvent) => {
      try { handlersRef.current.onEdit(JSON.parse(e.data)); } catch { /* ignore */ }
    });
    es.addEventListener("delete", (e: MessageEvent) => {
      try { handlersRef.current.onDelete(JSON.parse(e.data)); } catch { /* ignore */ }
    });
    es.addEventListener("read", (e: MessageEvent) => {
      try { handlersRef.current.onRead(JSON.parse(e.data)); } catch { /* ignore */ }
    });
    es.addEventListener("reaction", (e: MessageEvent) => {
      try { handlersRef.current.onReaction(JSON.parse(e.data)); } catch { /* ignore */ }
    });
    es.addEventListener("clear", () => {
      try { handlersRef.current.onClear(); } catch { /* ignore */ }
    });
    es.addEventListener("view-once-viewed", (e: MessageEvent) => {
      try { handlersRef.current.onViewOnceViewed(JSON.parse(e.data)); } catch { /* ignore */ }
    });
    es.onerror = () => setStatus("error");
    return () => es.close();
  }, [tagId]);

  return status;
}

// ---------------------------------------------------------------------------
// ChatView
// ---------------------------------------------------------------------------

export default function ChatView({ tag }: ChatViewProps) {
  const qc = useQueryClient();
  const MSG_PARAMS = { tagId: tag.id, limit: 100 } as const;
  const messagesQueryKey = getGetMessagesQueryKey(MSG_PARAMS);

  const { data: messages, isLoading } = useGetMessages(MSG_PARAMS, {
    query: { enabled: !!tag.id },
  });

  const sendMutation    = useSendMessage();
  const updateMutation  = useUpdateMessage();
  const deleteMutation  = useDeleteMessage();
  const reactMutation   = useReactToMessage();
  const clearMutation   = useClearChatHistory();
  const { data: me }    = useGetMe();

  const isAdminUser = me?.isAdmin ?? false;
  const isReadOnly  = (tag.isAdminOnly ?? false) && !isAdminUser;

  // Compose input
  const [input, setInput]         = useState("");
  const textareaRef               = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef            = useRef<HTMLDivElement>(null);

  // Edit state
  const [editingId, setEditingId]     = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const editInputRef                  = useRef<HTMLTextAreaElement>(null);

  // Delete confirm state (two-step)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // Clear history confirm state (two-step)
  const [confirmClear, setConfirmClear] = useState(false);

  // Emoji picker state — tracks which message's picker is open + its anchor rect
  const [pickerAnchor, setPickerAnchor] = useState<{ msgId: number; rect: DOMRect } | null>(null);

  // View-once photo — pending upload before send
  const [viewOncePending, setViewOncePending] = useState<{
    preview: string;   // local object URL for thumbnail
    uploadedUrl: string | null;
    uploading: boolean;
  } | null>(null);
  // Full-screen viewer modal
  const [viewOnceModal, setViewOnceModal] = useState<{ url: string } | null>(null);
  const viewOnceInputRef = useRef<HTMLInputElement>(null);

  const togglePicker = (msgId: number, e: React.MouseEvent) => {
    if (pickerAnchor?.msgId === msgId) {
      setPickerAnchor(null);
    } else {
      setPickerAnchor({ msgId, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
    }
  };

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  // Focus edit textarea when entering edit mode
  useEffect(() => {
    if (editingId !== null) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingId]);

  // ── SSE handlers ──────────────────────────────────────────────────────────

  const handleNew = useCallback(
    (incoming: Message) => {
      qc.setQueryData<Message[]>(messagesQueryKey, (prev) => {
        if (!prev) return [incoming];
        if (prev.some((m) => m.id === incoming.id)) return prev;
        return [...prev, incoming];
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tag.id],
  );

  const handleEditSSE = useCallback(
    ({ id, content }: { id: number; content: string }) => {
      qc.setQueryData<Message[]>(messagesQueryKey, (prev) =>
        prev?.map((m) => (m.id === id ? { ...m, content } : m)) ?? prev,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tag.id],
  );

  const handleDeleteSSE = useCallback(
    ({ id }: { id: number }) => {
      qc.setQueryData<Message[]>(messagesQueryKey, (prev) =>
        prev?.filter((m) => m.id !== id) ?? prev,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tag.id],
  );

  // Partner opened the chat and their cursor advanced — mark matching messages as seen
  const handleReadSSE = useCallback(
    ({ upToId }: { upToId: number }) => {
      qc.setQueryData<Message[]>(messagesQueryKey, (prev) =>
        prev?.map((m) =>
          m.id <= upToId ? { ...m, seenByPartner: true } : m,
        ) ?? prev,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tag.id],
  );

  // Admin cleared the chat — wipe all messages from the local cache
  const handleClearSSE = useCallback(
    () => {
      qc.setQueryData<Message[]>(messagesQueryKey, () => []);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tag.id],
  );

  // Someone reacted — update reactions on that message in the cache
  const handleReactionSSE = useCallback(
    ({ messageId, reactions }: { messageId: number; reactions: Record<string, string[]> }) => {
      qc.setQueryData<Message[]>(messagesQueryKey, (prev) =>
        prev?.map((m) => (m.id === messageId ? { ...m, reactions } : m)) ?? prev,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tag.id],
  );

  // Partner viewed a view-once photo — mark as opened in local cache
  const handleViewOnceViewedSSE = useCallback(
    ({ messageId }: { messageId: number }) => {
      qc.setQueryData<Message[]>(messagesQueryKey, (prev) =>
        prev?.map((m) => {
          if (m.id !== messageId) return m;
          const vo = (m as any).viewOnce;
          return vo ? { ...m, viewOnce: { ...vo, status: "opened" } } : m;
        }) ?? prev,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tag.id],
  );

  const streamStatus = useChatStream(tag.id, {
    onNew: handleNew,
    onEdit: handleEditSSE,
    onDelete: handleDeleteSSE,
    onRead: handleReadSSE,
    onReaction: handleReactionSSE,
    onClear: handleClearSSE,
    onViewOnceViewed: handleViewOnceViewedSSE,
  });

  // ── View-once ─────────────────────────────────────────────────────────────

  const handleViewOnceSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const preview = URL.createObjectURL(file);
    setViewOncePending({ preview, uploadedUrl: null, uploading: true });
    try {
      const form = new FormData();
      form.append("file", file);
      const resp = await fetch("/api/upload", { method: "POST", credentials: "include", body: form });
      if (!resp.ok) throw new Error("Upload failed");
      const { url } = await resp.json();
      setViewOncePending((prev) => prev ? { ...prev, uploadedUrl: url, uploading: false } : null);
    } catch {
      URL.revokeObjectURL(preview);
      setViewOncePending(null);
    }
  };

  const cancelViewOnce = () => {
    if (viewOncePending?.preview) URL.revokeObjectURL(viewOncePending.preview);
    setViewOncePending(null);
  };

  const sendViewOnce = async () => {
    if (!viewOncePending?.uploadedUrl || !me) return;
    try {
      const resp = await fetch("/api/messages", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagId: tag.id, content: "", viewOnceUrl: viewOncePending.uploadedUrl }),
      });
      if (!resp.ok) throw new Error("Send failed");
      const newMsg = await resp.json();
      qc.setQueryData<Message[]>(messagesQueryKey, (prev) => {
        if (!prev) return [newMsg];
        if (prev.some((m) => m.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });
      cancelViewOnce();
    } catch {
      /* keep pending so user can retry */
    }
  };

  const openViewOnce = async (msgId: number) => {
    try {
      const resp = await fetch(`/api/messages/${msgId}/view`, {
        method: "POST",
        credentials: "include",
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        alert((err as any).error ?? "Cannot open this photo");
        return;
      }
      const { url } = await resp.json();
      setViewOnceModal({ url });
      // Optimistically mark as opened in cache
      qc.setQueryData<Message[]>(messagesQueryKey, (prev) =>
        prev?.map((m) => {
          if (m.id !== msgId) return m;
          const vo = (m as any).viewOnce;
          return vo ? { ...m, viewOnce: { ...vo, status: "opened" } } : m;
        }) ?? prev,
      );
    } catch {
      alert("Could not open photo — please try again.");
    }
  };

  // ── React ─────────────────────────────────────────────────────────────────

  const handleReact = (messageId: number, emoji: string) => {
    reactMutation.mutate(
      { messageId, data: { emoji } },
      {
        onSuccess: ({ reactions }) => {
          qc.setQueryData<Message[]>(messagesQueryKey, (prev) =>
            prev?.map((m) => (m.id === messageId ? { ...m, reactions } : m)) ?? prev,
          );
        },
      },
    );
  };

  // ── Send ──────────────────────────────────────────────────────────────────

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  };

  const handleSend = (e: React.FormEvent | React.KeyboardEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || !me) return;
    sendMutation.mutate(
      { data: { tagId: tag.id, content: text } },
      {
        onSuccess: (newMsg) => {
          setInput("");
          if (textareaRef.current) textareaRef.current.style.height = "auto";
          qc.setQueryData<Message[]>(messagesQueryKey, (prev) => {
            if (!prev) return [newMsg];
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        },
      },
    );
  };

  // ── Edit ──────────────────────────────────────────────────────────────────

  const startEdit = (msg: Message) => {
    setConfirmDeleteId(null);
    setEditingId(msg.id);
    setEditContent(msg.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent("");
  };

  const submitEdit = (messageId: number) => {
    const trimmed = editContent.trim();
    if (!trimmed) return;
    updateMutation.mutate(
      { messageId, data: { content: trimmed } },
      {
        onSuccess: () => {
          qc.setQueryData<Message[]>(messagesQueryKey, (prev) =>
            prev?.map((m) => (m.id === messageId ? { ...m, content: trimmed } : m)) ?? prev,
          );
          cancelEdit();
        },
      },
    );
  };

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = (messageId: number) => {
    if (confirmDeleteId !== messageId) {
      setConfirmDeleteId(messageId);
      return;
    }
    // Confirmed — optimistic remove then fire
    qc.setQueryData<Message[]>(messagesQueryKey, (prev) =>
      prev?.filter((m) => m.id !== messageId) ?? prev,
    );
    deleteMutation.mutate({ messageId });
    setConfirmDeleteId(null);
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  function showSenderHeader(idx: number): boolean {
    if (!messages || idx === 0) return true;
    return messages[idx - 1].senderId !== messages[idx].senderId;
  }

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <>
    <div
      className="flex flex-col h-full w-full max-w-4xl mx-auto"
      onClick={() => setConfirmDeleteId(null)}
    >
      {/* Header */}
      <div className="shrink-0 h-16 flex items-center justify-between px-6 md:px-8 border-b border-border/30 bg-background/50 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3 text-primary/80">
          <span className="text-xl">{tag.icon || "#"}</span>
          <span className="font-serif text-lg font-medium tracking-wide text-foreground">
            {tag.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60 font-light select-none">
          <span className={`w-1.5 h-1.5 rounded-full ${
            streamStatus === "open" ? "bg-emerald-500"
              : streamStatus === "error" ? "bg-amber-500"
              : "bg-muted-foreground/40 animate-pulse"
          }`} />
          {streamStatus === "open" ? "Live" : streamStatus === "error" ? "Reconnecting…" : "Connecting…"}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 custom-scrollbar">
        {isLoading && !messages ? (
          <div className="flex justify-center items-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !messages || messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground font-serif italic text-lg">
            A quiet space for scattered thoughts.
          </div>
        ) : (
          <div className="flex flex-col gap-1 justify-end min-h-full">
            {messages.map((msg, idx) => {
              const isMe         = msg.senderId === me?.id;
              const showHeader   = showSenderHeader(idx);
              const isLastInGroup =
                idx === messages.length - 1 ||
                messages[idx + 1].senderId !== msg.senderId;
              const isEditing         = editingId === msg.id;
              const isConfirmDelete   = confirmDeleteId === msg.id;

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isMe ? "items-end" : "items-start"} ${showHeader ? "mt-4" : "mt-0.5"} ${isMe ? "self-end" : "self-start"} w-full`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Sender name + timestamp */}
                  {showHeader && (
                    <div className={`flex items-baseline gap-2 mb-1.5 px-1 max-w-[82%] ${isMe ? "self-end flex-row-reverse" : "self-start flex-row"}`}>
                      <span className="text-xs font-medium tracking-wide text-foreground/70">
                        {msg.senderDisplayName}
                      </span>
                      <span className="text-[10px] text-muted-foreground/40 font-light">
                        {formatTimestamp(msg.createdAt)}
                      </span>
                    </div>
                  )}

                  {/* Bubble row */}
                  <div className={`flex items-end gap-2 max-w-[82%] ${isMe ? "self-end flex-row-reverse" : "self-start flex-row"}`}>

                    {/* Bubble or edit textarea */}
                    {isEditing ? (
                      <div className="flex flex-col gap-2 w-full min-w-0">
                        <textarea
                          ref={editInputRef}
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEdit(msg.id); }
                            if (e.key === "Escape") cancelEdit();
                          }}
                          className="w-full bg-card border border-primary/40 rounded-2xl px-4 py-3 text-[15px] leading-relaxed text-foreground font-light resize-none focus:outline-none focus:ring-1 focus:ring-primary/30 custom-scrollbar"
                          rows={Math.max(2, editContent.split("\n").length)}
                        />
                        <div className={`flex gap-2 ${isMe ? "justify-end" : "justify-start"}`}>
                          <button
                            onClick={() => submitEdit(msg.id)}
                            disabled={!editContent.trim() || updateMutation.isPending}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors"
                          >
                            <Check size={12} strokeWidth={2.5} />
                            Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted border border-border text-muted-foreground text-xs hover:text-foreground transition-colors"
                          >
                            <X size={12} strokeWidth={2.5} />
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (() => {
                      const vo = (msg as any).viewOnce as {
                        status: "unseen" | "opened" | "expired";
                        expiresAt: string | null;
                        isSender: boolean;
                      } | null;

                      return (
                        <>
                          {/* View-once photo card */}
                          {vo && (
                            <div className={`
                              flex flex-col gap-1.5 select-none
                              ${isMe ? "items-end" : "items-start"}
                            `}>
                              {vo.status === "unseen" && !vo.isSender ? (
                                <button
                                  onClick={() => openViewOnce(msg.id)}
                                  className={`
                                    flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all
                                    bg-card border-primary/40 hover:border-primary hover:bg-primary/5
                                    ${isLastInGroup ? "rounded-tl-sm" : ""}
                                  `}
                                >
                                  <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                                    <Camera size={18} className="text-primary" />
                                  </div>
                                  <div className="flex flex-col items-start">
                                    <span className="text-sm font-medium text-foreground">Photo</span>
                                    <span className="text-xs text-primary font-medium flex items-center gap-1">
                                      <Eye size={11} /> Tap to view once
                                    </span>
                                    {vo.expiresAt && (
                                      <span className="text-[10px] text-muted-foreground/50 flex items-center gap-0.5 mt-0.5">
                                        <Clock size={9} />
                                        Expires {formatDistanceToNow(new Date(vo.expiresAt), { addSuffix: true })}
                                      </span>
                                    )}
                                  </div>
                                </button>
                              ) : (
                                <div className={`
                                  flex items-center gap-3 px-4 py-3 rounded-2xl border
                                  ${isMe
                                    ? "bg-primary/10 border-primary/20 text-primary/70"
                                    : "bg-muted/40 border-border/40 text-muted-foreground"
                                  }
                                  ${isLastInGroup ? (isMe ? "rounded-tr-sm" : "rounded-tl-sm") : ""}
                                `}>
                                  <div className="w-8 h-8 rounded-full bg-muted/60 flex items-center justify-center shrink-0">
                                    {vo.status === "expired"
                                      ? <EyeOff size={15} className="text-muted-foreground/50" />
                                      : <Eye size={15} className="opacity-50" />
                                    }
                                  </div>
                                  <div className="flex flex-col items-start">
                                    <span className="text-sm font-medium">Photo</span>
                                    <span className="text-xs opacity-70">
                                      {vo.status === "opened" ? "Opened" : "Expired"}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Regular text bubble (only shown when there's actual content) */}
                          {msg.content && (
                            <div className={`
                              px-5 py-3 text-[15px] leading-relaxed shadow-sm font-light
                              ${isMe
                                ? `bg-primary text-primary-foreground ${isLastInGroup ? "rounded-2xl rounded-tr-sm" : "rounded-2xl"}`
                                : `bg-card border border-border/60 text-foreground ${isLastInGroup ? "rounded-2xl rounded-tl-sm" : "rounded-2xl"}`
                              }
                            `}>
                              {msg.content}
                            </div>
                          )}
                        </>
                      );
                    })()}

                    {/* Action buttons — only for own messages, always visible but subtle */}
                    {isMe && !isEditing && (
                      <div className="flex items-center gap-0.5 shrink-0 pb-0.5">
                        {/* Edit */}
                        <button
                          onClick={() => startEdit(msg)}
                          className="p-1.5 rounded-full text-muted-foreground/30 hover:text-foreground hover:bg-muted transition-all"
                          title="Edit"
                        >
                          <Pencil size={13} strokeWidth={1.75} />
                        </button>

                        {/* Delete — hidden once partner has seen the message */}
                        {!msg.seenByPartner ? (
                          <button
                            onClick={() => handleDelete(msg.id)}
                            className={`flex items-center gap-1 px-2 py-1.5 rounded-full text-xs font-medium transition-all ${
                              isConfirmDelete
                                ? "bg-destructive text-destructive-foreground"
                                : "text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10"
                            }`}
                            title={isConfirmDelete ? "Tap again to confirm delete" : "Delete"}
                          >
                            <Trash2 size={13} strokeWidth={1.75} />
                            {isConfirmDelete && <span>Delete?</span>}
                          </button>
                        ) : (
                          /* Subtle "seen" dot so the sender knows why delete is gone */
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-primary/40 ml-1 self-center"
                            title="Seen — cannot be deleted"
                          />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Reactions row — shown below the bubble */}
                  {(() => {
                    const reactions = (msg.reactions ?? {}) as Record<string, string[]>;
                    const hasReactions = Object.keys(reactions).some(e => (reactions[e]?.length ?? 0) > 0);
                    const myUserId = me?.id ?? "";
                    return (
                      <div className={`flex flex-col gap-0.5 max-w-[82%] ${isMe ? "self-end items-end" : "self-start items-start"}`}>
                        {/* Reaction pills */}
                        {hasReactions && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {Object.entries(reactions).map(([emoji, users]) =>
                              users.length > 0 ? (
                                <button
                                  key={emoji}
                                  onClick={() => handleReact(msg.id, emoji)}
                                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-sm border transition-all ${
                                    users.includes(myUserId)
                                      ? "bg-primary/20 border-primary/40 text-foreground"
                                      : "bg-muted/60 border-border/40 text-foreground/70 hover:bg-primary/10 hover:border-primary/30"
                                  }`}
                                >
                                  <span>{emoji}</span>
                                  <span className="text-[11px] font-medium">{users.length}</span>
                                </button>
                              ) : null,
                            )}
                          </div>
                        )}

                        {/* Emoji picker trigger — only for partner's messages */}
                        {!isMe && !isEditing && (
                          <div className="flex items-center mt-0.5">
                            <button
                              onClick={(e) => togglePicker(msg.id, e)}
                              className={`rounded-full w-7 h-7 flex items-center justify-center transition-all ${
                                pickerAnchor?.msgId === msg.id
                                  ? "bg-primary/20 text-primary opacity-100"
                                  : "opacity-30 hover:opacity-100 hover:bg-muted text-muted-foreground"
                              }`}
                              title="Add reaction"
                            >
                              <Smile size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
            <div ref={messagesEndRef} className="h-2" />
          </div>
        )}
      </div>

      {/* Emoji picker portal */}
      {pickerAnchor && (
        <EmojiPickerPopup
          anchor={pickerAnchor.rect}
          onSelect={(emoji) => handleReact(pickerAnchor.msgId, emoji)}
          onClose={() => setPickerAnchor(null)}
        />
      )}

      {/* Hidden file input for view-once photos */}
      <input
        ref={viewOnceInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleViewOnceSelect}
      />

      {/* Input area */}
      <div className="shrink-0 p-4 md:p-6 bg-background/80 backdrop-blur-md border-t border-border/30">
        {isReadOnly ? (
          <div className="max-w-3xl mx-auto flex items-center justify-center gap-2 py-3 text-muted-foreground/40 text-sm font-light">
            <Lock size={13} className="shrink-0" />
            <span>This channel is read-only</span>
          </div>
        ) : (
          <>
            {/* View-once pending preview */}
            {viewOncePending && (
              <div className="max-w-3xl mx-auto mb-3 flex items-center gap-3 bg-card border border-primary/30 rounded-2xl px-4 py-3">
                <div className="relative w-12 h-12 rounded-lg overflow-hidden shrink-0 bg-muted">
                  <img src={viewOncePending.preview} alt="View once preview" className="w-full h-full object-cover opacity-80" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">View once photo</p>
                  <p className="text-xs text-muted-foreground/60">
                    {viewOncePending.uploading ? "Uploading…" : "Ready — partner can view this once"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!viewOncePending.uploading && (
                    <button
                      onClick={sendViewOnce}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                    >
                      <Send size={12} /> Send
                    </button>
                  )}
                  {viewOncePending.uploading && <Loader2 size={16} className="animate-spin text-muted-foreground" />}
                  <button onClick={cancelViewOnce} className="p-1.5 rounded-full text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-all">
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}

            <form
              onSubmit={handleSend}
              className="relative max-w-3xl mx-auto flex items-end gap-3 bg-card border border-border rounded-3xl p-2 shadow-sm focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all"
            >
              {/* View-once camera button */}
              <button
                type="button"
                onClick={() => viewOnceInputRef.current?.click()}
                className="shrink-0 p-2.5 rounded-full text-muted-foreground/40 hover:text-primary hover:bg-primary/10 transition-all mb-0.5 ml-0.5"
                title="Send a view-once photo"
                disabled={!!viewOncePending}
              >
                <Camera size={18} />
              </button>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                placeholder="Whisper something…"
                className="flex-1 max-h-32 min-h-[44px] bg-transparent border-none resize-none focus:outline-none focus:ring-0 px-2 py-2.5 text-foreground placeholder:text-muted-foreground/50 font-light custom-scrollbar"
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(e); }
                }}
              />
              <button
                type="submit"
                disabled={!input.trim() || sendMutation.isPending}
                className="shrink-0 p-3 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:hover:bg-primary transition-all flex items-center justify-center mb-0.5 mr-0.5"
                data-testid="button-send-message"
              >
                {sendMutation.isPending
                  ? <Loader2 size={18} className="animate-spin" />
                  : <Send size={18} className="-ml-0.5" />
                }
              </button>
            </form>
            <div className="max-w-3xl mx-auto flex items-center justify-between mt-2">
              <p className="text-[10px] text-muted-foreground/30 font-light">
                Enter to send · Shift+Enter for new line
              </p>
              {isAdminUser && (
                confirmClear ? (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground/50">Clear all history?</span>
                    <button
                      onClick={() => {
                        clearMutation.mutate(
                          { params: { tagId: tag.id } },
                          { onSuccess: () => { qc.setQueryData<Message[]>(messagesQueryKey, () => []); setConfirmClear(false); } },
                        );
                      }}
                      className="text-destructive hover:text-destructive/80 font-medium transition-colors"
                    >
                      Yes, clear
                    </button>
                    <button
                      onClick={() => setConfirmClear(false)}
                      className="text-muted-foreground/50 hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmClear(true)}
                    className="flex items-center gap-1.5 text-[10px] text-muted-foreground/30 hover:text-destructive/60 transition-colors font-light"
                    title="Clear entire chat history (admin)"
                  >
                    <Eraser size={11} />
                    <span>Clear history</span>
                  </button>
                )
              )}
            </div>
          </>
        )}
      </div>
    </div>

      {/* View-once fullscreen modal */}
      {viewOnceModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setViewOnceModal(null)}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={viewOnceModal.url}
              alt="View once photo"
              className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl"
            />
            <div className="flex items-center gap-2 text-white/60 text-xs">
              <EyeOff size={12} />
              <span>You can only view this once — it won't be available again after you close</span>
            </div>
            <button
              onClick={() => setViewOnceModal(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-black/60 border border-white/20 text-white/70 hover:text-white flex items-center justify-center transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
