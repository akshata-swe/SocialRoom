import { Router } from "express";
import { createClerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { userProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

const router = Router();

// ---------------------------------------------------------------------------
// GET /admin/users
// Returns all users from user_profiles joined with their Clerk email.
// Admin only.
// ---------------------------------------------------------------------------

router.get("/admin/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const profiles = await db.select().from(userProfilesTable);

    // Fetch Clerk data for each user in parallel
    const users = await Promise.all(
      profiles.map(async (profile) => {
        let email = "";
        try {
          const clerkUser = await clerkClient.users.getUser(profile.userId);
          email = clerkUser.emailAddresses[0]?.emailAddress ?? "";
        } catch {
          // Non-fatal — user may have been deleted from Clerk already
        }
        return {
          userId: profile.userId,
          displayName: profile.displayName,
          isProfileComplete: profile.isProfileComplete,
          email,
        };
      }),
    );

    res.json(users);
  } catch (err) {
    console.error("[admin/users GET]", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// ---------------------------------------------------------------------------
// DELETE /admin/users/:userId
// Deletes a user from Clerk and removes their profile row.
// Admin cannot delete themselves.
// ---------------------------------------------------------------------------

router.delete(
  "/admin/users/:userId",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { userId } = req as AuthedRequest;
    const targetId = req.params.userId;

    if (targetId === userId) {
      res.status(400).json({ error: "You cannot delete your own account" });
      return;
    }

    try {
      // Delete from Clerk first (may throw if user doesn't exist — that's fine)
      await clerkClient.users.deleteUser(targetId);
    } catch (err: any) {
      // If user is already gone from Clerk, continue to clean up the DB row
      if (!err?.status || err.status !== 404) {
        console.error("[admin/users DELETE] Clerk error", err);
        res.status(500).json({ error: "Failed to delete user from auth provider" });
        return;
      }
    }

    // Remove from our DB
    await db
      .delete(userProfilesTable)
      .where(eq(userProfilesTable.userId, targetId));

    res.json({ success: true });
  },
);

export default router;
