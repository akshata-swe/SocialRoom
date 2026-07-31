import { useState, useRef, useEffect } from "react";
import { useGetLetters, useDeleteLetter, useGetMe, getGetLettersQueryKey, Tag, LetterSummary } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, PenTool, Mail, Paperclip, Trash2, MoreHorizontal, Tags, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import ChannelPickerPopup from "./ChannelPickerPopup";

interface PostboxViewProps {
  tag: Tag;
  onReadLetter: (id: number) => void;
  onNewLetter: () => void;
}

export default function PostboxView({ tag, onReadLetter, onNewLetter }: PostboxViewProps) {
  const qc = useQueryClient();
  const { data: letters, isLoading } = useGetLetters(
    { tagId: tag.id },
    { query: { enabled: !!tag.id } }
  );
  const deleteMutation = useDeleteLetter();
  const { data: me } = useGetMe();

  // ── State ─────────────────────────────────────────────────────────────────
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [menuOpenId, setMenuOpenId]           = useState<number | null>(null);
  const [menuAnchor, setMenuAnchor]           = useState<DOMRect | null>(null);
  const [selectedIds, setSelectedIds]         = useState<Set<number>>(new Set());
  const [pickerAnchor, setPickerAnchor]       = useState<DOMRect | null>(null);
  const [pickerLetterIds, setPickerLetterIds] = useState<number[]>([]);

  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close three-dot menu on outside click
  useEffect(() => {
    if (!menuOpenId) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    const t = setTimeout(() => window.addEventListener("mousedown", handler), 50);
    return () => { window.removeEventListener("mousedown", handler); clearTimeout(t); };
  }, [menuOpenId]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleDeleteClick = (e: React.MouseEvent, letterId: number) => {
    e.stopPropagation();
    if (confirmDeleteId === letterId) {
      deleteMutation.mutate({ letterId }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetLettersQueryKey({ tagId: tag.id }) });
          setConfirmDeleteId(null);
          setMenuOpenId(null);
        },
      });
    } else {
      setConfirmDeleteId(letterId);
    }
  };

  const toggleSelect = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setMenuOpenId(null);
    setConfirmDeleteId(null);
  };

  const openMenuForCard = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuOpenId(id);
    setMenuAnchor(rect);
    setConfirmDeleteId(null);
  };

  const openPickerForCard = (letterId: number) => {
    setMenuOpenId(null);
    // anchor picker to the card's menu button rect, fall back to centre
    const el = document.querySelector(`[data-menu-btn="${letterId}"]`);
    const rect = el?.getBoundingClientRect() ?? new DOMRect(window.innerWidth / 2, 200, 0, 0);
    setPickerLetterIds([letterId]);
    setPickerAnchor(rect);
  };

  const openPickerForSelection = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPickerLetterIds([...selectedIds]);
    setPickerAnchor(rect);
  };

  const pickerLetters: LetterSummary[] = (letters ?? []).filter(l => pickerLetterIds.includes(l.id));

  const isSelecting = selectedIds.size > 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="h-full flex flex-col w-full max-w-6xl mx-auto"
      onClick={() => { setConfirmDeleteId(null); setMenuOpenId(null); }}
    >
      {/* Header */}
      <div className="shrink-0 px-4 py-5 md:px-8 md:py-10 flex flex-row items-center justify-between gap-3 border-b border-border/30">
        <div className="space-y-1 md:space-y-2 min-w-0">
          <div className="flex items-center gap-2 text-primary/80">
            {tag.icon ? <span className="text-xl md:text-2xl">{tag.icon}</span> : <Mail size={20} className="stroke-1" />}
            <span className="font-medium tracking-widest text-xs uppercase truncate">{tag.slug}</span>
          </div>
          <h2 className="font-serif text-2xl md:text-3xl lg:text-4xl font-medium tracking-tight text-foreground truncate">{tag.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          {isSelecting && (
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-full border border-border hover:border-muted-foreground/50"
            >
              Deselect all
            </button>
          )}
          {!(tag.isAdminOnly && !me?.isAdmin) && (
            <button
              onClick={onNewLetter}
              className="shrink-0 flex items-center gap-2 bg-primary text-primary-foreground px-4 md:px-5 py-2 md:py-2.5 rounded-full font-medium hover:bg-primary/90 transition-all hover-elevate shadow-md hover:shadow-primary/20 text-sm md:text-base"
              data-testid="button-new-letter"
            >
              <PenTool size={16} className="stroke-[1.5] md:hidden" />
              <PenTool size={18} className="stroke-[1.5] hidden md:block" />
              <span>Write</span>
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-10 custom-scrollbar">
        {isLoading ? (
          <div className="flex justify-center items-center h-40 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : !letters || letters.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-card border border-border flex items-center justify-center opacity-50">
              <Mail size={24} className="stroke-1 text-muted-foreground" />
            </div>
            <p className="font-serif text-xl md:text-2xl text-muted-foreground font-medium">The postbox awaits your first letter.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {letters.map((letter) => {
              const isMyLetter   = letter.authorId === me?.id;
              const isConfirming = confirmDeleteId === letter.id;
              const isSelected   = selectedIds.has(letter.id);
              const isMenuOpen   = menuOpenId === letter.id;

              return (
                <div
                  key={letter.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => { if (!isSelecting) onReadLetter(letter.id); else toggleSelect({ stopPropagation: () => {} } as React.MouseEvent, letter.id); }}
                  onKeyDown={(e) => e.key === "Enter" && !isSelecting && onReadLetter(letter.id)}
                  className={`group relative text-left bg-card border rounded-xl p-4 md:p-6 min-h-[160px] md:h-56 flex flex-col justify-between transition-all duration-300 hover-elevate shadow-sm cursor-pointer ${
                    isSelected
                      ? "border-primary/60 ring-1 ring-primary/30 bg-primary/5"
                      : "border-card-border hover:border-primary/30"
                  }`}
                  data-testid={`letter-card-${letter.id}`}
                >
                  {/* ── Top-left: select checkbox ── */}
                  <button
                    onClick={(e) => toggleSelect(e, letter.id)}
                    className={`absolute top-3 left-3 z-10 w-6 h-6 flex items-center justify-center rounded-full transition-all duration-200 ${
                      isSelected
                        ? "opacity-100 bg-primary text-primary-foreground"
                        : "opacity-0 group-hover:opacity-100 bg-card border border-border text-muted-foreground hover:border-primary hover:text-primary"
                    }`}
                    title={isSelected ? "Deselect" : "Select"}
                    aria-label={isSelected ? "Deselect letter" : "Select letter"}
                  >
                    {isSelected
                      ? <CheckCircle2 size={14} strokeWidth={2} className="fill-primary-foreground stroke-primary-foreground" />
                      : <CheckCircle2 size={14} strokeWidth={1.5} />
                    }
                  </button>

                  {/* ── Top-right: unread dot + three-dot menu ── */}
                  {!letter.isRead && !isSelected && !isMenuOpen && (
                    <div className="absolute top-3 right-3 w-2.5 h-2.5 bg-primary rounded-full shadow-[0_0_8px_rgba(var(--color-primary),0.8)] group-hover:opacity-0 transition-opacity pointer-events-none" />
                  )}

                  {!isSelecting && (
                    <div className="absolute top-2 right-2 z-10">
                      <button
                        data-menu-btn={letter.id}
                        onClick={(e) => openMenuForCard(e, letter.id)}
                        className={`w-7 h-7 flex items-center justify-center rounded-full transition-all duration-200 ${
                          isMenuOpen
                            ? "opacity-100 bg-muted text-foreground"
                            : "opacity-0 group-hover:opacity-100 bg-card border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                        title="More options"
                        aria-label="More options"
                      >
                        <MoreHorizontal size={14} strokeWidth={2} />
                      </button>

                      {/* Dropdown menu */}
                      {isMenuOpen && menuAnchor && (
                        <div
                          ref={menuRef}
                          style={{
                            position: "fixed",
                            top: menuAnchor.bottom + 4,
                            left: Math.min(menuAnchor.right - 160, window.innerWidth - 172),
                            width: 160,
                            zIndex: 9999,
                          }}
                          className="bg-card border border-border rounded-xl shadow-2xl shadow-black/40 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => openPickerForCard(letter.id)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors"
                          >
                            <Tags size={14} className="text-muted-foreground" />
                            Change channels
                          </button>

                          {me?.isAdmin && isMyLetter && (
                            <button
                              onClick={(e) => handleDeleteClick(e, letter.id)}
                              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                                isConfirming
                                  ? "text-destructive bg-destructive/10"
                                  : "text-muted-foreground hover:text-destructive hover:bg-destructive/5"
                              }`}
                            >
                              <Trash2 size={14} />
                              {isConfirming ? "Confirm delete?" : "Delete letter"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Body ── */}
                  <div className="space-y-4 mt-4">
                    <h3 className="font-serif text-xl font-medium text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                      {letter.title || <span className="text-muted-foreground/50 italic font-light">untitled</span>}
                    </h3>
                    {letter.excerpt && (
                      <p className="text-muted-foreground text-sm line-clamp-3 font-light leading-relaxed">
                        {letter.excerpt}
                      </p>
                    )}
                  </div>

                  {/* ── Footer ── */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground/70 font-medium tracking-wide mt-auto pt-4 border-t border-border/50">
                    <span className="truncate max-w-[120px]">{letter.authorName}</span>
                    <div className="flex items-center gap-3">
                      {letter.hasAttachments && <Paperclip size={14} />}
                      <time dateTime={letter.createdAt}>{format(new Date(letter.createdAt), 'MMM d, yyyy')}</time>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Bulk action bar ── */}
      {isSelecting && (
        <div className="shrink-0 border-t border-border/30 px-4 py-3 md:px-8 md:py-4 bg-card/80 backdrop-blur-md flex items-center justify-between gap-4 animate-in slide-in-from-bottom-2 duration-200">
          <span className="text-sm font-medium text-foreground">
            {selectedIds.size} {selectedIds.size === 1 ? "letter" : "letters"} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={openPickerForSelection}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all"
            >
              <Tags size={14} />
              Change channels
            </button>
          </div>
        </div>
      )}

      {/* ── Channel picker popup ── */}
      {pickerAnchor && pickerLetters.length > 0 && (
        <ChannelPickerPopup
          anchor={pickerAnchor}
          selectedLetters={pickerLetters}
          onClose={() => { setPickerAnchor(null); setPickerLetterIds([]); }}
        />
      )}
    </div>
  );
}
