import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUpdateLetterTags, useGetTags, getGetLettersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Minus, Mail, Loader2 } from "lucide-react";

interface SelectedLetter {
  id: number;
  tagIds: number[];
}

interface ChannelPickerPopupProps {
  anchor: DOMRect;
  selectedLetters: SelectedLetter[];
  onClose: () => void;
}

export default function ChannelPickerPopup({ anchor, selectedLetters, onClose }: ChannelPickerPopupProps) {
  const { data: allTags } = useGetTags();
  const updateTagsMutation = useUpdateLetterTags();
  const qc = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);
  const [pendingTagId, setPendingTagId] = useState<number | null>(null);

  const postboxTags = (allTags ?? []).filter(t => t.type === "postbox");

  // Close on outside click or Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", handleKey);
    // slight delay so the open-click doesn't immediately close
    const t = setTimeout(() => window.addEventListener("mousedown", handleClick), 50);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("mousedown", handleClick);
      clearTimeout(t);
    };
  }, [onClose]);

  // Compute popup position so it stays on screen
  const POPUP_W = 220;
  const POPUP_H = 48 + postboxTags.length * 44; // approx
  const left = Math.min(anchor.left, window.innerWidth - POPUP_W - 12);
  const top = anchor.bottom + 6 + POPUP_H > window.innerHeight
    ? anchor.top - POPUP_H - 6
    : anchor.bottom + 6;

  const handleToggle = async (tagId: number) => {
    if (pendingTagId !== null) return;
    setPendingTagId(tagId);

    const allHave = selectedLetters.every(l => l.tagIds.includes(tagId));

    // Build new tagIds for each letter
    const updates = selectedLetters.map(letter => {
      let next: number[];
      if (allHave) {
        // remove — keep at least 1
        next = letter.tagIds.filter(id => id !== tagId);
        if (next.length === 0) next = letter.tagIds; // guard: can't remove last
      } else {
        // add
        next = letter.tagIds.includes(tagId) ? letter.tagIds : [...letter.tagIds, tagId];
      }
      return { letterId: letter.id, tagIds: next };
    });

    // Fire mutations sequentially (small N, usually ≤ 20)
    for (const { letterId, tagIds } of updates) {
      await updateTagsMutation.mutateAsync({ letterId, data: { tagIds } });
    }

    // Invalidate all postbox tag letter lists
    postboxTags.forEach(t => {
      qc.invalidateQueries({ queryKey: getGetLettersQueryKey({ tagId: t.id }) });
    });

    setPendingTagId(null);
  };

  const popup = (
    <div
      ref={ref}
      style={{ position: "fixed", top, left, width: POPUP_W, zIndex: 9999 }}
      className="bg-card border border-border rounded-xl shadow-2xl shadow-black/40 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
    >
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border/50">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {selectedLetters.length > 1
            ? `Change channels · ${selectedLetters.length} letters`
            : "Change channel"}
        </p>
      </div>

      {/* Tag list */}
      <ul className="py-1">
        {postboxTags.map(tag => {
          const allHave  = selectedLetters.every(l => l.tagIds.includes(tag.id));
          const someHave = selectedLetters.some(l => l.tagIds.includes(tag.id));
          const isIndeterminate = !allHave && someHave;
          const isPending = pendingTagId === tag.id;

          return (
            <li key={tag.id}>
              <button
                onClick={() => handleToggle(tag.id)}
                disabled={pendingTagId !== null}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors disabled:opacity-60 text-left"
              >
                {/* Checkbox */}
                <span className={`w-4 h-4 flex items-center justify-center rounded border transition-all shrink-0 ${
                  allHave
                    ? "bg-primary border-primary"
                    : isIndeterminate
                      ? "bg-primary/30 border-primary/60"
                      : "border-border bg-transparent"
                }`}>
                  {isPending
                    ? <Loader2 size={10} className="animate-spin text-primary" />
                    : allHave
                      ? <Check size={10} strokeWidth={3} className="text-primary-foreground" />
                      : isIndeterminate
                        ? <Minus size={10} strokeWidth={3} className="text-primary" />
                        : null
                  }
                </span>

                {/* Channel label */}
                <span className="flex items-center gap-2 min-w-0">
                  {tag.icon
                    ? <span className="text-base leading-none">{tag.icon}</span>
                    : <Mail size={14} className="text-muted-foreground shrink-0" />
                  }
                  <span className="truncate font-medium">{tag.name}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return createPortal(popup, document.body);
}
