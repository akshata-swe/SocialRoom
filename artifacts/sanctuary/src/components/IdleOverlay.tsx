import { useEffect, useState } from "react";
import { Feather } from "lucide-react";

interface IdleOverlayProps {
  onResume: () => void;
}

/**
 * Full-screen overlay shown after 2 minutes of inactivity.
 * Any interaction (click, tap, keypress) dismisses it — no re-login needed.
 */
export default function IdleOverlay({ onResume }: IdleOverlayProps) {
  // Animate the clock display
  const [time, setTime] = useState(() => formatTime(new Date()));

  useEffect(() => {
    const id = setInterval(() => setTime(formatTime(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center cursor-pointer select-none"
      style={{ background: "hsl(220 13% 8%)" }}
      onClick={onResume}
      onKeyDown={onResume}
      onTouchStart={onResume}
      role="button"
      tabIndex={0}
      aria-label="Tap to return to The Room"
    >
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-primary/5 blur-[140px]" />
      </div>

      <div className="relative flex flex-col items-center gap-8 animate-in fade-in duration-700">
        {/* Clock */}
        <div className="font-serif text-[72px] font-light tracking-tight text-foreground/90 leading-none tabular-nums">
          {time}
        </div>

        {/* Date */}
        <div className="text-muted-foreground/50 text-sm font-light tracking-widest uppercase">
          {formatDate(new Date())}
        </div>

        {/* Feather icon */}
        <div className="mt-4 w-10 h-10 rounded-full border border-border/30 flex items-center justify-center">
          <Feather className="w-4 h-4 text-primary/60" strokeWidth={1.5} />
        </div>

        {/* Hint */}
        <p className="text-muted-foreground/30 text-xs font-light tracking-widest uppercase animate-pulse">
          Tap anywhere to continue
        </p>
      </div>
    </div>
  );
}

function formatTime(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
