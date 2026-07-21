import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { lettersTable } from "./letters";

export const letterCommentsTable = pgTable("letter_comments", {
  id: serial("id").primaryKey(),
  letterId: integer("letter_id")
    .notNull()
    .references(() => lettersTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  authorName: text("author_name").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type LetterComment = typeof letterCommentsTable.$inferSelect;
export type InsertLetterComment = typeof letterCommentsTable.$inferInsert;
