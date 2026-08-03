import { useState, useCallback } from "react";
import Sidebar from "../components/Sidebar";
import PostboxView from "../components/PostboxView";
import ChatView from "../components/ChatView";
import LetterComposer from "../components/LetterComposer";
import LetterReader from "../components/LetterReader";
import IdleOverlay from "../components/IdleOverlay";
import { useIdleTimer } from "../hooks/useIdleTimer";
import { useViewOnceNotifications } from "../hooks/useViewOnceNotifications";
import { Tag, useGetTags } from "@workspace/api-client-react";
import { Menu } from "lucide-react";

const IDLE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

export type ViewState = "postbox" | "chat" | "composer" | "reader" | "empty";

export default function Sanctuary() {
  const [activeTag, setActiveTag] = useState<Tag | null>(null);
  const [view, setView] = useState<ViewState>("empty");
  const [activeLetterId, setActiveLetterId] = useState<number | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isIdle, setIsIdle] = useState(false);

  const { data: allTags } = useGetTags();

  // Navigate to a chat when the sender's view-once notification is tapped
  const handleViewOnceNavigate = useCallback(
    (tagId: number) => {
      const target = allTags?.find((t) => t.id === tagId);
      if (target && target.type === "chat") {
        setActiveTag(target);
        setView("chat");
        setIsMobileMenuOpen(false);
      }
    },
    [allTags],
  );

  useViewOnceNotifications({ onNavigate: handleViewOnceNavigate });

  useIdleTimer({
    timeoutMs: IDLE_TIMEOUT_MS,
    onIdle: useCallback(() => setIsIdle(true), []),
    onActive: useCallback(() => setIsIdle(false), []),
  });

  const handleSelectTag = (tag: Tag) => {
    setActiveTag(tag);
    setView(tag.type === "postbox" ? "postbox" : "chat");
    setIsMobileMenuOpen(false);
  };

  const handleOpenComposer = () => {
    setView("composer");
  };

  const handleReadLetter = (id: number) => {
    setActiveLetterId(id);
    setView("reader");
  };

  const handleCloseOverlay = () => {
    if (activeTag) {
      setView(activeTag.type === "postbox" ? "postbox" : "chat");
    } else {
      setView("empty");
    }
  };

  return (
    <div className="flex h-[100dvh] w-full bg-background text-foreground overflow-hidden">
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 border-b border-border bg-background/95 backdrop-blur-sm z-30 flex items-center px-4">
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-mobile-menu"
        >
          <Menu size={24} className="stroke-1" />
        </button>
        <span className="font-serif ml-2 text-lg">Kothadi</span>
      </div>

      {/* Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm transition-opacity"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar Wrapper */}
      <div
        className={`
        fixed md:static inset-y-0 left-0 z-50 w-[280px] md:w-[260px] 
        transform transition-transform duration-300 ease-in-out bg-sidebar border-r border-border
        ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
      `}
      >
        <Sidebar activeTagId={activeTag?.id} onSelectTag={handleSelectTag} />
      </div>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative pt-14 md:pt-0 w-full overflow-hidden bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-sidebar/5 via-background to-background">
        <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.02]"></div>

        <div className="flex-1 relative z-10 w-full h-full">
          {view === "empty" && (
            <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground space-y-4 px-6 text-center">
              <p className="font-serif text-xl font-medium tracking-wide">
                The room is quiet.
              </p>
              <p className="text-sm font-light max-w-sm">
                Select a drawer or channel from the sidebar to begin.
              </p>
            </div>
          )}

          {view === "postbox" && activeTag && (
            <PostboxView
              tag={activeTag}
              onReadLetter={handleReadLetter}
              onNewLetter={handleOpenComposer}
            />
          )}

          {view === "chat" && activeTag && <ChatView tag={activeTag} />}

          {view === "composer" && (
            <LetterComposer
              onClose={handleCloseOverlay}
              initialTagId={
                activeTag?.type === "postbox" ? activeTag.id : undefined
              }
            />
          )}

          {view === "reader" && activeLetterId && (
            <LetterReader
              letterId={activeLetterId}
              onClose={handleCloseOverlay}
            />
          )}
        </div>
      </main>

      {/* Idle screen — shown after 2 min of no interaction */}
      {isIdle && <IdleOverlay onResume={() => setIsIdle(false)} />}
    </div>
  );
}
