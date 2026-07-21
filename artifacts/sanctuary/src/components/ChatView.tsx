import { useState, useRef, useEffect, useCallback } from "react";
import {
  useGetMessages,
  useSendMessage,
  useUpdateMessage,
  useDeleteMessage,
  useReactToMessage,
  useGetMe,
  getGetMessagesQueryKey,
} from "@workspace/api-client-react";
import type { Tag, Message } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, Pencil, Trash2, Check, X } from "lucide-react";

const CHAT_EMOJIS = ["❤️", "✨", "🕯️", "☕", "🍂"];
import { isToday, isYesterday, format } from "date-fns";

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
  const { data: me }    = useGetMe();

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

  const streamStatus = useChatStream(tag.id, {
    onNew: handleNew,
    onEdit: handleEditSSE,
    onDelete: handleDeleteSSE,
    onRead: handleReadSSE,
    onReaction: handleReactionSSE,
  });

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
                      <div className="flex flex-col gap-2 w-full min-w-[220px]">
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
                    ) : (
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

                        {/* Emoji picker — only for partner's messages */}
                        {!isMe && !isEditing && (
                          <div className="flex items-center gap-0.5 mt-0.5">
                            {CHAT_EMOJIS.map((emoji) => {
                              const alreadyReacted = ((reactions[emoji] ?? []) as string[]).includes(myUserId);
                              return (
                                <button
                                  key={emoji}
                                  onClick={() => handleReact(msg.id, emoji)}
                                  className={`text-base rounded-full w-7 h-7 flex items-center justify-center transition-all ${
                                    alreadyReacted
                                      ? "bg-primary/20 scale-110"
                                      : "opacity-30 hover:opacity-100 hover:bg-muted"
                                  }`}
                                  title={`React with ${emoji}`}
                                >
                                  {emoji}
                                </button>
                              );
                            })}
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

      {/* Input area */}
      <div className="shrink-0 p-4 md:p-6 bg-background/80 backdrop-blur-md border-t border-border/30">
        <form
          onSubmit={handleSend}
          className="relative max-w-3xl mx-auto flex items-end gap-3 bg-card border border-border rounded-3xl p-2 shadow-sm focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all"
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            placeholder="Whisper something…"
            className="flex-1 max-h-32 min-h-[44px] bg-transparent border-none resize-none focus:outline-none focus:ring-0 px-4 py-2.5 text-foreground placeholder:text-muted-foreground/50 font-light custom-scrollbar"
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
        <p className="text-center text-[10px] text-muted-foreground/30 mt-2 font-light">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
