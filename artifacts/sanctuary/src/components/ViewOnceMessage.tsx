/**
 * ViewOnceMessage — renders a view-once photo message bubble.
 *
 * States:
 *  unseen  + isSender   → locked card (sender)
 *  unseen  + !isSender  → "Tap to view" card (recipient)
 *  opened               → receipt text
 *  expired              → expired text
 *
 * On tap (recipient only):
 *  1. POST /api/messages/:id/view  →  raw image bytes, Cache-Control: no-store
 *  2. Create Object URL from blob, display fullscreen overlay
 *  3. 10-second countdown ring
 *  4. On end (or tab-hide): revoke Object URL, collapse to receipt
 */

import { useState, useEffect, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
import { Camera, Eye, Lock, Loader2 } from "lucide-react";
import { format } from "date-fns";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ViewOnce {
  status: "unseen" | "opened" | "expired";
  expiresAt: string | null;
  viewedAt: string | null;
  isSender: boolean;
}

interface ViewOnceMessageProps {
  messageId: number;
  viewOnce: ViewOnce;
  isMe: boolean;
  /** Called after the recipient successfully views and the overlay collapses. */
  onViewed: (viewedAt: string) => void;
}

// ---------------------------------------------------------------------------
// Countdown ring constants
// ---------------------------------------------------------------------------

const COUNTDOWN_SECONDS = 10;
const RADIUS = 36;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ≈ 226.2

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Phase = "idle" | "loading" | "viewing" | "done" | "error";

export function ViewOnceMessage({
  messageId,
  viewOnce,
  isMe,
  onViewed,
}: ViewOnceMessageProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const objUrlRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const viewedAtRef = useRef<string>(new Date().toISOString());

  // Revoke the Object URL and collapse the overlay.
  // When the sender previews, we go back to "idle" (photo wasn't consumed).
  // When the recipient views, we go to "done" and fire onViewed.
  const collapseView = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (objUrlRef.current) {
      URL.revokeObjectURL(objUrlRef.current);
      objUrlRef.current = null;
    }
    setObjectUrl(null);
    if (viewOnce.isSender) {
      setPhase("idle");
    } else {
      setPhase("done");
      onViewed(viewedAtRef.current);
    }
  }, [onViewed, viewOnce.isSender]);

  // Start countdown when viewing begins
  useEffect(() => {
    if (phase !== "viewing") return;
    viewedAtRef.current = new Date().toISOString();
    setSecondsLeft(COUNTDOWN_SECONDS);
    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          // Will be cleaned up next render; collapse on 0
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  // Collapse when counter reaches 0
  useEffect(() => {
    if (phase === "viewing" && secondsLeft === 0) {
      collapseView();
    }
  }, [phase, secondsLeft, collapseView]);

  // Collapse when tab loses visibility (screenshot mitigation)
  useEffect(() => {
    if (phase !== "viewing") return;
    const onHide = () => {
      if (document.hidden) collapseView();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [phase, collapseView]);

  // ── Tap handler ──────────────────────────────────────────────────────────

  const handleTap = async () => {
    if (
      phase !== "idle" ||
      viewOnce.status !== "unseen"
    ) return;

    setPhase("loading");
    setErrorMsg(null);

    try {
      const response = await fetch(`/api/messages/${messageId}/view`, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        let msg = `Error ${response.status}`;
        try {
          const body = await response.json();
          if (body?.error) msg = body.error;
        } catch { /* ignore */ }
        throw new Error(msg);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      objUrlRef.current = url;
      setObjectUrl(url);
      setPhase("viewing");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to open photo";
      setErrorMsg(msg);
      setPhase("error");
      // Reset back to idle after 3 s so the user can try again if it was transient
      setTimeout(() => setPhase("idle"), 3000);
    }
  };

  // ── Derived display state ─────────────────────────────────────────────────

  const effectiveStatus: ViewOnce["status"] =
    phase === "done" ? "opened" : viewOnce.status;
  const effectiveViewedAt =
    phase === "done" ? viewedAtRef.current : viewOnce.viewedAt;

  // ── Card content ──────────────────────────────────────────────────────────

  function renderCardContent() {
    // Loading
    if (phase === "loading") {
      return (
        <div className="flex items-center gap-3 px-4 py-3.5">
          <Loader2 size={16} className="animate-spin text-primary/70 shrink-0" />
          <span className="text-sm text-muted-foreground/70 font-light">Opening…</span>
        </div>
      );
    }

    // Error
    if (phase === "error") {
      return (
        <div className="flex items-center gap-3 px-4 py-3.5">
          <Camera size={16} className="text-destructive/60 shrink-0" />
          <span className="text-sm text-destructive/60 font-light">{errorMsg}</span>
        </div>
      );
    }

    // Opened
    if (effectiveStatus === "opened") {
      return (
        <div className="flex items-center gap-3 px-4 py-3.5">
          <Camera size={16} className="text-muted-foreground/30 shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="text-xs text-muted-foreground/40 font-light">View once · photo</span>
            <span className="text-[11px] text-muted-foreground/30 font-light">
              Opened
              {effectiveViewedAt
                ? ` · ${format(new Date(effectiveViewedAt), "MMM d, h:mm a")}`
                : ""}
            </span>
          </div>
        </div>
      );
    }

    // Expired
    if (effectiveStatus === "expired") {
      return (
        <div className="flex items-center gap-3 px-4 py-3.5">
          <Camera size={16} className="text-muted-foreground/25 shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="text-xs text-muted-foreground/35 font-light">View once · photo</span>
            <span className="text-[11px] text-muted-foreground/25 font-light">Expired</span>
          </div>
        </div>
      );
    }

    // Unseen — sender preview card (can tap to see without consuming)
    if (viewOnce.isSender) {
      return (
        <button
          onClick={handleTap}
          className="flex items-center gap-3 px-4 py-3.5 w-full text-left group"
        >
          <div className="relative shrink-0">
            <Camera
              size={20}
              className="text-primary/70 transition-transform group-hover:scale-110"
            />
            <Eye
              size={10}
              className="text-primary/50 absolute -bottom-0.5 -right-0.5"
            />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-[15px] font-medium text-foreground/80">Tap to preview</span>
            <span className="text-[11px] text-muted-foreground/40 font-light">
              View once · waiting to be opened
            </span>
          </div>
        </button>
      );
    }

    // Unseen — recipient tap-to-view card
    return (
      <button
        onClick={handleTap}
        className="flex items-center gap-3 px-4 py-3.5 w-full text-left group"
      >
        <div className="relative shrink-0">
          <Camera
            size={20}
            className="text-primary transition-transform group-hover:scale-110"
          />
          <Eye
            size={10}
            className="text-primary/80 absolute -bottom-0.5 -right-0.5"
          />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-[15px] font-medium text-foreground/90">Tap to view</span>
          <span className="text-[11px] text-muted-foreground/50 font-light">
            View once · photo
          </span>
        </div>
      </button>
    );
  }

  // ── SVG ring offset ───────────────────────────────────────────────────────

  // Ring drains: full → empty as seconds tick down
  const dashOffset = CIRCUMFERENCE * (1 - secondsLeft / COUNTDOWN_SECONDS);

  // ── Render ────────────────────────────────────────────────────────────────

  const canTap =
    phase === "idle" && effectiveStatus === "unseen";

  return (
    <>
      {/* Placeholder card */}
      <div
        className={`
          rounded-2xl border overflow-hidden min-w-[190px] max-w-[250px] select-none
          ${isMe
            ? "bg-primary/10 border-primary/20"
            : canTap
              ? "bg-card border-primary/30 hover:border-primary/50 transition-colors"
              : "bg-card border-border/40"
          }
        `}
      >
        {renderCardContent()}
      </div>

      {/* Fullscreen viewing overlay — rendered into document.body */}
      {phase === "viewing" &&
        objectUrl &&
        ReactDOM.createPortal(
          <div
            className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-black/95 animate-in fade-in duration-200"
            onContextMenu={(e) => e.preventDefault()}
          >
            {/* Image — pointer-events-none prevents long-press save on mobile */}
            <img
              src={objectUrl}
              alt=""
              draggable={false}
              className="max-h-[80vh] max-w-[95vw] object-contain select-none pointer-events-none"
            />

            {/* Countdown ring */}
            <div className="absolute bottom-10 flex flex-col items-center gap-3">
              <div className="relative w-20 h-20">
                <svg
                  viewBox="0 0 88 88"
                  className="w-20 h-20 -rotate-90"
                  aria-hidden="true"
                >
                  {/* Track */}
                  <circle
                    cx="44"
                    cy="44"
                    r={RADIUS}
                    fill="none"
                    stroke="rgba(255,255,255,0.12)"
                    strokeWidth="5"
                  />
                  {/* Progress arc — drains as time runs out */}
                  <circle
                    cx="44"
                    cy="44"
                    r={RADIUS}
                    fill="none"
                    stroke="rgba(255,255,255,0.75)"
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset={dashOffset}
                    style={{ transition: "stroke-dashoffset 1s linear" }}
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-white text-xl font-medium tabular-nums">
                  {secondsLeft}
                </span>
              </div>
              <span className="text-white/35 text-[11px] font-light tracking-wide">
                Photo disappears when timer ends
              </span>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
