import { Router } from "express";
import { db } from "@workspace/db";
import {
  messageReactionsTable,
  messagesTable,
  letterCommentsTable,
  lettersTable,
  userProfilesTable,
} from "@workspace/db";
import { eq, gt, and, ne, sql } from "drizzle-orm";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";

const router = Router();

// ---------------------------------------------------------------------------
// GET /notifications  — counts of new activity on your content since last seen
// ---------------------------------------------------------------------------

router.get("/notifications", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;

  // Get the user's last-seen timestamp
  const [profile] = await db
    .select({ lastActivitySeenAt: userProfilesTable.lastActivitySeenAt })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId))
    .limit(1);

  const since = profile?.lastActivitySeenAt ?? new Date(0);

  // Count new message reactions on messages authored by this user, from others, since last seen
  const [msgReactRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messageReactionsTable)
    .innerJoin(messagesTable, eq(messageReactionsTable.messageId, messagesTable.id))
    .where(
      and(
        eq(messagesTable.authorId, userId),
        ne(messageReactionsTable.userId, userId),
        gt(messageReactionsTable.createdAt, since),
      ),
    );

  // Count new letter comments on letters authored by this user, from others, since last seen
  const [commentRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(letterCommentsTable)
    .innerJoin(lettersTable, eq(letterCommentsTable.letterId, lettersTable.id))
    .where(
      and(
        eq(lettersTable.authorId, userId),
        ne(letterCommentsTable.userId, userId),
        gt(letterCommentsTable.createdAt, since),
      ),
    );

  // Count new letter reactions on letters authored by this user, from others, since last seen
  // Letter reactions are JSONB without timestamps — count comments as a proxy for "new activity"
  // We additionally return total letter reactions as a supplement
  const myLetters = await db
    .select({ reactions: lettersTable.reactions })
    .from(lettersTable)
    .where(eq(lettersTable.authorId, userId));

  let totalLetterReactions = 0;
  for (const { reactions } of myLetters) {
    const r = (reactions as Record<string, string[]>) ?? {};
    for (const userIds of Object.values(r)) {
      // Count only reactions from others
      totalLetterReactions += userIds.filter((uid) => uid !== userId).length;
    }
  }

  res.json({
    newMessageReactions: msgReactRow?.count ?? 0,
    newLetterComments: commentRow?.count ?? 0,
    totalLetterReactions,
    since: since.toISOString(),
  });
});

// ---------------------------------------------------------------------------
// POST /notifications/seen  — mark all activity as seen (update cursor)
// ---------------------------------------------------------------------------

router.post("/notifications/seen", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;

  await db
    .update(userProfilesTable)
    .set({ lastActivitySeenAt: new Date() })
    .where(eq(userProfilesTable.userId, userId));

  res.status(204).end();
});

export default router;
