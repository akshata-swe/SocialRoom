import { Router } from "express";
import { db } from "@workspace/db";
import { messagesTable, messageReadsTable } from "@workspace/db";
import { eq, lt, desc, and, sql } from "drizzle-orm";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";

const router = Router();

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

  // Update read status to the most recent message
  if (messages.length > 0) {
    const latestId = Math.max(...messages.map((m) => m.id));
    await db
      .insert(messageReadsTable)
      .values({ tagId, userId, lastReadMessageId: latestId })
      .onConflictDoUpdate({
        target: [messageReadsTable.tagId, messageReadsTable.userId],
        set: { lastReadMessageId: sql`GREATEST(${messageReadsTable.lastReadMessageId}, ${latestId})` },
      });
  }

  res.json(
    messages.reverse().map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    })),
  );
});

router.post("/messages", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const { tagId, content } = req.body;

  if (!tagId || !content) {
    res.status(400).json({ error: "tagId and content are required" });
    return;
  }

  const authorName = req.body.authorName || "Partner";

  const [message] = await db
    .insert(messagesTable)
    .values({ tagId, authorId: userId, authorName, content })
    .returning();

  // Mark as read by sender
  await db
    .insert(messageReadsTable)
    .values({ tagId, userId, lastReadMessageId: message.id })
    .onConflictDoUpdate({
      target: [messageReadsTable.tagId, messageReadsTable.userId],
      set: { lastReadMessageId: sql`GREATEST(${messageReadsTable.lastReadMessageId}, ${message.id})` },
    });

  res.status(201).json({ ...message, createdAt: message.createdAt.toISOString() });
});

router.delete("/messages/:messageId", requireAuth, async (req, res) => {
  const messageId = parseInt(req.params.messageId as string);
  await db.delete(messagesTable).where(eq(messagesTable.id, messageId));
  res.status(204).end();
});

export default router;
