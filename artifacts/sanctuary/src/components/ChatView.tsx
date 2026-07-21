import { useState, useRef, useEffect } from "react";
import { useGetMessages, useSendMessage, useGetMe, Tag, getGetMessagesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { format } from "date-fns";

interface ChatViewProps {
  tag: Tag;
}

export default function ChatView({ tag }: ChatViewProps) {
  const { data: messages, isLoading } = useGetMessages(
    { tagId: tag.id, limit: 100 },
    { query: { enabled: !!tag.id, refetchInterval: 5000 } }
  );
  
  const sendMessageMutation = useSendMessage();
  const { data: me } = useGetMe();
  const qc = useQueryClient();

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !me) return;

    sendMessageMutation.mutate(
      { data: { tagId: tag.id, content: input.trim() } },
      {
        onSuccess: () => {
          setInput("");
          qc.invalidateQueries({ queryKey: getGetMessagesQueryKey({ tagId: tag.id }) });
        }
      }
    );
  };

  return (
    <div className="flex flex-col h-full w-full max-w-4xl mx-auto">
      {/* Header */}
      <div className="shrink-0 h-16 flex items-center px-6 md:px-8 border-b border-border/30 bg-background/50 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3 text-primary/80">
          <span className="text-xl">{tag.icon || "#"}</span>
          <span className="font-serif text-lg font-medium tracking-wide text-foreground">{tag.name}</span>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 custom-scrollbar" ref={scrollRef}>
        {isLoading && !messages ? (
          <div className="flex justify-center items-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !messages || messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground font-serif italic text-lg">
            A quiet space for scattered thoughts.
          </div>
        ) : (
          <div className="space-y-6 flex flex-col justify-end min-h-full">
            {messages.slice().reverse().map((msg, idx) => {
              const isMe = msg.authorId === me?.id;
              const showHeader = idx === 0 || messages.slice().reverse()[idx - 1].authorId !== msg.authorId;
              
              return (
                <div 
                  key={msg.id} 
                  className={`flex flex-col ${isMe ? "items-end" : "items-start"} max-w-[85%] ${isMe ? "self-end" : "self-start"}`}
                >
                  {showHeader && (
                    <div className="flex items-center gap-2 mb-1.5 px-2">
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
                        {msg.authorName}
                      </span>
                      <span className="text-[10px] text-muted-foreground/40 font-light">
                        {format(new Date(msg.createdAt), "h:mm a")}
                      </span>
                    </div>
                  )}
                  <div 
                    className={`
                      px-5 py-3 rounded-2xl text-[15px] leading-relaxed shadow-sm font-light
                      ${isMe 
                        ? "bg-primary text-primary-foreground rounded-tr-sm" 
                        : "bg-card border border-border text-foreground rounded-tl-sm"
                      }
                    `}
                  >
                    {msg.content}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} className="h-4" />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="shrink-0 p-4 md:p-6 bg-background/80 backdrop-blur-md border-t border-border/30">
        <form onSubmit={handleSend} className="relative max-w-3xl mx-auto flex items-end gap-3 bg-card border border-border rounded-3xl p-2 shadow-sm focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Whisper something..."
            className="flex-1 max-h-32 min-h-[44px] bg-transparent border-none resize-none focus:outline-none focus:ring-0 px-4 py-2.5 text-foreground placeholder:text-muted-foreground/50 font-light custom-scrollbar"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
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
              <Send size={18} className="stroke-[2} -ml-0.5" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
