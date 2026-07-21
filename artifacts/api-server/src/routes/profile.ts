import { Router } from "express";
import { createClerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { userProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";

const router = Router();

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Upsert a bare user_profiles row the first time we see a userId.
 * Pre-populates displayName from Clerk so returning users who skipped
 * onboarding still have something reasonable. isProfileComplete stays false
 * until the user explicitly submits the onboarding form.
 */
async function getOrCreateProfile(userId: string) {
  const existing = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId))
    .limit(1);

  if (existing.length > 0) return existing[0];

  // First time — seed displayName from Clerk metadata
  let seedName = "";
  try {
    const clerkUser = await clerkClient.users.getUser(userId);
    seedName =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      clerkUser.emailAddresses[0]?.emailAddress?.split("@")[0] ||
      "";
  } catch {
    // Non-fatal
  }

  const [created] = await db
    .insert(userProfilesTable)
    .values({ userId, displayName: seedName, isProfileComplete: false })
    .returning();

  return created;
}

// ---------------------------------------------------------------------------
// GET /profile  — fetch the current user's profile (creates one if new)
// ---------------------------------------------------------------------------

router.get("/profile", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const profile = await getOrCreateProfile(userId);
  res.json(profile);
});

// ---------------------------------------------------------------------------
// PATCH /profile  — update displayName and mark profile complete
// ---------------------------------------------------------------------------

router.patch("/profile", requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const { displayName } = req.body;

  if (!displayName || typeof displayName !== "string" || !displayName.trim()) {
    res.status(400).json({ error: "displayName must be a non-empty string" });
    return;
  }

  const trimmed = displayName.trim();

  // Upsert — handles both first-time and returning users
  const [updated] = await db
    .insert(userProfilesTable)
    .values({
      userId,
      displayName: trimmed,
      isProfileComplete: true,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userProfilesTable.userId,
      set: {
        displayName: trimmed,
        isProfileComplete: true,
        updatedAt: new Date(),
      },
    })
    .returning();

  res.json(updated);
});

export { getOrCreateProfile };
export default router;
