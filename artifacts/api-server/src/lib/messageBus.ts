/**
 * In-memory SSE pub/sub bus.
 *
 * Supports three event types so the SSE route can emit typed events:
 *   - "new"    → a new message was saved
 *   - "edit"   → a message's content was changed
 *   - "delete" → a message was removed
 *
 * The SSE handler writes: `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`
 * The frontend EventSource subscribes with `es.addEventListener("new", ...)` etc.
 */

export type BusEvent =
  | { type: "new"; payload: object }
  | { type: "edit"; payload: { id: number; content: string } }
  | { type: "delete"; payload: { id: number } }
  | { type: "clear"; payload: Record<string, never> }
  | { type: "read"; payload: { upToId: number } }
  | { type: "reaction"; payload: { messageId: number; reactions: Record<string, string[]> } }
  | { type: "view-once-viewed"; payload: { messageId: number } };

export type UserBusEvent =
  | { type: "view-once-opened"; payload: { messageId: number; tagId: number; tagName: string } };

type Listener = (event: BusEvent) => void;
type UserListener = (event: UserBusEvent) => void;

// ── Tag-scoped bus ────────────────────────────────────────────────────────────

const subscribers = new Map<number, Set<Listener>>();

/** Subscribe to events for a given tagId. Returns an unsubscribe fn. */
export function subscribe(tagId: number, listener: Listener): () => void {
  if (!subscribers.has(tagId)) {
    subscribers.set(tagId, new Set());
  }
  subscribers.get(tagId)!.add(listener);

  return () => {
    const subs = subscribers.get(tagId);
    if (subs) {
      subs.delete(listener);
      if (subs.size === 0) subscribers.delete(tagId);
    }
  };
}

/** Broadcast a typed event to all SSE clients listening on tagId. */
export function broadcast(tagId: number, event: BusEvent): void {
  subscribers.get(tagId)?.forEach((listener) => listener(event));
}

// ── User-scoped bus ───────────────────────────────────────────────────────────

const userSubscribers = new Map<string, Set<UserListener>>();

/** Subscribe to user-level events for a given userId. Returns an unsubscribe fn. */
export function subscribeUser(userId: string, listener: UserListener): () => void {
  if (!userSubscribers.has(userId)) {
    userSubscribers.set(userId, new Set());
  }
  userSubscribers.get(userId)!.add(listener);

  return () => {
    const subs = userSubscribers.get(userId);
    if (subs) {
      subs.delete(listener);
      if (subs.size === 0) userSubscribers.delete(userId);
    }
  };
}

/** Broadcast a user-level event to a specific user's SSE clients. */
export function broadcastToUser(userId: string, event: UserBusEvent): void {
  userSubscribers.get(userId)?.forEach((listener) => listener(event));
}
