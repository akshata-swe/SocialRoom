import type { Request, Response, NextFunction } from "express";
import { createClerkClient } from "@clerk/express";
import type { AuthedRequest } from "./requireAuth";

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

/**
 * Check whether an email address belongs to the designated admin.
 * If ADMIN_EMAIL is not set every authenticated user is treated as admin
 * so the app works out of the box before the env var is configured.
 */
export function isAdminByEmail(email: string): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return true;
  return email.trim().toLowerCase() === adminEmail.trim().toLowerCase();
}

/**
 * Async helper: resolve the Clerk email for a userId, then check admin.
 */
export async function isAdmin(userId: string): Promise<boolean> {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return true;
  try {
    const user = await clerkClient.users.getUser(userId);
    const email = user.emailAddresses[0]?.emailAddress ?? "";
    return isAdminByEmail(email);
  } catch {
    return false;
  }
}

export const requireAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const userId = (req as AuthedRequest).userId;
  const ok = await isAdmin(userId);
  if (!ok) {
    res.status(403).json({ error: "Forbidden: admin only" });
    return;
  }
  next();
};
