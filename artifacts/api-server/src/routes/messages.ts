import { Router } from "express";
import { db } from "@workspace/db";
import { messagesTable, messageReadsTable, userProfilesTable } from "@workspace/db";
import { eq, lt, desc, and, sql } from "drizzle-orm";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { broadcast, subscribe } from "../lib/messageBus";

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serializeMessage(m: typeof messagesTable.$inferSelect) {
  return {
    id: m.id,
    tagId: m.tagId,
    senderId: m.authorId,
    senderDisplayName: m.authorName,
    senderLoginName: m.senderLoginName ?? null,   // audit only — never shown in UI
    content: m.content,
    createdAt: m.createdAt.toISOString(),
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
  }

  res.json(messages.reverse().map(serializeMessage));
});

// ---------------------------------------------------------------------------
// GET /messages/stream  — Server-Sent Events real-time feed
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

  const unsubscribe = subscribe(tagId, (message) => {
    res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
  });

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

  // displayName always comes from user_profiles — the name the user explicitly
  // chose in onboarding. Never trust client-supplied display names.
  const senderDisplayName = await resolveDisplayName(userId);

  // Resolve login email for auditing (never shown in UI)
  let senderLoginName: string | null = null;
  try {
    const { createClerkClient } = await import("@clerk/express");
    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
    const clerkUser = await clerk.users.getUser(userId);
    senderLoginName = clerkUser.emailAddresses[0]?.emailAddress ?? null;
  } catch {
    // Non-fatal
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
