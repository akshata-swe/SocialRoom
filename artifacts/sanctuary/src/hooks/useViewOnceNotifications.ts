/**
 * useViewOnceNotifications
 *
 * Subscribes to the user-scoped SSE stream and fires a toast whenever
 * the current user's view-once photo is opened by the recipient.
 *
 * @param onNavigate - called with the tagId when the user clicks "Go to chat"
 */
import { useEffect, useRef } from "react";
import React from "react";
import { useUser } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

interface UseViewOnceNotificationsOptions {
  onNavigate: (tagId: number) => void;
}

export function useViewOnceNotifications({ onNavigate }: UseViewOnceNotificationsOptions) {
  const { isSignedIn } = useUser();
  const { toast } = useToast();

  // Keep stable refs so the EventSource closure is never stale
  const onNavigateRef = useRef(onNavigate);
  useEffect(() => { onNavigateRef.current = onNavigate; });

  const toastRef = useRef(toast);
  useEffect(() => { toastRef.current = toast; });

  useEffect(() => {
    if (!isSignedIn) return;

    const es = new EventSource("/api/user-events/stream", { withCredentials: true });

    es.addEventListener("view-once-opened", (e: MessageEvent) => {
      try {
        const { tagId, tagName } = JSON.parse(e.data) as {
          messageId: number;
          tagId: number;
          tagName: string;
        };

        toastRef.current({
          title: "Photo opened",
          description: `Your view-once photo in ${tagName} was seen.`,
          duration: 8000,
          action: React.createElement(
            ToastAction,
            {
              altText: "Go to chat",
              onClick: () => onNavigateRef.current(tagId),
            },
            "Go to chat",
          ),
        });
      } catch {
        /* ignore malformed events */
      }
    });

    es.onerror = () => {
      // Connection dropped — EventSource will auto-reconnect; nothing to do here.
    };

    return () => es.close();
  }, [isSignedIn]);
}
