import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { tagsTable } from "./tags";

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  tagId: integer("tag_id")
    .notNull()
    .references(() => tagsTable.id, { onDelete: "cascade" }),
  authorId: text("author_id").notNull(),
  /** Preferred display name shown in the chat UI. Never shows login credentials. */
  authorName: text("author_name").notNull(),
  /** System login identifier (email) stored for backend auditing only — never rendered in UI. */
  senderLoginName: text("sender_login_name"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  /** View-once photo: URL stored until viewed/expired, then cleared. */
  viewOnceUrl: text("view_once_url"),
  /** When the view-once photo expires (24 h after send). */
  viewOnceExpiresAt: timestamp("view_once_expires_at"),
  /** Timestamp when the partner first opened the view-once photo. */
  viewOnceViewedAt: timestamp("view_once_viewed_at"),
  /** UserId of the person who viewed the photo. */
  viewOnceViewedBy: text("view_once_viewed_by"),
});

// Track the last message each user has read in a chat channel
export const messageReadsTable = pgTable(
  "message_reads",
  {
    tagId: integer("tag_id")
      .notNull()
      .references(() => tagsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    lastReadMessageId: integer("last_read_message_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tagId, t.userId] })],
);

export type Message = typeof messagesTable.$inferSelect;
export type InsertMessage = typeof messagesTable.$inferInsert;
