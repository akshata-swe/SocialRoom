import { useRef, useEffect, useState, lazy, Suspense } from "react";
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
import { X, Loader2, Paperclip, Trash2, Send, Smile } from "lucide-react";
import { format } from "date-fns";


const EmojiPickerPopup = lazy(() => import("./EmojiPickerPopup"));

interface LetterReaderProps {
  letterId: number;
  onClose: () => void;
}


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
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
  const [commentPickerAnchor, setCommentPickerAnchor] = useState<DOMRect | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);

  const insertCommentEmoji = (emoji: string) => {
    const el = commentInputRef.current;
    if (!el) { setCommentText(prev => prev + emoji); return; }
    const start = el.selectionStart ?? commentText.length;
    const end   = el.selectionEnd   ?? commentText.length;
    const next  = commentText.slice(0, start) + emoji + commentText.slice(end);
    setCommentText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  };

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
      <div className="min-h-full flex flex-col max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-16 relative">
        {/* Close */}
        <button
          onClick={onClose}
          className="fixed top-4 md:top-8 right-4 md:right-8 p-2.5 md:p-3 rounded-full bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-300 z-10"
          data-testid="button-close-reader"
        >
          <X size={18} className="stroke-[1.5] md:hidden" />
          <X size={20} className="stroke-[1.5] hidden md:block" />
        </button>

        {/* Delete — admin's own letters only */}
        {me?.isAdmin && letter.authorId === me?.id && (
          <button
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className={`fixed top-4 md:top-8 right-16 md:right-24 z-10 flex items-center gap-2 px-3 md:px-4 py-2.5 md:py-3 rounded-full border transition-all duration-200
              ${confirmDelete
                ? "bg-destructive text-destructive-foreground border-destructive shadow-lg"
                : "bg-card border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 hover:bg-destructive/5"
              }`}
            title={confirmDelete ? "Click again to permanently delete" : "Delete this letter"}
          >
            <Trash2 size={15} strokeWidth={1.5} />
            {confirmDelete && <span className="text-sm font-medium">Delete?</span>}
          </button>
        )}

        <article className="bg-card border border-card-border rounded-2xl p-5 md:p-10 lg:p-16 shadow-2xl space-y-8 md:space-y-12 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-50" />

          {/* Header */}
          <header className="space-y-4 md:space-y-6 text-center border-b border-border/50 pb-6 md:pb-12">
            {letter.title ? (
              <h1 className="font-serif text-2xl md:text-4xl lg:text-5xl font-medium tracking-tight text-foreground leading-tight">
                {letter.title}
              </h1>
            ) : null}
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

          {/* Deliver to — reassign channel(s) */}
          {postboxTags.length > 0 && (
            <div className="pt-8 border-t border-border/50 space-y-3">
              <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Deliver to</h3>
              <div className="flex flex-wrap gap-3">
                {postboxTags.map(tag => {
                  const isSelected = selectedTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      onClick={() => handleToggleTag(tag.id)}
                      disabled={updateTagsMutation.isPending}
                      className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm transition-all duration-200 disabled:opacity-60
                        ${isSelected
                          ? "bg-primary/10 border-primary text-primary shadow-[0_0_10px_rgba(var(--color-primary),0.1)]"
                          : "bg-card border-border text-muted-foreground hover:border-muted-foreground/50"
                        }`}
                    >
                      <span>{tag.icon || <Mail size={14} />}</span>
                      <span className="font-medium">{tag.name}</span>
                      {isSelected && updateTagsMutation.isPending && (
                        <Loader2 size={12} className="animate-spin" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Reactions + Comments */}
          <footer className="pt-6 md:pt-12 flex flex-col items-center gap-8 md:gap-10">
            <div className="h-px w-24 bg-border" />

            {/* Emoji reactions */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              {/* Active reaction pills */}
              {Object.entries((letter.reactions ?? {}) as Record<string, string[]>)
                .filter(([, users]) => users.length > 0)
                .map(([emoji, users]) => {
                  const iMine = users.includes(myUserId);
                  return (
                    <button
                      key={emoji}
                      onClick={() => handleReaction(emoji)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                        iMine
                          ? "bg-primary/20 border-primary/40 text-foreground scale-105"
                          : "bg-muted/40 border-border/40 text-foreground/70 hover:bg-primary/10 hover:border-primary/30"
                      }`}
                    >
                      <span className="text-lg leading-none">{emoji}</span>
                      <span className="text-xs font-medium">{users.length}</span>
                    </button>
                  );
                })}

              {/* Add reaction button */}
              <button
                onClick={(e) =>
                  setPickerAnchor(
                    pickerAnchor ? null : (e.currentTarget as HTMLElement).getBoundingClientRect(),
                  )
                }
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  pickerAnchor
                    ? "bg-primary/20 border-primary/40 text-primary"
                    : "bg-muted/30 border-border/50 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
                title="Add reaction"
              >
                <Smile size={15} />
                <span className="text-xs">React</span>
              </button>

              {pickerAnchor && (
                <Suspense fallback={null}>
                  <EmojiPickerPopup
                    anchor={pickerAnchor}
                    onSelect={handleReaction}
                    onClose={() => setPickerAnchor(null)}
                  />
                </Suspense>
              )}
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
              <form onSubmit={handleComment} className="flex items-end gap-1 bg-muted/20 border border-border/40 rounded-2xl px-2 py-2 focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
                {/* Emoji button */}
                <button
                  type="button"
                  onClick={(e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setCommentPickerAnchor(prev => (prev ? null : rect));
                    setPickerAnchor(null);
                  }}
                  className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-full transition-all mb-0.5 ${
                    commentPickerAnchor
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground/40 hover:text-foreground hover:bg-muted"
                  }`}
                  title="Emoji"
                >
                  <Smile size={15} />
                </button>

                <textarea
                  ref={commentInputRef}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Write a note…"
                  className="flex-1 bg-transparent border-none resize-none focus:outline-none focus:ring-0 text-[14px] text-foreground placeholder:text-muted-foreground/40 font-light min-h-[40px] max-h-32 custom-scrollbar px-1"
                  rows={1}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && commentPickerAnchor) { e.preventDefault(); setCommentPickerAnchor(null); return; }
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleComment(e as unknown as React.FormEvent); }
                  }}
                />
                <button
                  type="submit"
                  disabled={!commentText.trim() || commentMutation.isPending}
                  className="shrink-0 p-2.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-all mb-0.5"
                >
                  {commentMutation.isPending
                    ? <Loader2 size={15} className="animate-spin" />
                    : <Send size={15} />
                  }
                </button>
              </form>

              {/* Comment input emoji picker portal */}
              {commentPickerAnchor && (
                <Suspense fallback={null}>
                  <EmojiPickerPopup
                    anchor={commentPickerAnchor}
                    onSelect={(emoji) => {
                      insertCommentEmoji(emoji);
                      setCommentPickerAnchor(null);
                    }}
                    onClose={() => setCommentPickerAnchor(null)}
                  />
                </Suspense>
              )}
            </div>
          </footer>
        </article>
      </div>
    </div>
  );
}
