import { Router } from "express";
import { getAuth, createClerkClient } from "@clerk/express";
import { requireAuth } from "../middlewares/requireAuth";

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

const router = Router();

router.get("/me", requireAuth, async (req, res) => {
  const auth = getAuth(req);
  const userId = auth!.userId!;

  try {
    const user = await clerkClient.users.getUser(userId);
    const displayName =
      [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      user.emailAddresses[0]?.emailAddress?.split("@")[0] ||
      "Partner";

    res.json({
      id: userId,
      email: user.emailAddresses[0]?.emailAddress ?? "",
      displayName,
      avatarUrl: user.imageUrl ?? null,
    });
  } catch {
    // Fallback if clerk client fails
    res.json({
      id: userId,
      email: "",
      displayName: "Partner",
      avatarUrl: null,
    });
  }
});

export default router;
