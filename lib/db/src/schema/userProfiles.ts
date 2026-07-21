import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * One row per Clerk user. Created on first /profile GET (or /me) after sign-up.
 *
 * displayName  — the preferred name the user chooses in the onboarding flow.
 *                This is the ONLY name shown in the chat UI; Clerk email/username
 *                is never rendered in the application UI.
 *
 * isProfileComplete — false until the user submits the onboarding form.
 *                     The frontend gates the main workspace behind this flag.
 */
export const userProfilesTable = pgTable("user_profiles", {
  userId: text("user_id").primaryKey(),
  displayName: text("display_name").notNull().default(""),
  isProfileComplete: boolean("is_profile_complete").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  /** Timestamp of the last time the user acknowledged activity notifications. */
  lastActivitySeenAt: timestamp("last_activity_seen_at").notNull().defaultNow(),
});

export type UserProfile = typeof userProfilesTable.$inferSelect;
export type InsertUserProfile = typeof userProfilesTable.$inferInsert;
