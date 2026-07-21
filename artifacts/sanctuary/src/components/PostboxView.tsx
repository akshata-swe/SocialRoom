import { useGetLetters, Tag } from "@workspace/api-client-react";
import { Loader2, PenTool, Mail, Paperclip } from "lucide-react";
import { format } from "date-fns";

interface PostboxViewProps {
  tag: Tag;
  onReadLetter: (id: number) => void;
  onNewLetter: () => void;
}

export default function PostboxView({ tag, onReadLetter, onNewLetter }: PostboxViewProps) {
  const { data: letters, isLoading } = useGetLetters(
    { tagId: tag.id },
    { query: { enabled: !!tag.id } }
  );

  return (
    <div className="h-full flex flex-col w-full max-w-6xl mx-auto">
      {/* Header */}
      <div className="shrink-0 px-8 py-10 flex items-end justify-between border-b border-border/30">
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-primary/80">
            {tag.icon ? <span className="text-2xl">{tag.icon}</span> : <Mail size={24} className="stroke-1" />}
            <span className="font-medium tracking-widest text-xs uppercase">{tag.slug}</span>
          </div>
          <h2 className="font-serif text-3xl md:text-4xl font-medium tracking-tight text-foreground">{tag.name}</h2>
        </div>
        <button 
          onClick={onNewLetter}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-full font-medium hover:bg-primary/90 transition-all hover-elevate shadow-md hover:shadow-primary/20"
          data-testid="button-new-letter"
        >
          <PenTool size={18} className="stroke-[1.5]" />
          <span>Write</span>
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-8 py-10 custom-scrollbar">
        {isLoading ? (
          <div className="flex justify-center items-center h-40 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : !letters || letters.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-card border border-border flex items-center justify-center opacity-50">
              <Mail size={24} className="stroke-1 text-muted-foreground" />
            </div>
            <p className="font-serif text-2xl text-muted-foreground font-medium">The postbox awaits your first letter.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {letters.map((letter) => (
              <button
                key={letter.id}
                onClick={() => onReadLetter(letter.id)}
                className="group relative text-left bg-card border border-card-border rounded-xl p-6 h-56 flex flex-col justify-between transition-all duration-300 hover-elevate hover:border-primary/30 shadow-sm"
                data-testid={`letter-card-${letter.id}`}
              >
                {!letter.isRead && (
                  <div className="absolute top-4 right-4 w-3 h-3 bg-primary rounded-full shadow-[0_0_8px_rgba(var(--color-primary),0.8)]" />
                )}
                
                <div className="space-y-4">
                  <h3 className="font-serif text-xl font-medium text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                    {letter.title}
                  </h3>
                  {letter.excerpt && (
                    <p className="text-muted-foreground text-sm line-clamp-3 font-light leading-relaxed">
                      {letter.excerpt}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground/70 font-medium tracking-wide mt-auto pt-4 border-t border-border/50">
                  <span className="truncate max-w-[120px]">{letter.authorName}</span>
                  <div className="flex items-center gap-3">
                    {letter.hasAttachments && <Paperclip size={14} />}
                    <time dateTime={letter.createdAt}>{format(new Date(letter.createdAt), 'MMM d, yyyy')}</time>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
