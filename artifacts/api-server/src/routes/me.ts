import { Router } from "express";
import { getAuth, createClerkClient } from "@clerk/express";
import { requireAuth } from "../middlewares/requireAuth";
import { isAdminByEmail } from "../middlewares/requireAdmin";
import { getOrCreateProfile } from "./profile";

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

const router = Router();

/**
 * GET /me
 *
 * Returns the current user's identity as seen by the application.
 * - displayName  comes from user_profiles (the name they set in onboarding)
 * - isProfileComplete gates the onboarding flow on the frontend
 * - email is returned for the profile page but MUST NOT be rendered in chat UI
 */
router.get("/me", requireAuth, async (req, res) => {
  const auth = getAuth(req);
  const userId = auth!.userId!;

  let email = "";
  try {
    const clerkUser = await clerkClient.users.getUser(userId);
    email = clerkUser.emailAddresses[0]?.emailAddress ?? "";
  } catch {
    // Non-fatal — email is not shown in UI anyway
  }

  // user_profiles is the canonical source for displayName and isProfileComplete
  const profile = await getOrCreateProfile(userId);

  res.json({
    id: userId,
    email,                                   // kept for admin/audit; never shown in chat
    displayName: profile.displayName,        // the name shown everywhere in the UI
    isProfileComplete: profile.isProfileComplete,
    avatarUrl: null,
    isAdmin: isAdminByEmail(email),
  });
});

export default router;
