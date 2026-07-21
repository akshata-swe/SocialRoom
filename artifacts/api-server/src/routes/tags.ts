import { Router } from "express";
import { db } from "@workspace/db";
import {
  tagsTable,
  lettersTable,
  letterTagsTable,
  letterReadsTable,
  messagesTable,
  messageReadsTable,
} from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";

const router = Router();

async function getUnreadCount(tagId: number, tagType: string, userId: string) {
  if (tagType === "postbox") {
    const readLetterIds = db
      .select({ letterId: letterReadsTable.letterId })
      .from(letterReadsTable)
      .where(eq(letterReadsTable.userId, userId));

    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(letterTagsTable)
      .where(
        and(
          eq(letterTagsTable.tagId, tagId),
          sql`${letterTagsTable.letterId} NOT IN (${readLetterIds})`,
        ),
      );
    return result[0]?.count ?? 0;
  } else {
    const readRow = await db
      .select()
      .from(messageReadsTable)
      .where(
        and(
          eq(messageReadsTable.tagId, tagId),
          eq(messageReadsTable.userId, userId),
        ),
      )
      .limit(1);
    const lastReadId = readRow[0]?.lastReadMessageId ?? 0;
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.tagId, tagId),
          sql`${messagesTable.id} > ${lastReadId}`,
          sql`${messagesTable.authorId} != ${userId}`,
        ),
      );
    return result[0]?.count ?? 0;
  }
}

router.get("/tags", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const tags = await db.select().from(tagsTable).orderBy(tagsTable.sortOrder);
  const tagsWithUnread = await Promise.all(
    tags.map(async (tag) => ({
      ...tag,
      unreadCount: await getUnreadCount(tag.id, tag.type, userId),
    })),
  );
  res.json(tagsWithUnread);
});

router.post("/tags", requireAuth, async (req, res) => {
  const { spaceId, name, type, icon, sortOrder = 0 } = req.body;
  if (!spaceId || !name || !type) {
    res.status(400).json({ error: "spaceId, name, type are required" });
    return;
  }
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const [created] = await db
    .insert(tagsTable)
    .values({ spaceId, name, slug, type, icon, sortOrder })
    .returning();
  res.status(201).json({ ...created, unreadCount: 0 });
});

router.delete("/tags/:tagId", requireAuth, async (req, res) => {
  const tagId = parseInt(req.params.tagId as string);
  await db.delete(tagsTable).where(eq(tagsTable.id, tagId));
  res.status(204).end();
});

router.get("/unread-counts", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const tags = await db.select().from(tagsTable);
  const counts: Record<string, number> = {};
  await Promise.all(
    tags.map(async (tag) => {
      counts[tag.id] = await getUnreadCount(tag.id, tag.type, userId);
    }),
  );
  res.json({ counts });
});

export default router;
