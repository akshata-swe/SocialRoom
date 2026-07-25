import { useState, useRef } from "react";
import { useCreateLetter, useGetTags, useGetMe, getGetLettersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { X, Send, Loader2, Paperclip, Mail } from "lucide-react";

interface LetterComposerProps {
  onClose: () => void;
  initialTagId?: number;
}

interface Attachment {
  url: string;
  filename: string;
  mimeType: string;
  size: number;
}

export default function LetterComposer({ onClose, initialTagId }: LetterComposerProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>(initialTagId ? [initialTagId] : []);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const { data: tags } = useGetTags();
  const { data: me } = useGetMe();
  const createLetterMutation = useCreateLetter();
  const qc = useQueryClient();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const postboxTags = tags?.filter(t => t.type === "postbox") || [];

  const handleToggleTag = (tagId: number) => {
    setSelectedTagIds(prev => 
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setAttachments(prev => [...prev, data]);
    } catch (err) {
      console.error(err);
      // Fallback or toast could go here
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handlePublish = () => {
    if (!title.trim() || !content.trim() || selectedTagIds.length === 0 || !me) return;

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
          attachments: attachments.length > 0 ? attachments : undefined
        }
      },
      {
        onSuccess: () => {
          // Invalidate for all selected tags
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
          disabled={!title.trim() || !content.trim() || selectedTagIds.length === 0 || createLetterMutation.isPending || isUploading}
          className="flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-full font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          data-testid="button-publish-letter"
        >
          {createLetterMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} className="stroke-[1.5]" />}
          <span>Seal & Send</span>
        </button>
      </div>

      <div className="flex-1 w-full max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-12 flex flex-col gap-6 md:gap-8">
        {/* Title */}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="A title for this letter..."
          className="w-full bg-transparent border-none text-3xl md:text-5xl font-serif font-medium text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-0 px-0"
        />

        {/* Content */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write your thoughts..."
          className="flex-1 w-full bg-transparent border-none resize-none text-base md:text-xl font-serif text-foreground/90 font-light leading-relaxed placeholder:text-muted-foreground/30 focus:outline-none focus:ring-0 px-0 min-h-[240px] md:min-h-[300px]"
        />

        {/* Footer Configuration */}
        <div className="mt-auto pt-8 border-t border-border/50 space-y-8">
          
          {/* Attachments Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Enclosures</span>
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="flex items-center gap-2 text-xs font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
              >
                {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
                <span>Add File</span>
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                onChange={handleFileUpload}
              />
            </div>
            
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((att, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-md border border-border text-sm">
                    <Paperclip size={14} className="text-muted-foreground" />
                    <span className="truncate max-w-[150px]">{att.filename}</span>
                    <button 
                      onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-muted-foreground hover:text-destructive ml-1"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tags Section */}
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
    </div>
  );
}
