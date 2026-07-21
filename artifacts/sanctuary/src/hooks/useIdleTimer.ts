import { useEffect, useRef, useCallback } from "react";

const IDLE_EVENTS: (keyof WindowEventMap)[] = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "touchmove",
  "scroll",
  "wheel",
  "click",
  "pointerdown",
];

/**
 * Calls `onIdle` after `timeoutMs` milliseconds of no user interaction.
 * Calls `onActive` the moment activity resumes.
 */
export function useIdleTimer({
  timeoutMs,
  onIdle,
  onActive,
}: {
  timeoutMs: number;
  onIdle: () => void;
  onActive: () => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isIdleRef = useRef(false);

  const onActiveRef = useRef(onActive);
  const onIdleRef = useRef(onIdle);
  useEffect(() => { onActiveRef.current = onActive; }, [onActive]);
  useEffect(() => { onIdleRef.current = onIdle; }, [onIdle]);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    // If we were idle, fire onActive first
    if (isIdleRef.current) {
      isIdleRef.current = false;
      onActiveRef.current();
    }

    timerRef.current = setTimeout(() => {
      isIdleRef.current = true;
      onIdleRef.current();
    }, timeoutMs);
  }, [timeoutMs]);

  useEffect(() => {
    resetTimer();

    IDLE_EVENTS.forEach((event) =>
      window.addEventListener(event, resetTimer, { passive: true }),
    );

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      IDLE_EVENTS.forEach((event) =>
        window.removeEventListener(event, resetTimer),
      );
    };
  }, [resetTimer]);
}
