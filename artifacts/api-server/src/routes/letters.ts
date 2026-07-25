import { Router } from "express";
import { db } from "@workspace/db";
import {
  lettersTable,
  letterTagsTable,
  letterReadsTable,
  letterAttachmentsTable,
  letterCommentsTable,
  userProfilesTable,
  tagsTable,
} from "@workspace/db";
import { eq, sql, inArray, and, desc } from "drizzle-orm";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { isAdmin } from "../middlewares/requireAdmin";
import { getOrCreateProfile } from "./profile";

const router = Router();

router.get("/letters", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const tagId = parseInt(req.query.tagId as string);
  if (isNaN(tagId)) {
    res.status(400).json({ error: "tagId is required" });
    return;
  }

  // Get letters for this tag
  const letterIds = await db
    .select({ letterId: letterTagsTable.letterId })
    .from(letterTagsTable)
    .where(eq(letterTagsTable.tagId, tagId));

  if (letterIds.length === 0) {
    res.json([]);
    return;
  }

  const ids = letterIds.map((r) => r.letterId);

  const letters = await db
    .select()
    .from(lettersTable)
    .where(inArray(lettersTable.id, ids))
    .orderBy(desc(lettersTable.createdAt));

  // Get read status for each letter
  const reads = await db
    .select({ letterId: letterReadsTable.letterId })
    .from(letterReadsTable)
    .where(
      and(
        inArray(letterReadsTable.letterId, ids),
        eq(letterReadsTable.userId, userId),
      ),
    );
  const readSet = new Set(reads.map((r) => r.letterId));

  // Get all tags for each letter
  const allLetterTags = await db
    .select()
    .from(letterTagsTable)
    .where(inArray(letterTagsTable.letterId, ids));

  // Get attachment presence
  const attachments = await db
    .select({ letterId: letterAttachmentsTable.letterId })
    .from(letterAttachmentsTable)
    .where(inArray(letterAttachmentsTable.letterId, ids));
  const attachmentLetterIds = new Set(attachments.map((a) => a.letterId));

  const summaries = letters.map((letter) => {
    const content = letter.content as Record<string, unknown>;
    const blocks = (content.blocks as Array<{ data?: { text?: string } }>) ?? [];
    const excerpt =
      blocks
        .find((b) => b.data?.text)
        ?.data?.text?.slice(0, 150) ?? null;

    return {
      id: letter.id,
      title: letter.title,
      tagIds: allLetterTags
        .filter((t) => t.letterId === letter.id)
        .map((t) => t.tagId),
      authorId: letter.authorId,
      authorName: letter.authorName,
      createdAt: letter.createdAt.toISOString(),
      isRead: readSet.has(letter.id),
      hasAttachments: attachmentLetterIds.has(letter.id),
      excerpt,
    };
  });

  res.json(summaries);
});

router.post("/letters", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const { title, content, tagIds, attachments = [] } = req.body;

  if (!title || !content || !tagIds?.length) {
    res.status(400).json({ error: "title, content, tagIds are required" });
    return;
  }

  // Block non-admins from posting in admin-only channels
  if (tagIds?.length) {
    const tags = await db.select().from(tagsTable).where(inArray(tagsTable.id, tagIds));
    const adminOnlyTag = tags.find((t) => t.isAdminOnly);
    if (adminOnlyTag && !isAdmin(userId)) {
      res.status(403).json({ error: "This channel is read-only for non-admins" });
      return;
    }
  }

  // Resolve display name server-side from user_profiles — never trust the client body
  const profile = await getOrCreateProfile(userId);
  const authorName = profile.displayName ?? userId;

  const [letter] = await db
    .insert(lettersTable)
    .values({
      title,
      content,
      authorId: userId,
      authorName,
      reactions: {},
    })
    .returning();

  // Insert tag associations
  await db.insert(letterTagsTable).values(
    tagIds.map((tagId: number) => ({ letterId: letter.id, tagId })),
  );

  // Mark as read by author immediately
  await db
    .insert(letterReadsTable)
    .values({ letterId: letter.id, userId })
    .onConflictDoNothing();

  // Insert attachments
  let insertedAttachments: typeof letterAttachmentsTable.$inferSelect[] = [];
  if (attachments.length > 0) {
    insertedAttachments = await db
      .insert(letterAttachmentsTable)
      .values(
        attachments.map((a: { url: string; filename: string; mimeType: string; size: number }) => ({
          letterId: letter.id,
          url: a.url,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
        })),
      )
      .returning();
  }

  res.status(201).json({
    ...letter,
    content: letter.content,
    tagIds,
    createdAt: letter.createdAt.toISOString(),
    isRead: true,
    reactions: letter.reactions as Record<string, string[]>,
    attachments: insertedAttachments,
  });
});

