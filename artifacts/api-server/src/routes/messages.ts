import { Router } from "express";
import { createClerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { messagesTable, messageReadsTable } from "@workspace/db";
import { eq, lt, desc, and, sql } from "drizzle-orm";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { broadcast, subscribe } from "../lib/messageBus";

const router = Router();

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serializeMessage(m: typeof messagesTable.$inferSelect) {
  return {
    id: m.id,
    tagId: m.tagId,
    /** Unique sender user ID (Clerk user id) */
    senderId: m.authorId,
    /** Preferred display name — shown in the chat UI for both parties */
    senderDisplayName: m.authorName,
    /** Login / email — stored for auditing; never sent to the UI in normal flow */
    senderLoginName: m.senderLoginName ?? null,
    /** Message body */
    content: m.content,
    /** Server-authoritative UTC timestamp as ISO-8601 string */
    createdAt: m.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// GET /messages  — cursor-paginated history
// ---------------------------------------------------------------------------

router.get("/messages", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const tagId = parseInt(req.query.tagId as string);
  const limit = parseInt((req.query.limit as string) ?? "50");
  const before = req.query.before
    ? parseInt(req.query.before as string)
    : undefined;

  if (isNaN(tagId)) {
    res.status(400).json({ error: "tagId is required" });
    return;
  }

  const conditions = [eq(messagesTable.tagId, tagId)];
  if (before) conditions.push(lt(messagesTable.id, before));

  const messages = await db
    .select()
    .from(messagesTable)
    .where(and(...conditions))
    .orderBy(desc(messagesTable.id))
    .limit(Math.min(limit, 100));

  // Advance the read cursor to the latest message
  if (messages.length > 0) {
    const latestId = Math.max(...messages.map((m) => m.id));
    await db
      .insert(messageReadsTable)
      .values({ tagId, userId, lastReadMessageId: latestId })
      .onConflictDoUpdate({
        target: [messageReadsTable.tagId, messageReadsTable.userId],
        set: {
          lastReadMessageId: sql`GREATEST(${messageReadsTable.lastReadMessageId}, ${latestId})`,
        },
      });
  }

  res.json(messages.reverse().map(serializeMessage));
});

// ---------------------------------------------------------------------------
// GET /messages/stream  — Server-Sent Events real-time feed
//
// The client opens ONE long-lived connection per chat tag.  When a new message
// is saved to the DB, the POST handler broadcasts it via the in-process
// message bus; this handler forwards it to the SSE response stream.
//
// Auth: Clerk session cookie is sent automatically by EventSource (same-origin
// request through the Replit path-based proxy), so requireAuth works normally.
// ---------------------------------------------------------------------------

router.get("/messages/stream", requireAuth, (req, res) => {
  const { userId } = req as AuthedRequest;
  const tagId = parseInt(req.query.tagId as string);

  if (isNaN(tagId)) {
    res.status(400).json({ error: "tagId is required" });
    return;
  }

  // SSE headers — must be set before any write
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();

  // Emit a named "connected" event so the client can confirm the stream is live
  res.write(`event: connected\ndata: ${JSON.stringify({ tagId, userId })}\n\n`);

  // Heartbeat — keeps the connection alive through proxies that time out idle
  // streams; also lets the client detect stale connections quickly.
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 25_000);

  // Subscribe to the in-process message bus
  const unsubscribe = subscribe(tagId, (message) => {
    res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
  });

  // Clean up when the client disconnects
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// ---------------------------------------------------------------------------
// POST /messages  — send a message
// ---------------------------------------------------------------------------

router.post("/messages", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const { tagId, content } = req.body;

  if (!tagId || !content?.trim()) {
    res.status(400).json({ error: "tagId and content are required" });
    return;
  }

  // Resolve the sender's identity from Clerk — always use the authoritative
  // server-side data so the client cannot spoof display names.
  let senderDisplayName = "Partner";
  let senderLoginName: string | null = null;

  try {
    const clerkUser = await clerkClient.users.getUser(userId);
    senderDisplayName =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      clerkUser.emailAddresses[0]?.emailAddress?.split("@")[0] ||
      "Partner";
    // Store the full email as the auditable login identifier
    senderLoginName = clerkUser.emailAddresses[0]?.emailAddress ?? null;
  } catch {
    // Non-fatal — fall back to defaults; message still saves
  }

  const [message] = await db
    .insert(messagesTable)
    .values({
      tagId,
      authorId: userId,
      authorName: senderDisplayName,
      senderLoginName,
      content: content.trim(),
    })
    .returning();

  // Mark as read by the sender immediately
  await db
    .insert(messageReadsTable)
    .values({ tagId, userId, lastReadMessageId: message.id })
    .onConflictDoUpdate({
      target: [messageReadsTable.tagId, messageReadsTable.userId],
      set: {
        lastReadMessageId: sql`GREATEST(${messageReadsTable.lastReadMessageId}, ${message.id})`,
      },
    });

  const serialized = serializeMessage(message);

  // Push to all active SSE listeners on this tag (including the sender's
  // other tabs if any) for instant delivery without a round-trip poll.
  broadcast(tagId, serialized);

  res.status(201).json(serialized);
});

// ---------------------------------------------------------------------------
// DELETE /messages/:messageId
// ---------------------------------------------------------------------------

router.delete("/messages/:messageId", requireAuth, async (req, res) => {
  const messageId = parseInt(req.params.messageId as string);
  await db.delete(messagesTable).where(eq(messagesTable.id, messageId));
  res.status(204).end();
});

export default router;
