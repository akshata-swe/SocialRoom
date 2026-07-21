import { useState, useRef, useEffect, useCallback } from "react";
import {
  useGetMessages,
  useSendMessage,
  useUpdateMessage,
  useDeleteMessage,
  useGetMe,
  getGetMessagesQueryKey,
} from "@workspace/api-client-react";
import type { Tag, Message } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, Pencil, Trash2, Check, X } from "lucide-react";
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
// SSE hook — real-time message subscription
// ---------------------------------------------------------------------------

interface ChatStreamHandlers {
  onNew: (msg: Message) => void;
  onEdit: (payload: { id: number; content: string }) => void;
  onDelete: (payload: { id: number }) => void;
}

function useChatStream(
  tagId: number,
  handlers: ChatStreamHandlers,
): "connecting" | "open" | "error" {
  const [status, setStatus] = useState<"connecting" | "open" | "error">(
    "connecting",
  );
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    setStatus("connecting");
    const url = `/api/messages/stream?tagId=${tagId}`;
    const es = new EventSource(url, { withCredentials: true });

    es.addEventListener("connected", () => setStatus("open"));

    es.addEventListener("new", (e: MessageEvent) => {
      try {
        handlersRef.current.onNew(JSON.parse(e.data) as Message);
      } catch { /* ignore */ }
    });

    es.addEventListener("edit", (e: MessageEvent) => {
      try {
        handlersRef.current.onEdit(JSON.parse(e.data) as { id: number; content: string });
      } catch { /* ignore */ }
    });

    es.addEventListener("delete", (e: MessageEvent) => {
      try {
        handlersRef.current.onDelete(JSON.parse(e.data) as { id: number });
      } catch { /* ignore */ }
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

  const { data: messages, isLoading } = useGetMessages(
    MSG_PARAMS,
    { query: { enabled: !!tag.id } },
  );

  const sendMessageMutation = useSendMessage();
  const updateMessageMutation = useUpdateMessage();
  const deleteMessageMutation = useDeleteMessage();
  const { data: me } = useGetMe();

  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  // Focus edit input when entering edit mode
  useEffect(() => {
    if (editingId !== null) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingId]);

  // ---------------------------------------------------------------------------
  // SSE cache update handlers
  // ---------------------------------------------------------------------------

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

  const handleEdit = useCallback(
    ({ id, content }: { id: number; content: string }) => {
      qc.setQueryData<Message[]>(messagesQueryKey, (prev) =>
        prev?.map((m) => (m.id === id ? { ...m, content } : m)) ?? prev,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tag.id],
  );

  const handleDelete = useCallback(
    ({ id }: { id: number }) => {
      qc.setQueryData<Message[]>(messagesQueryKey, (prev) =>
        prev?.filter((m) => m.id !== id) ?? prev,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tag.id],
  );

  const streamStatus = useChatStream(tag.id, {
    onNew: handleNew,
    onEdit: handleEdit,
    onDelete: handleDelete,
  });

  // ---------------------------------------------------------------------------
  // Send
  // ---------------------------------------------------------------------------

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

    sendMessageMutation.mutate(
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

  // ---------------------------------------------------------------------------
  // Edit
  // ---------------------------------------------------------------------------

  const startEdit = (msg: Message) => {
    setEditingId(msg.id);
    setEditContent(msg.content);
    setConfirmDeleteId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent("");
  };

  const submitEdit = (messageId: number) => {
    const trimmed = editContent.trim();
    if (!trimmed) return;
    updateMessageMutation.mutate(
      { messageId, data: { content: trimmed } },
      {
        onSuccess: () => {
          // SSE will also broadcast edit; update optimistically for sender
          qc.setQueryData<Message[]>(messagesQueryKey, (prev) =>
            prev?.map((m) => (m.id === messageId ? { ...m, content: trimmed } : m)) ?? prev,
          );
          setEditingId(null);
          setEditContent("");
        },
      },
    );
  };

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  const handleDeleteClick = (messageId: number) => {
    if (confirmDeleteId === messageId) {
      // Optimistically remove from cache immediately
      qc.setQueryData<Message[]>(messagesQueryKey, (prev) =>
        prev?.filter((m) => m.id !== messageId) ?? prev,
      );
      deleteMessageMutation.mutate({ messageId });
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(messageId);
    }
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function showSenderHeader(idx: number): boolean {
    if (!messages || idx === 0) return true;
    return messages[idx - 1].senderId !== messages[idx].senderId;
  }

  return (
    <div
      className="flex flex-col h-full w-full max-w-4xl mx-auto"
      onClick={() => { setConfirmDeleteId(null); setHoveredId(null); }}
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
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              streamStatus === "open"
                ? "bg-emerald-500"
                : streamStatus === "error"
                  ? "bg-amber-500"
                  : "bg-muted-foreground/40 animate-pulse"
            }`}
          />
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
              const isMe = msg.senderId === me?.id;
              const showHeader = showSenderHeader(idx);
              const isLastInGroup =
                idx === messages.length - 1 ||
                messages[idx + 1].senderId !== msg.senderId;
              const isEditing = editingId === msg.id;
              const isHovered = hoveredId === msg.id;
              const isConfirmingDelete = confirmDeleteId === msg.id;

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isMe ? "items-end" : "items-start"} ${showHeader ? "mt-4" : "mt-0.5"} max-w-[82%] ${isMe ? "self-end" : "self-start"}`}
                  onMouseEnter={() => setHoveredId(msg.id)}
                  onMouseLeave={() => { if (!isConfirmingDelete) setHoveredId(null); }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Sender name + timestamp */}
                  {showHeader && (
                    <div className={`flex items-baseline gap-2 mb-1.5 px-1 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                      <span className="text-xs font-medium tracking-wide text-foreground/70">
                        {msg.senderDisplayName}
                      </span>
                      <span className="text-[10px] text-muted-foreground/40 font-light">
                        {formatTimestamp(msg.createdAt)}
                      </span>
                    </div>
                  )}

                  {/* Bubble + action toolbar */}
                  <div className={`flex items-end gap-1.5 ${isMe ? "flex-row-reverse" : "flex-row"}`}>

                    {/* Bubble / edit mode */}
                    {isEditing ? (
                      <div className="flex flex-col gap-2 min-w-[200px] max-w-full">
                        <textarea
                          ref={editInputRef}
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEdit(msg.id); }
                            if (e.key === "Escape") cancelEdit();
                          }}
                          className="w-full bg-card border border-primary/50 rounded-2xl px-4 py-3 text-[15px] leading-relaxed text-foreground font-light resize-none focus:outline-none focus:ring-1 focus:ring-primary/30 custom-scrollbar"
                          rows={Math.min(editContent.split("\n").length + 1, 6)}
                        />
                        <div className={`flex gap-2 ${isMe ? "justify-end" : "justify-start"}`}>
                          <button
                            onClick={() => submitEdit(msg.id)}
                            disabled={!editContent.trim() || updateMessageMutation.isPending}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
                          >
                            <Check size={12} />
                            Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card border border-border text-muted-foreground text-xs hover:text-foreground transition-colors"
                          >
                            <X size={12} />
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className={`
                          px-5 py-3 text-[15px] leading-relaxed shadow-sm font-light
                          ${isMe
                            ? `bg-primary text-primary-foreground ${isLastInGroup ? "rounded-2xl rounded-tr-sm" : "rounded-2xl"}`
                            : `bg-card border border-border/60 text-foreground ${isLastInGroup ? "rounded-2xl rounded-tl-sm" : "rounded-2xl"}`
                          }
                        `}
                      >
                        {msg.content}
                      </div>
                    )}

                    {/* Action toolbar — visible on hover, hidden during editing */}
                    {!isEditing && (isHovered || isConfirmingDelete) && (
                      <div className={`flex items-center gap-0.5 shrink-0 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                        {/* Edit — own messages only */}
                        {isMe && (
                          <button
                            onClick={() => startEdit(msg)}
                            className="p-1.5 rounded-full text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-all"
                            title="Edit message"
                          >
                            <Pencil size={13} strokeWidth={1.75} />
                          </button>
                        )}

                        {/* Delete */}
                        <button
                          onClick={() => handleDeleteClick(msg.id)}
                          className={`flex items-center gap-1 px-2 py-1.5 rounded-full text-xs font-medium transition-all
                            ${isConfirmingDelete
                              ? "bg-destructive text-destructive-foreground"
                              : "text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10"
                            }`}
                          title={isConfirmingDelete ? "Click again to confirm" : "Delete message"}
                        >
                          <Trash2 size={13} strokeWidth={1.75} />
                          {isConfirmingDelete && <span>Delete?</span>}
                        </button>
                      </div>
                    )}
                  </div>
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
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
          />
          <button
            type="submit"
            disabled={!input.trim() || sendMessageMutation.isPending}
            className="shrink-0 p-3 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:hover:bg-primary transition-all flex items-center justify-center mb-0.5 mr-0.5"
            data-testid="button-send-message"
          >
            {sendMessageMutation.isPending ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} className="-ml-0.5" />
            )}
          </button>
        </form>
        <p className="text-center text-[10px] text-muted-foreground/30 mt-2 font-light">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
