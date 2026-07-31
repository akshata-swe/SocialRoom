import { useState, useRef, lazy, Suspense } from "react";
import { useCreateLetter, useGetTags, useGetMe, getGetLettersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { X, Send, Loader2, Mail, Smile } from "lucide-react";

const EmojiPickerPopup = lazy(() => import("./EmojiPickerPopup"));

interface LetterComposerProps {
  onClose: () => void;
  initialTagId?: number;
}

export default function LetterComposer({ onClose, initialTagId }: LetterComposerProps) {
  const [title, setTitle]   = useState("");
  const [content, setContent] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>(initialTagId ? [initialTagId] : []);

  const titleRef   = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  // Emoji picker — one picker shared between title and content fields
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
  // Which field the picker is targeting
  const pickerTarget = useRef<"title" | "content">("content");

  const { data: tags } = useGetTags();
  const { data: me }   = useGetMe();
  const createLetterMutation = useCreateLetter();
  const qc = useQueryClient();

  const postboxTags = tags?.filter(t => t.type === "postbox") || [];

  const selectedTags  = (tags ?? []).filter(t => selectedTagIds.includes(t.id));
  const isWelcomeNotes =
    selectedTags.length > 0 && selectedTags.every(t => t.slug === "welcome-notes");

  const handleToggleTag = (tagId: number) => {
    setSelectedTagIds(prev =>
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    );
  };

  // ── Emoji insertion ──────────────────────────────────────────────────────

  const insertEmoji = (emoji: string) => {
    if (pickerTarget.current === "title") {
      const el = titleRef.current;
      if (!el) { setTitle(prev => prev + emoji); return; }
      const start = el.selectionStart ?? title.length;
      const end   = el.selectionEnd   ?? title.length;
      const next  = title.slice(0, start) + emoji + title.slice(end);
      setTitle(next);
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + emoji.length;
        el.setSelectionRange(pos, pos);
      });
    } else {
      const el = contentRef.current;
      if (!el) { setContent(prev => prev + emoji); return; }
      const start = el.selectionStart ?? content.length;
      const end   = el.selectionEnd   ?? content.length;
      const next  = content.slice(0, start) + emoji + content.slice(end);
      setContent(next);
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + emoji.length;
        el.setSelectionRange(pos, pos);
      });
    }
  };

  const openPicker = (target: "title" | "content", e: React.MouseEvent) => {
    pickerTarget.current = target;
    setPickerAnchor(prev =>
      prev ? null : (e.currentTarget as HTMLElement).getBoundingClientRect()
    );
  };

  // ── Publish ───────────────────────────────────────────────────────────────

  const handlePublish = () => {
    const titleOk = isWelcomeNotes ? true : !!title.trim();
    if (!titleOk || !content.trim() || selectedTagIds.length === 0 || !me) return;

    const blockContent = {
      blocks: [
        {
          id: crypto.randomUUID(),
          type: "paragraph",
          data: { text: content.replace(/\n/g, "<br>") }
        }
      ]
    };

    createLetterMutation.mutate(
      {
        data: {
          title: title.trim(),
          content: blockContent,
          tagIds: selectedTagIds,
        }
      },
      {
        onSuccess: () => {
          selectedTagIds.forEach(id => {
            qc.invalidateQueries({ queryKey: getGetLettersQueryKey({ tagId: id }) });
          });
          onClose();
        }
      }
    );
  };

  return (
    <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-y-auto custom-scrollbar animate-in slide-in-from-bottom-8 duration-500 flex flex-col">
      {/* Top Bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-background/80 backdrop-blur-md border-b border-border/50">
        <button
          onClick={onClose}
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full transition-colors"
          data-testid="button-close-composer"
        >
          <X size={20} className="stroke-[1.5]" />
        </button>

        <button
          onClick={handlePublish}
          disabled={(isWelcomeNotes ? false : !title.trim()) || !content.trim() || selectedTagIds.length === 0 || createLetterMutation.isPending}
          className="flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-full font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          data-testid="button-publish-letter"
        >
          {createLetterMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} className="stroke-[1.5]" />}
          <span>Seal & Send</span>
        </button>
      </div>

      <div className="flex-1 w-full max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-12 flex flex-col gap-6 md:gap-8">

        {/* Title row */}
        <div className="relative group flex items-center gap-2">
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={isWelcomeNotes ? "A title… (optional)" : "A title for this letter..."}
            className="flex-1 bg-transparent border-none text-3xl md:text-5xl font-serif font-medium text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-0 px-0"
          />
          {/* Emoji button for title */}
          <button
            type="button"
            onClick={(e) => openPicker("title", e)}
            className={`shrink-0 p-1.5 rounded-full transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 ${
              pickerAnchor && pickerTarget.current === "title"
                ? "bg-primary/20 text-primary opacity-100"
                : "text-muted-foreground/40 hover:text-foreground hover:bg-muted"
            }`}
            title="Insert emoji into title"
          >
            <Smile size={18} />
          </button>
        </div>

        {/* Content area */}
        <div className="relative flex-1 group">
          <textarea
            ref={contentRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write your thoughts..."
            className="w-full bg-transparent border-none resize-none text-base md:text-xl font-serif text-foreground/90 font-light leading-relaxed placeholder:text-muted-foreground/30 focus:outline-none focus:ring-0 px-0 min-h-[240px] md:min-h-[300px]"
          />
          {/* Floating emoji button anchored to bottom-right of content area */}
          <button
            type="button"
            onClick={(e) => openPicker("content", e)}
            className={`absolute bottom-2 right-0 p-2 rounded-full transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 ${
              pickerAnchor && pickerTarget.current === "content"
                ? "bg-primary/20 text-primary opacity-100"
                : "text-muted-foreground/40 hover:text-foreground hover:bg-muted"
            }`}
            title="Insert emoji"
          >
            <Smile size={18} />
          </button>
        </div>

        {/* Footer Configuration */}
        <div className="mt-auto pt-8 border-t border-border/50 space-y-8">
          <div className="space-y-3">
            <span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Deliver to</span>
            <div className="flex flex-wrap gap-3">
              {postboxTags.map(tag => {
                const isSelected = selectedTagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => handleToggleTag(tag.id)}
                    className={`
                      flex items-center gap-2 px-4 py-2 rounded-full border text-sm transition-all duration-200
                      ${isSelected
                        ? "bg-primary/10 border-primary text-primary shadow-[0_0_10px_rgba(var(--color-primary),0.1)]"
                        : "bg-card border-border text-muted-foreground hover:border-muted-foreground/50"
                      }
                    `}
                  >
                    <span>{tag.icon ? tag.icon : <Mail size={16} />}</span>
                    <span className="font-medium">{tag.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Emoji picker portal */}
      {pickerAnchor && (
        <Suspense fallback={null}>
          <EmojiPickerPopup
            anchor={pickerAnchor}
            onSelect={(emoji) => {
              insertEmoji(emoji);
              setPickerAnchor(null);
            }}
            onClose={() => setPickerAnchor(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