router.get("/letters/:letterId", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const letterId = parseInt(req.params.letterId as string);

  const [letter] = await db
    .select()
    .from(lettersTable)
    .where(eq(lettersTable.id, letterId))
    .limit(1);

  if (!letter) {
    res.status(404).json({ error: "Letter not found" });
    return;
  }

  // Mark as read
  await db
    .insert(letterReadsTable)
    .values({ letterId, userId })
    .onConflictDoNothing();

  const letterTags = await db
    .select({ tagId: letterTagsTable.tagId })
    .from(letterTagsTable)
    .where(eq(letterTagsTable.letterId, letterId));

  const attachments = await db
    .select()
    .from(letterAttachmentsTable)
    .where(eq(letterAttachmentsTable.letterId, letterId));

  res.json({
    ...letter,
    content: letter.content,
    tagIds: letterTags.map((t) => t.tagId),
    createdAt: letter.createdAt.toISOString(),
    isRead: true,
    reactions: letter.reactions as Record<string, string[]>,
    attachments,
  });
});

router.delete("/letters/:letterId", requireAuth, async (req, res) => {
  const letterId = parseInt(req.params.letterId as string);
  await db.delete(lettersTable).where(eq(lettersTable.id, letterId));
  res.status(204).end();
});

router.post("/letters/:letterId/react", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const letterId = parseInt(req.params.letterId as string);
  const { emoji } = req.body;

  if (!emoji) {
    res.status(400).json({ error: "emoji is required" });
    return;
  }

  const [letter] = await db
    .select()
    .from(lettersTable)
    .where(eq(lettersTable.id, letterId))
    .limit(1);

  if (!letter) {
    res.status(404).json({ error: "Letter not found" });
    return;
  }

  const reactions = (letter.reactions as Record<string, string[]>) ?? {};
  const current = reactions[emoji] ?? [];
  const idx = current.indexOf(userId);
  if (idx >= 0) {
    current.splice(idx, 1);
    if (current.length === 0) delete reactions[emoji];
  } else {
    reactions[emoji] = [...current, userId];
  }

  const [updated] = await db
    .update(lettersTable)
    .set({ reactions })
    .where(eq(lettersTable.id, letterId))
    .returning();

  const letterTags = await db
    .select({ tagId: letterTagsTable.tagId })
    .from(letterTagsTable)
    .where(eq(letterTagsTable.letterId, letterId));

  const attachments = await db
    .select()
    .from(letterAttachmentsTable)
    .where(eq(letterAttachmentsTable.letterId, letterId));

  res.json({
    ...updated,
    content: updated.content,
    tagIds: letterTags.map((t) => t.tagId),
    createdAt: updated.createdAt.toISOString(),
    isRead: true,
    reactions: updated.reactions as Record<string, string[]>,
    attachments,
  });
});

// ---------------------------------------------------------------------------
// GET /letters/:letterId/comments
// ---------------------------------------------------------------------------

router.get("/letters/:letterId/comments", requireAuth, async (req, res) => {
  const letterId = parseInt(req.params.letterId as string);

  const comments = await db
    .select()
    .from(letterCommentsTable)
    .where(eq(letterCommentsTable.letterId, letterId))
    .orderBy(desc(letterCommentsTable.createdAt));

  res.json(
    comments.map((c) => ({
      id: c.id,
      letterId: c.letterId,
      userId: c.userId,
      authorName: c.authorName,
      content: c.content,
      createdAt: c.createdAt.toISOString(),
    })),
  );
});

// ---------------------------------------------------------------------------
// POST /letters/:letterId/comments
// ---------------------------------------------------------------------------

router.post("/letters/:letterId/comments", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const letterId = parseInt(req.params.letterId as string);
  const { content } = req.body;

  if (!content?.trim()) {
    res.status(400).json({ error: "content is required" });
    return;
  }

  // Resolve display name from user_profiles
  const profileRows = await db
    .select({ displayName: userProfilesTable.displayName })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId))
    .limit(1);
  const authorName = profileRows[0]?.displayName?.trim() || "Partner";

  const [comment] = await db
    .insert(letterCommentsTable)
    .values({ letterId, userId, authorName, content: content.trim() })
    .returning();

  res.status(201).json({
    id: comment.id,
    letterId: comment.letterId,
    userId: comment.userId,
    authorName: comment.authorName,
    content: comment.content,
    createdAt: comment.createdAt.toISOString(),
  });
});

export default router;

