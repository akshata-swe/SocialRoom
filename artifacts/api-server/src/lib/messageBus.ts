/**
 * In-memory SSE pub/sub bus.
 *
 * When a message is saved to the DB, the POST handler calls `broadcast(tagId, msg)`.
 * All active SSE connections for that tagId receive the payload instantly.
 *
 * No external dependency — this works for a two-user app where both tabs are
 * connected to the same server process. For multi-instance deploys, swap this
 * for Redis pub/sub using the same interface.
 */

type Listener = (message: object) => void;

const subscribers = new Map<number, Set<Listener>>();

/**
 * Subscribe to new messages for a given tagId.
 * Returns an unsubscribe function; call it when the SSE connection closes.
 */
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

/**
 * Broadcast a newly saved message to all SSE clients listening on tagId.
 */
export function broadcast(tagId: number, message: object): void {
  subscribers.get(tagId)?.forEach((listener) => listener(message));
}
