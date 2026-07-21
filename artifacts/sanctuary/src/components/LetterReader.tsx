import { useRef, useEffect, useState } from "react";
import {
  useGetLetter,
  useReactToLetter,
  useDeleteLetter,
  useGetMe,
  useGetLetterComments,
  useAddLetterComment,
  getGetLetterQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { X, Loader2, Paperclip, Trash2, Send } from "lucide-react";
import { format } from "date-fns";

interface LetterReaderProps {
  letterId: number;
  onClose: () => void;
}

const EMOJI_OPTIONS = ["❤️", "✨", "🕯️", "☕", "🍂"];

export default function LetterReader({ letterId, onClose }: LetterReaderProps) {
  const { data: letter, isLoading } = useGetLetter(letterId);
  const { data: me } = useGetMe();
  const { data: comments = [], refetch: refetchComments } = useGetLetterComments(letterId);
  const reactMutation = useReactToLetter();
  const deleteMutation = useDeleteLetter();
  const commentMutation = useAddLetterComment();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [commentText, setCommentText] = useState("");

  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (confirmDelete) { setConfirmDelete(false); return; }
        onClose();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose, confirmDelete]);

  const handleDelete = () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    deleteMutation.mutate({ letterId }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["letters"] });
        onClose();
      },
    });
  };

  const handleReaction = (emoji: string) => {
    reactMutation.mutate(
      { letterId, data: { emoji } },
      {
        onSuccess: (updatedLetter) => {
          qc.setQueryData(getGetLetterQueryKey(letterId), updatedLetter);
        }
      }
    );
  };

  const handleComment = (e: React.FormEvent) => {
    e.preventDefault();
    const text = commentText.trim();
    if (!text) return;
    commentMutation.mutate(
      { letterId, data: { content: text } },
      {
        onSuccess: () => {
          setCommentText("");
          refetchComments();
        },
      },
    );
  };

  if (isLoading || !letter) {
    return (
      <div className="absolute inset-0 z-50 bg-background flex justify-center items-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const contentData = letter.content as { blocks?: Array<{ id?: string, type: string, data: { text?: string } }> } | undefined;
  const blocks = contentData?.blocks || [];
  const myUserId = me?.id ?? "";

  return (
    <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-y-auto custom-scrollbar animate-in fade-in duration-500">
      <div className="min-h-full flex flex-col max-w-3xl mx-auto px-6 py-12 md:py-24 relative">
        {/* Close */}
        <button
          onClick={onClose}
          className="fixed top-8 right-8 p-3 rounded-full bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-300 z-10"
          data-testid="button-close-reader"
        >
          <X size={20} className="stroke-[1.5]" />
        </button>

        {/* Delete — own letters only */}
        {letter.authorId === me?.id && (
          <button
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className={`fixed top-8 right-24 z-10 flex items-center gap-2 px-4 py-3 rounded-full border transition-all duration-200
              ${confirmDelete
                ? "bg-destructive text-destructive-foreground border-destructive shadow-lg"
                : "bg-card border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 hover:bg-destructive/5"
              }`}
            title={confirmDelete ? "Click again to permanently delete" : "Delete this letter"}
          >
            <Trash2 size={16} strokeWidth={1.5} />
            {confirmDelete && <span className="text-sm font-medium">Delete?</span>}
          </button>
        )}

        <article className="bg-card border border-card-border rounded-2xl p-8 md:p-16 shadow-2xl space-y-12 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-50" />

          {/* Header */}
          <header className="space-y-6 text-center border-b border-border/50 pb-12">
            <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl font-medium tracking-tight text-foreground leading-tight">
              {letter.title}
            </h1>
            <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground font-light tracking-wide uppercase">
              <span>{letter.authorName}</span>
              <span className="w-1 h-1 rounded-full bg-primary/50" />
              <time dateTime={letter.createdAt}>{format(new Date(letter.createdAt), "MMMM d, yyyy")}</time>
            </div>
          </header>

          {/* Body */}
          <div className="prose prose-invert prose-lg md:prose-xl max-w-none font-serif text-foreground/90 leading-relaxed font-light" ref={contentRef}>
            {blocks.map((block, idx) => {
              if (block.type === "paragraph") {
                return <p key={block.id || idx} dangerouslySetInnerHTML={{ __html: block.data.text || "" }} />;
              }
              return null;
            })}
          </div>

          {/* Attachments */}
          {letter.attachments && letter.attachments.length > 0 && (
            <div className="pt-8 border-t border-border/50">
              <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-4">Enclosures</h3>
              <div className="flex flex-wrap gap-4">
                {letter.attachments.map((att) => (
                  <a
                    key={att.id}
                    href={att.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 px-4 py-2 bg-muted/50 rounded-lg border border-border hover:bg-primary/10 hover:border-primary/30 transition-colors text-sm font-medium text-foreground"
                  >
                    <Paperclip size={16} className="text-muted-foreground" />
                    <span>{att.filename}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Reactions + Comments */}
          <footer className="pt-12 flex flex-col items-center gap-10">
            <div className="h-px w-24 bg-border" />

            {/* Emoji reactions */}
            <div className="flex items-center gap-3 bg-muted/30 p-2 rounded-full border border-border/50">
              {EMOJI_OPTIONS.map(emoji => {
                const users = letter.reactions?.[emoji] ?? [];
                const count = users.length;
                const iMine = users.includes(myUserId);
                return (
                  <button
                    key={emoji}
                    onClick={() => handleReaction(emoji)}
                    className={`group relative flex items-center justify-center w-12 h-12 rounded-full border transition-all ${
                      iMine
                        ? "bg-primary/20 border-primary/40 scale-110"
                        : "border-transparent hover:bg-card hover:border-border"
                    }`}
                  >
                    <span className="text-2xl group-hover:scale-110 transition-transform">{emoji}</span>
                    {count > 0 && (
                      <span className="absolute -bottom-1 -right-1 bg-primary text-primary-foreground text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full shadow-sm">
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Comments section */}
            <div className="w-full space-y-6">
              <h3 className="text-xs font-medium uppercase tracking-widest text-muted-foreground text-center">
                {comments.length === 0 ? "Leave a note" : `${comments.length} note${comments.length === 1 ? "" : "s"}`}
              </h3>

              {/* Existing comments */}
              {comments.length > 0 && (
                <div className="space-y-4">
                  {comments.map((c) => (
                    <div key={c.id} className="flex flex-col gap-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-medium text-foreground/70 tracking-wide">{c.authorName}</span>
                        <span className="text-[10px] text-muted-foreground/40 font-light">
                          {format(new Date(c.createdAt), "MMM d, yyyy")}
                        </span>
                      </div>
                      <p className="text-[15px] leading-relaxed text-foreground/80 font-light bg-muted/30 rounded-xl px-4 py-3 border border-border/30">
                        {c.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Comment input */}
              <form onSubmit={handleComment} className="flex items-end gap-3 bg-muted/20 border border-border/40 rounded-2xl p-3 focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Write a note…"
                  className="flex-1 bg-transparent border-none resize-none focus:outline-none focus:ring-0 text-[14px] text-foreground placeholder:text-muted-foreground/40 font-light min-h-[40px] max-h-32 custom-scrollbar"
                  rows={1}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleComment(e as unknown as React.FormEvent); }
                  }}
                />
                <button
                  type="submit"
                  disabled={!commentText.trim() || commentMutation.isPending}
                  className="shrink-0 p-2.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-all"
                >
                  {commentMutation.isPending
                    ? <Loader2 size={15} className="animate-spin" />
                    : <Send size={15} />
                  }
                </button>
              </form>
            </div>
          </footer>
        </article>
      </div>
    </div>
  );
}
