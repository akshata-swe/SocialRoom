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
  authorName: text("author_name").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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
