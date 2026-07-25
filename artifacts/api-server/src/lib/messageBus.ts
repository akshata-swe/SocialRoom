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
  | { type: "reaction"; payload: { messageId: number; reactions: Record<string, string[]> } };

type Listener = (event: BusEvent) => void;

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
