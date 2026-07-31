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
// GET /notifications  — counts of new activity for the current user since
// they last visited the landing page (lastActivitySeenAt cursor).
//
// Returns:
//   newMessages        — chat messages from the partner posted since last seen
//   newLetters         — letters from the partner posted since last seen
//   newMessageReactions — reactions on your chat messages from the partner
//   newLetterComments   — notes on your letters from the partner
//   totalLetterReactions — total reactions from the partner on your letters
// ---------------------------------------------------------------------------

router.get("/notifications", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;

  // Fetch the user's last-seen cursor
  const [profile] = await db
    .select({ lastActivitySeenAt: userProfilesTable.lastActivitySeenAt })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId))
    .limit(1);

  const since = profile?.lastActivitySeenAt ?? new Date(0);

  // ── New chat messages from the partner ────────────────────────────────────
  const [newMsgRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messagesTable)
    .where(
      and(
        ne(messagesTable.authorId, userId),   // not sent by me
        gt(messagesTable.createdAt, since),   // since I last looked
      ),
    );

  // ── New letters from the partner ─────────────────────────────────────────
  const [newLetterRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(lettersTable)
    .where(
      and(
        ne(lettersTable.authorId, userId),    // not written by me
        gt(lettersTable.createdAt, since),    // since I last looked
      ),
    );

  // ── New reactions on my chat messages from the partner ───────────────────
  const [msgReactRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messageReactionsTable)
    .innerJoin(messagesTable, eq(messageReactionsTable.messageId, messagesTable.id))
    .where(
      and(
        eq(messagesTable.authorId, userId),           // on my messages
        ne(messageReactionsTable.userId, userId),     // from the partner
        gt(messageReactionsTable.createdAt, since),
      ),
    );

  // ── New notes (comments) on my letters from the partner ──────────────────
  const [commentRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(letterCommentsTable)
    .innerJoin(lettersTable, eq(letterCommentsTable.letterId, lettersTable.id))
    .where(
      and(
        eq(lettersTable.authorId, userId),            // on my letters
        ne(letterCommentsTable.userId, userId),       // from the partner
        gt(letterCommentsTable.createdAt, since),
      ),
    );

  // ── Total letter reactions from the partner (JSONB — no timestamp) ───────
  const myLetters = await db
    .select({ reactions: lettersTable.reactions })
    .from(lettersTable)
    .where(eq(lettersTable.authorId, userId));

  let totalLetterReactions = 0;
  for (const { reactions } of myLetters) {
    const r = (reactions as Record<string, string[]>) ?? {};
    for (const userIds of Object.values(r)) {
      totalLetterReactions += userIds.filter((uid) => uid !== userId).length;
    }
  }

  res.json({
    newMessages: newMsgRow?.count ?? 0,
    newLetters: newLetterRow?.count ?? 0,
    newMessageReactions: msgReactRow?.count ?? 0,
    newLetterComments: commentRow?.count ?? 0,
    totalLetterReactions,
    since: since.toISOString(),
  });
});

// ---------------------------------------------------------------------------
// POST /notifications/seen  — advance the cursor to now
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
