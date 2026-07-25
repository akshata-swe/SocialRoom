import { Router } from "express";
import { db } from "@workspace/db";
import {
  messagesTable,
  messageReadsTable,
  messageReactionsTable,
  userProfilesTable,
  tagsTable,
} from "@workspace/db";
import { eq, lt, ne, desc, and, sql, inArray } from "drizzle-orm";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { isAdmin, requireAdmin } from "../middlewares/requireAdmin";
import { broadcast, subscribe } from "../lib/messageBus";

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch reactions for a set of message IDs → map of messageId → {emoji → [userId]} */
async function fetchReactionsMap(
  messageIds: number[],
): Promise<Map<number, Record<string, string[]>>> {
  const map = new Map<number, Record<string, string[]>>();
  if (messageIds.length === 0) return map;

  const rows = await db
    .select()
    .from(messageReactionsTable)
    .where(inArray(messageReactionsTable.messageId, messageIds));

  for (const r of rows) {
    if (!map.has(r.messageId)) map.set(r.messageId, {});
    const byEmoji = map.get(r.messageId)!;
    if (!byEmoji[r.emoji]) byEmoji[r.emoji] = [];
    byEmoji[r.emoji].push(r.userId);
  }
  return map;
}

/** Fetch the reactions record for a single message. */
async function fetchReactionsForMessage(
  messageId: number,
): Promise<Record<string, string[]>> {
  const rows = await db
    .select()
    .from(messageReactionsTable)
    .where(eq(messageReactionsTable.messageId, messageId));
  const result: Record<string, string[]> = {};
  for (const r of rows) {
    if (!result[r.emoji]) result[r.emoji] = [];
    result[r.emoji].push(r.userId);
  }
  return result;
}

function serializeMessage(
  m: typeof messagesTable.$inferSelect,
  partnerLastReadId: number,
  reactions: Record<string, string[]> = {},
) {
  return {
    id: m.id,
    tagId: m.tagId,
    senderId: m.authorId,
    senderDisplayName: m.authorName,
    senderLoginName: m.senderLoginName ?? null,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
    seenByPartner: partnerLastReadId >= m.id,
    reactions,
  };
}

/** Resolve the sender's display name from user_profiles (source of truth). */
async function resolveDisplayName(userId: string): Promise<string> {
  const rows = await db
    .select({ displayName: userProfilesTable.displayName })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId))
    .limit(1);
  const name = rows[0]?.displayName?.trim();
  return name || "Partner";
}

/** Get the partner's last-read message ID for a tag (any user other than userId). */
async function getPartnerLastReadId(tagId: number, userId: string): Promise<number> {
  const rows = await db
    .select({ lastReadMessageId: messageReadsTable.lastReadMessageId })
    .from(messageReadsTable)
    .where(
      and(
        eq(messageReadsTable.tagId, tagId),
        ne(messageReadsTable.userId, userId),
      ),
    )
    .limit(1);
  return rows[0]?.lastReadMessageId ?? 0;
}

// ---------------------------------------------------------------------------
// GET /messages
// ---------------------------------------------------------------------------

router.get("/messages", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const tagId = parseInt(req.query.tagId as string);
  const limit = parseInt((req.query.limit as string) ?? "50");
  const before = req.query.before ? parseInt(req.query.before as string) : undefined;

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

  // Advance the read cursor
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
    broadcast(tagId, { type: "read", payload: { upToId: latestId } });
  }

  const [partnerLastReadId, reactionsMap] = await Promise.all([
    getPartnerLastReadId(tagId, userId),
    fetchReactionsMap(messages.map((m) => m.id)),
  ]);

  res.json(
    messages
      .reverse()
      .map((m) => serializeMessage(m, partnerLastReadId, reactionsMap.get(m.id) ?? {})),
  );
});

// ---------------------------------------------------------------------------
// GET /messages/stream  — SSE real-time feed
// ---------------------------------------------------------------------------

