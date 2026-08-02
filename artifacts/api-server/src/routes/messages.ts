import { Router } from "express";
import fs from "fs";
import path from "path";
import { db } from "@workspace/db";
import {
  messagesTable,
  messageReadsTable,
  messageReactionsTable,
  userProfilesTable,
  tagsTable,
} from "@workspace/db";
import { eq, lt, ne, desc, and, sql, inArray, isNull } from "drizzle-orm";
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

type ReplyPreview = {
  id: number;
  senderId: string;
  senderDisplayName: string;
  content: string;
} | null;

function serializeMessage(
  m: typeof messagesTable.$inferSelect,
  partnerLastReadId: number,
  reactions: Record<string, string[]> = {},
  requesterId?: string,
  replyTo: ReplyPreview = null,
) {
  const now = new Date();
  let viewOnce: {
    status: "unseen" | "opened" | "expired";
    expiresAt: string | null;
    viewedAt: string | null;
    isSender: boolean;
  } | null = null;

  if (m.viewOnceUrl !== null && m.viewOnceUrl !== undefined) {
    const expired = m.viewOnceExpiresAt ? m.viewOnceExpiresAt < now : false;
    const viewed = !!m.viewOnceViewedAt;
    const isSender = requesterId === m.authorId;
    viewOnce = {
      status: viewed ? "opened" : expired ? "expired" : "unseen",
      expiresAt: m.viewOnceExpiresAt?.toISOString() ?? null,
      viewedAt: m.viewOnceViewedAt?.toISOString() ?? null,
      isSender,
    };
  }

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
    viewOnce,
    replyTo,
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

/** Batch-fetch parent messages by IDs and return a map of id → ReplyPreview */
async function fetchReplyPreviews(
  parentIds: number[],
): Promise<Map<number, ReplyPreview>> {
  const map = new Map<number, ReplyPreview>();
  if (parentIds.length === 0) return map;

  const parents = await db
    .select({
      id: messagesTable.id,
      authorId: messagesTable.authorId,
      authorName: messagesTable.authorName,
      content: messagesTable.content,
    })
    .from(messagesTable)
    .where(inArray(messagesTable.id, parentIds));

  for (const p of parents) {
    map.set(p.id, {
      id: p.id,
      senderId: p.authorId,
      senderDisplayName: p.authorName,
      content: p.content,
    });
  }
  return map;
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

  // Collect parent IDs for quote-replies
  const parentIds = [...new Set(messages.map((m) => m.replyToId).filter((id): id is number => id !== null && id !== undefined))];

  const [partnerLastReadId, reactionsMap, replyPreviewMap] = await Promise.all([
    getPartnerLastReadId(tagId, userId),
    fetchReactionsMap(messages.map((m) => m.id)),
    fetchReplyPreviews(parentIds),
  ]);

  res.json(
    messages
      .reverse()
      .map((m) =>
        serializeMessage(
          m,
          partnerLastReadId,
          reactionsMap.get(m.id) ?? {},
          userId,
          m.replyToId ? (replyPreviewMap.get(m.replyToId) ?? null) : null,
        ),
      ),
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
  const { tagId, content, viewOnceUrl, replyToId } = req.body;

  // Require either text content or a view-once photo URL
  if (!tagId || (!content?.trim() && !viewOnceUrl)) {
    res.status(400).json({ error: "tagId and content (or a view-once photo) are required" });
    return;
  }

  // Validate view-once URL format — must be a server-upload path, no traversal
  if (viewOnceUrl) {
    const uploadPathPattern = /^\/api\/uploads\/[^/\\]+\.(jpg|jpeg|png|gif|webp|heic|heif|avif)$/i;
    if (!uploadPathPattern.test(viewOnceUrl)) {
      res.status(400).json({ error: "Invalid view-once photo URL" });
      return;
    }
  }

  // Block non-admins from posting in admin-only channels
  const [tag] = await db.select().from(tagsTable).where(eq(tagsTable.id, tagId)).limit(1);
  if (tag?.isAdminOnly && !isAdmin(userId)) {
    res.status(403).json({ error: "This channel is read-only for non-admins" });
    return;
  }

  const authorName = await resolveDisplayName(userId);

  const viewOnceExpiresAt = viewOnceUrl
    ? new Date(Date.now() + 24 * 60 * 60 * 1000)
    : null;

  // Validate replyToId if provided
  let resolvedReplyToId: number | null = null;
  let replyPreview: ReplyPreview = null;
  if (replyToId) {
    const [parent] = await db
      .select({
        id: messagesTable.id,
        authorId: messagesTable.authorId,
        authorName: messagesTable.authorName,
        content: messagesTable.content,
        tagId: messagesTable.tagId,
      })
      .from(messagesTable)
      .where(and(eq(messagesTable.id, replyToId), eq(messagesTable.tagId, tagId)))
      .limit(1);

    if (parent) {
      resolvedReplyToId = parent.id;
      replyPreview = {
        id: parent.id,
        senderId: parent.authorId,
        senderDisplayName: parent.authorName,
        content: parent.content,
      };
    }
  }

  const [message] = await db
    .insert(messagesTable)
    .values({
      tagId,
      authorId: userId,
      authorName,
      content: content?.trim() || "",
      viewOnceUrl: viewOnceUrl ?? null,
      viewOnceExpiresAt,
      replyToId: resolvedReplyToId,
    })
    .returning();

  const serialized = serializeMessage(message, 0, {}, userId, replyPreview);

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
// POST /messages/:messageId/view  — partner opens a view-once photo
// ---------------------------------------------------------------------------

router.post("/messages/:messageId/view", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const messageId = parseInt(req.params.messageId as string);

  const [message] = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.id, messageId))
    .limit(1);

  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  if (!message.viewOnceUrl) {
    res.status(400).json({ error: "This message has no view-once photo" });
    return;
  }
  if (message.authorId === userId) {
    res.status(403).json({ error: "Sender cannot view their own view-once photo" });
    return;
  }
  const now = new Date();

  // Fast-path checks before touching the filesystem
  if (message.viewOnceViewedAt) {
    res.status(410).json({ error: "This photo has already been viewed" });
    return;
  }
  if (message.viewOnceExpiresAt && message.viewOnceExpiresAt < now) {
    res.status(410).json({ error: "This photo has expired" });
    return;
  }

  // Resolve the file on disk from the URL path  (/api/uploads/filename.jpg)
  const filename = path.basename(message.viewOnceUrl);
  const uploadDir = path.join(process.cwd(), "uploads");
  const filePath = path.join(uploadDir, filename);

  if (!fs.existsSync(filePath)) {
    // File already deleted (server restart wiped uploads).
    // Atomically mark as viewed so UI shows "Opened" and stops prompting.
    await db
      .update(messagesTable)
      .set({ viewOnceViewedAt: now, viewOnceViewedBy: userId })
      .where(and(eq(messagesTable.id, messageId), isNull(messagesTable.viewOnceViewedAt)));
    broadcast(message.tagId, { type: "view-once-viewed", payload: { messageId } });
    res.status(410).json({ error: "This photo is no longer available" });
    return;
  }

  // Read file bytes into memory BEFORE the DB claim so a read error cannot
  // leave a "viewed" record without the image having been served.
  let fileBuffer: Buffer;
  try {
    fileBuffer = fs.readFileSync(filePath);
  } catch {
    res.status(500).json({ error: "Failed to read photo" });
    return;
  }

  // ── Atomic one-view claim ────────────────────────────────────────────────
  // The WHERE clause includes `viewed_at IS NULL` so that under a race
  // (double-tap, two devices) only one request can claim the view.
  // If 0 rows are updated the current request lost the race — return 410.
  const claimed = await db
    .update(messagesTable)
    .set({ viewOnceViewedAt: now, viewOnceViewedBy: userId })
    .where(and(eq(messagesTable.id, messageId), isNull(messagesTable.viewOnceViewedAt)))
    .returning({ id: messagesTable.id });

  if (claimed.length === 0) {
    // Another concurrent request claimed the view first
    res.status(410).json({ error: "This photo has already been viewed" });
    return;
  }

  // Infer MIME type from extension
  const MIME_MAP: Record<string, string> = {
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
    ".gif":  "image/gif",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".avif": "image/avif",
  };
  const ext = path.extname(filename).toLowerCase();
  const contentType = MIME_MAP[ext] ?? "application/octet-stream";

  // Notify the sender via SSE — view is now committed
  broadcast(message.tagId, { type: "view-once-viewed", payload: { messageId } });

  // Delete the file — image now lives only in the response buffer
  try { fs.unlinkSync(filePath); } catch { /* ignore if already gone */ }

  // Return image bytes — no caching, no content-disposition (browser renders inline)
  res.set({
    "Content-Type": contentType,
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
    "Content-Length": String(fileBuffer.length),
  });
  res.end(fileBuffer);
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
// DELETE /messages/clear  — admin wipe entire chat history
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
