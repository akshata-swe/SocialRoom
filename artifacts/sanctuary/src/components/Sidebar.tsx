import { useGetSpaces, useGetUnreadCounts, useGetMe, Tag } from "@workspace/api-client-react";
import { useClerk } from "@clerk/react";
import { PenLine, LogOut, Loader2, Feather } from "lucide-react";

interface SidebarProps {
  activeTagId?: number;
  onSelectTag: (tag: Tag) => void;
}

export default function Sidebar({ activeTagId, onSelectTag }: SidebarProps) {
  const { data: spaces, isLoading: isLoadingSpaces } = useGetSpaces();
  const { data: unreadData } = useGetUnreadCounts({ query: { refetchInterval: 10000 } });
  const { data: me } = useGetMe();
  const { signOut } = useClerk();

  const unreadCounts = unreadData?.counts || {};
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <div className="flex flex-col h-full w-full select-none">
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border/50 shrink-0">
        <div className="flex items-center gap-3 text-primary">
          <Feather size={20} className="stroke-1" />
          <span className="font-serif text-lg tracking-wide font-medium">Sanctuary</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-6 px-3 space-y-8 custom-scrollbar">
        {isLoadingSpaces ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          spaces?.map((space) => (
            <div key={space.id} className="space-y-2">
              <div className="px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/60 mb-2">
                {space.name}
              </div>
              <div className="space-y-0.5">
                {space.tags?.map((tag) => {
                  const isActive = tag.id === activeTagId;
                  const unread = unreadCounts[tag.id] || 0;
                  
                  return (
                    <button
                      key={tag.id}
                      onClick={() => onSelectTag(tag)}
                      className={`
                        w-full flex items-center justify-between px-3 py-2 rounded-md transition-all duration-200 text-sm group
                        ${isActive 
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm shadow-black/20" 
                          : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                        }
                      `}
                      data-testid={`tag-${tag.id}`}
                    >
                      <div className="flex items-center gap-3 truncate">
                        {tag.icon ? (
                          <span className={`text-base leading-none transition-transform duration-300 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`}>{tag.icon}</span>
                        ) : (
                          <span className="w-4 h-4 rounded-full border border-sidebar-border flex items-center justify-center text-[10px]">#</span>
                        )}
                        <span className="truncate">{tag.name}</span>
                      </div>
                      
                      {unread > 0 && (
                        <div className={`
                          min-w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold px-1.5
                          ${isActive ? "bg-primary text-primary-foreground" : "bg-sidebar-primary/20 text-sidebar-primary"}
                        `}>
                          {unread}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-4 border-t border-sidebar-border/50 shrink-0">
        <div className="flex items-center justify-between bg-sidebar-accent/30 rounded-xl p-3 border border-sidebar-border/50">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 rounded-full bg-sidebar-accent border border-sidebar-border overflow-hidden shrink-0 flex items-center justify-center text-xs font-serif text-primary">
              {me?.avatarUrl ? (
                <img src={me.avatarUrl} alt={me.displayName} className="w-full h-full object-cover" />
              ) : (
                me?.displayName?.charAt(0).toUpperCase() || "?"
              )}
            </div>
            <div className="flex flex-col truncate">
              <span className="text-sm font-medium text-foreground truncate">{me?.displayName}</span>
              <span className="text-xs text-muted-foreground truncate">{me?.email}</span>
            </div>
          </div>
          
          <button
            onClick={() => signOut({ redirectUrl: basePath || "/" })}
            className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full transition-colors shrink-0"
            title="Sign out"
            data-testid="button-signout"
          >
            <LogOut size={16} className="stroke-[1.5]" />
          </button>
        </div>
      </div>
    </div>
  );
}