router.get("/messages/stream", requireAuth, (req, res) => {
  const { userId } = req as AuthedRequest;
  const tagId = parseInt(req.query.tagId as string);

  if (isNaN(tagId)) {
    res.status(400).json({ error: "tagId is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ tagId, userId })}\n\n`);

  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 25_000);

  const unsubscribe = subscribe(tagId, (event) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
  });

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// ---------------------------------------------------------------------------
// POST /messages
// ---------------------------------------------------------------------------

router.post("/messages", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const { tagId, content } = req.body;

  if (!tagId || !content?.trim()) {
    res.status(400).json({ error: "tagId and content are required" });
    return;
  }

  // Block non-admins from posting in admin-only channels
  const [tag] = await db.select().from(tagsTable).where(eq(tagsTable.id, tagId)).limit(1);
  if (tag?.isAdminOnly && !isAdmin(userId)) {
    res.status(403).json({ error: "This channel is read-only for non-admins" });
    return;
  }

  const authorName = await resolveDisplayName(userId);

  const [message] = await db
    .insert(messagesTable)
    .values({ tagId, authorId: userId, authorName, content: content.trim() })
    .returning();

  const serialized = serializeMessage(message, 0, {});

  await db
    .insert(messageReadsTable)
    .values({ tagId, userId, lastReadMessageId: message.id })
    .onConflictDoUpdate({
      target: [messageReadsTable.tagId, messageReadsTable.userId],
      set: {
        lastReadMessageId: sql`GREATEST(${messageReadsTable.lastReadMessageId}, ${message.id})`,
      },
    });

  broadcast(tagId, { type: "new", payload: serialized });
  res.status(201).json(serialized);
});

// ---------------------------------------------------------------------------
// POST /messages/:messageId/react  — toggle emoji reaction
// ---------------------------------------------------------------------------

router.post("/messages/:messageId/react", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const messageId = parseInt(req.params.messageId as string);
  const { emoji } = req.body;

  if (!emoji) {
    res.status(400).json({ error: "emoji is required" });
    return;
  }

  const [message] = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.id, messageId))
    .limit(1);

  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  // Toggle: delete if exists, insert if not
  const deleted = await db
    .delete(messageReactionsTable)
    .where(
      and(
        eq(messageReactionsTable.messageId, messageId),
        eq(messageReactionsTable.userId, userId),
        eq(messageReactionsTable.emoji, emoji),
      ),
    )
    .returning();

  if (deleted.length === 0) {
    await db
      .insert(messageReactionsTable)
      .values({ messageId, userId, emoji })
      .onConflictDoNothing();
  }

  const reactions = await fetchReactionsForMessage(messageId);
  broadcast(message.tagId, { type: "reaction", payload: { messageId, reactions } });

  res.json({ reactions });
});

// ---------------------------------------------------------------------------
// PATCH /messages/:messageId
// ---------------------------------------------------------------------------

router.patch("/messages/:messageId", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const messageId = parseInt(req.params.messageId as string);
  const { content } = req.body;

  if (!content?.trim()) {
    res.status(400).json({ error: "content is required" });
    return;
  }

  const [existing] = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.id, messageId))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  if (existing.authorId !== userId) {
    res.status(403).json({ error: "You can only edit your own messages" });
    return;
  }

  const [updated] = await db
    .update(messagesTable)
    .set({ content: content.trim() })
    .where(eq(messagesTable.id, messageId))
    .returning();

  const [partnerLastReadId, reactions] = await Promise.all([
    getPartnerLastReadId(existing.tagId, userId),
    fetchReactionsForMessage(messageId),
  ]);

  broadcast(existing.tagId, { type: "edit", payload: { id: messageId, content: content.trim() } });
  res.json(serializeMessage(updated, partnerLastReadId, reactions));
});

// ---------------------------------------------------------------------------
// DELETE /messages/:messageId
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DELETE /messages/clear?tagId=xxx  — admin wipe entire chat history
// ---------------------------------------------------------------------------

router.delete("/messages/clear", requireAuth, requireAdmin, async (req, res) => {
  const tagId = parseInt(req.query.tagId as string);
  if (isNaN(tagId)) {
    res.status(400).json({ error: "tagId is required" });
    return;
  }
  await db.delete(messagesTable).where(eq(messagesTable.tagId, tagId));
  // Also clear read cursors so unread counts reset
  await db.delete(messageReadsTable).where(eq(messageReadsTable.tagId, tagId));
  broadcast(tagId, { type: "clear", payload: {} });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// DELETE /messages/:messageId
// ---------------------------------------------------------------------------

router.delete("/messages/:messageId", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const messageId = parseInt(req.params.messageId as string);

  const [existing] = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.id, messageId))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  if (existing.authorId !== userId) {
    res.status(403).json({ error: "You can only delete your own messages" });
    return;
  }

  const partnerLastReadId = await getPartnerLastReadId(existing.tagId, userId);
  if (partnerLastReadId >= messageId) {
    res.status(403).json({ error: "Cannot delete a message that has already been seen" });
    return;
  }

  await db.delete(messagesTable).where(eq(messagesTable.id, messageId));
  broadcast(existing.tagId, { type: "delete", payload: { id: messageId } });
  res.status(204).end();
});

export default router;
