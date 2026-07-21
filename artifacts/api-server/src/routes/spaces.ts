import { Router } from "express";
import { db } from "@workspace/db";
import {
  spacesTable,
  tagsTable,
  lettersTable,
  letterTagsTable,
  letterReadsTable,
  messagesTable,
  messageReadsTable,
} from "@workspace/db";
import { eq, sql, and, inArray } from "drizzle-orm";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";

const router = Router();

router.get("/spaces", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;

  const spaces = await db.select().from(spacesTable).orderBy(spacesTable.sortOrder);
  const tags = await db.select().from(tagsTable).orderBy(tagsTable.sortOrder);

  // Compute unread counts
  const unreadByTag: Record<number, number> = {};
  for (const tag of tags) {
    if (tag.type === "postbox") {
      // Count letters in this tag that the user hasn't read
      const readLetterIds = db
        .select({ letterId: letterReadsTable.letterId })
        .from(letterReadsTable)
        .where(eq(letterReadsTable.userId, userId));

      const result = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(letterTagsTable)
        .innerJoin(lettersTable, eq(lettersTable.id, letterTagsTable.letterId))
        .where(
          and(
            eq(letterTagsTable.tagId, tag.id),
            sql`${letterTagsTable.letterId} NOT IN (${readLetterIds})`,
          ),
        );
      unreadByTag[tag.id] = result[0]?.count ?? 0;
    } else {
      // Count messages after last read
      const readRow = await db
        .select()
        .from(messageReadsTable)
        .where(
          and(
            eq(messageReadsTable.tagId, tag.id),
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
            eq(messagesTable.tagId, tag.id),
            sql`${messagesTable.id} > ${lastReadId}`,
            sql`${messagesTable.authorId} != ${userId}`,
          ),
        );
      unreadByTag[tag.id] = result[0]?.count ?? 0;
    }
  }

  const spaceWithTags = spaces.map((space) => ({
    ...space,
    tags: tags
      .filter((t) => t.spaceId === space.id)
      .map((t) => ({ ...t, unreadCount: unreadByTag[t.id] ?? 0 })),
  }));

  res.json(spaceWithTags);
});

router.post("/spaces", requireAuth, async (req, res) => {
  const { name, sortOrder = 0 } = req.body;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const [created] = await db
    .insert(spacesTable)
    .values({ name, sortOrder })
    .returning();
  res.status(201).json({ ...created, tags: [] });
});

router.patch("/spaces/:spaceId", requireAuth, async (req, res) => {
  const spaceId = parseInt(req.params.spaceId as string);
  const { name, sortOrder } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (sortOrder !== undefined) updates.sortOrder = sortOrder;
  const [updated] = await db
    .update(spacesTable)
    .set(updates)
    .where(eq(spacesTable.id, spaceId))
    .returning();
  const tags = await db
    .select()
    .from(tagsTable)
    .where(eq(tagsTable.spaceId, spaceId))
    .orderBy(tagsTable.sortOrder);
  res.json({ ...updated, tags });
});

router.delete("/spaces/:spaceId", requireAuth, async (req, res) => {
  const spaceId = parseInt(req.params.spaceId as string);
  await db.delete(spacesTable).where(eq(spacesTable.id, spaceId));
  res.status(204).end();
});

export default router;
