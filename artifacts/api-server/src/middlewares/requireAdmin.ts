import type { Request, Response, NextFunction } from "express";
import type { AuthedRequest } from "./requireAuth";

/**
 * Admin detection: if ADMIN_USER_ID env var is set, only that user is admin.
 * If not set, all authenticated users are treated as admin (graceful default
 * so the app works out of the box before the env var is configured).
 */
export function isAdmin(userId: string): boolean {
  const adminId = process.env.ADMIN_USER_ID;
  if (!adminId) return true; // no restriction configured — everyone is admin
  return userId === adminId;
}

export const requireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const userId = (req as AuthedRequest).userId;
  if (!isAdmin(userId)) {
    res.status(403).json({ error: "Forbidden: admin only" });
    return;
  }
  next();
};
