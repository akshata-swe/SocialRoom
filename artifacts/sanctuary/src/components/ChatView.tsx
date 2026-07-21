import { useState, useRef, useEffect, useCallback } from "react";
import {
  useGetMessages,
  useSendMessage,
  useGetMe,
  getGetMessagesQueryKey,
} from "@workspace/api-client-react";
import type { Tag, Message } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { formatDistanceToNow, isToday, isYesterday, format } from "date-fns";

interface ChatViewProps {
  tag: Tag;
}

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

/**
 * Format a UTC ISO-8601 server timestamp into a friendly local-time string.
 *
 * Rules:
 *  • Messages from today       → "3:08 PM"
 *  • Messages from yesterday   → "Yesterday at 3:08 PM"
 *  • Within the last 60s       → "Just now"
 *  • Older than yesterday      → "Jul 18 at 3:08 PM"
 */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const diffSeconds = (Date.now() - date.getTime()) / 1000;

  if (diffSeconds < 60) return "Just now";

  const timeStr = format(date, "h:mm a"); // e.g. "3:08 PM" — uses device locale timezone

  if (isToday(date)) return timeStr;
  if (isYesterday(date)) return `Yesterday at ${timeStr}`;
  return format(date, "MMM d") + ` at ${timeStr}`;
}

// ---------------------------------------------------------------------------
// SSE hook — real-time message subscription
// ---------------------------------------------------------------------------

/**
 * Opens a Server-Sent Events connection to /api/messages/stream?tagId=N.
 * When the server broadcasts a new message, `onMessage` is called with the
 * parsed payload and the TanStack Query cache for this tag is updated so the
 * ChatView re-renders instantly — no polling required.
 *
 * The connection is torn down and re-created whenever `tagId` changes, and
 * cleaned up on unmount.
 */
function useChatStream(
  tagId: number,
  onMessage: (msg: Message) => void,
): "connecting" | "open" | "error" {
  const [status, setStatus] = useState<"connecting" | "open" | "error">(
    "connecting",
  );
  // Stable ref so the effect closure always sees the latest callback
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  });

  useEffect(() => {
    setStatus("connecting");
    const url = `/api/messages/stream?tagId=${tagId}`;
    const es = new EventSource(url, { withCredentials: true });

    es.addEventListener("connected", () => setStatus("open"));

    es.addEventListener("message", (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data) as Message;
        onMessageRef.current(msg);
      } catch {
        // Malformed event — ignore
      }
    });

    es.onerror = () => {
      // EventSource auto-reconnects; mark as error temporarily
      setStatus("error");
    };

    return () => {
      es.close();
    };
  }, [tagId]);

  return status;
}

// ---------------------------------------------------------------------------
// ChatView
// ---------------------------------------------------------------------------

export default function ChatView({ tag }: ChatViewProps) {
  const qc = useQueryClient();
  const messagesQueryKey = getGetMessagesQueryKey({ tagId: tag.id });

  // Initial history load — no polling; SSE handles live updates
  const { data: messages, isLoading } = useGetMessages(
    { tagId: tag.id, limit: 100 },
    { query: { enabled: !!tag.id } },
  );

  const sendMessageMutation = useSendMessage();
  const { data: me } = useGetMe();

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom whenever the message list grows
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  // SSE — append incoming messages to the TanStack Query cache
  const handleIncomingMessage = useCallback(
    (incoming: Message) => {
      qc.setQueryData<Message[]>(messagesQueryKey, (prev) => {
        if (!prev) return [incoming];
        // Deduplicate — sender's own POST response arrives via both the
        // mutation onSuccess invalidation and the SSE broadcast
        if (prev.some((m) => m.id === incoming.id)) return prev;
        return [...prev, incoming];
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tag.id],
  );

  const streamStatus = useChatStream(tag.id, handleIncomingMessage);

  // Auto-resize textarea as the user types
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
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
          }
          // SSE will deliver the message to the other party; optimistically
          // add it to our own cache immediately via the mutation response so
          // the sender sees it right away without waiting for the SSE echo.
          qc.setQueryData<Message[]>(messagesQueryKey, (prev) => {
            if (!prev) return [newMsg];
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        },
      },
    );
  };

  // Group consecutive messages from the same sender for header collapsing
  function showSenderHeader(idx: number): boolean {
    if (!messages || idx === 0) return true;
    return messages[idx - 1].senderId !== messages[idx].senderId;
  }

  return (
    <div className="flex flex-col h-full w-full max-w-4xl mx-auto">
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                              */}
      {/* ------------------------------------------------------------------ */}
      <div className="shrink-0 h-16 flex items-center justify-between px-6 md:px-8 border-b border-border/30 bg-background/50 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3 text-primary/80">
          <span className="text-xl">{tag.icon || "#"}</span>
          <span className="font-serif text-lg font-medium tracking-wide text-foreground">
            {tag.name}
          </span>
        </div>

        {/* Live-status indicator */}
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
          {streamStatus === "open"
            ? "Live"
            : streamStatus === "error"
              ? "Reconnecting…"
              : "Connecting…"}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Messages area                                                        */}
      {/* ------------------------------------------------------------------ */}
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

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isMe ? "items-end" : "items-start"} ${showHeader ? "mt-4" : "mt-0.5"} max-w-[82%] ${isMe ? "self-end" : "self-start"}`}
                >
                  {/* Sender name + timestamp — shown once per run of same sender */}
                  {showHeader && (
                    <div
                      className={`flex items-baseline gap-2 mb-1.5 px-1 ${isMe ? "flex-row-reverse" : "flex-row"}`}
                    >
                      {/* senderDisplayName — the preferred display name; never the login email */}
                      <span className="text-xs font-medium tracking-wide text-foreground/70">
                        {msg.senderDisplayName}
                      </span>
                      <span className="text-[10px] text-muted-foreground/40 font-light">
                        {formatTimestamp(msg.createdAt)}
                      </span>
                    </div>
                  )}

                  <div
                    className={`
                      px-5 py-3 text-[15px] leading-relaxed shadow-sm font-light
                      ${
                        isMe
                          ? `bg-primary text-primary-foreground ${isLastInGroup ? "rounded-2xl rounded-tr-sm" : "rounded-2xl"}`
                          : `bg-card border border-border/60 text-foreground ${isLastInGroup ? "rounded-2xl rounded-tl-sm" : "rounded-2xl"}`
                      }
                    `}
                  >
                    {msg.content}
                  </div>
                </div>
              );
            })}

            <div ref={messagesEndRef} className="h-2" />
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Input area                                                          */}
      {/* ------------------------------------------------------------------ */}
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
