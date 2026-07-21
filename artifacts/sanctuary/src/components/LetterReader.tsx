import { useRef, useEffect, useState } from "react";
import { useGetLetter, useReactToLetter, useDeleteLetter, getGetLetterQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { X, Loader2, Paperclip, Trash2 } from "lucide-react";
import { format } from "date-fns";

interface LetterReaderProps {
  letterId: number;
  onClose: () => void;
}

const EMOJI_OPTIONS = ["❤️", "✨", "🕯️", "☕", "🍂"];

export default function LetterReader({ letterId, onClose }: LetterReaderProps) {
  const { data: letter, isLoading } = useGetLetter(letterId);
  const reactMutation = useReactToLetter();
  const deleteMutation = useDeleteLetter();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

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
        // Invalidate the letters list for the parent postbox view
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

  if (isLoading || !letter) {
    return (
      <div className="absolute inset-0 z-50 bg-background flex justify-center items-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Parse blocks
  const contentData = letter.content as { blocks?: Array<{ id?: string, type: string, data: { text?: string } }> } | undefined;
  const blocks = contentData?.blocks || [];

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

        {/* Delete — two-step: first click shows confirm, second executes */}
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

          {/* Reactions */}
          <footer className="pt-12 flex flex-col items-center gap-6">
            <div className="h-px w-24 bg-border" />
            <div className="flex items-center gap-3 bg-muted/30 p-2 rounded-full border border-border/50">
              {EMOJI_OPTIONS.map(emoji => {
                const count = letter.reactions?.[emoji]?.length || 0;
                return (
                  <button
                    key={emoji}
                    onClick={() => handleReaction(emoji)}
                    className="group relative flex items-center justify-center w-12 h-12 rounded-full hover:bg-card border border-transparent hover:border-border transition-all"
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
          </footer>
        </article>
      </div>
    </div>
  );
}
