import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";
import { tagsTable } from "./tags";

export const lettersTable = pgTable("letters", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: jsonb("content").notNull().default({}),
  authorId: text("author_id").notNull(),
  authorName: text("author_name").notNull(),
  reactions: jsonb("reactions").notNull().default({}), // { emoji: userId[] }
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const letterTagsTable = pgTable(
  "letter_tags",
  {
    letterId: integer("letter_id")
      .notNull()
      .references(() => lettersTable.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tagsTable.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.letterId, t.tagId] })],
);

export const letterReadsTable = pgTable(
  "letter_reads",
  {
    letterId: integer("letter_id")
      .notNull()
      .references(() => lettersTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    readAt: timestamp("read_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.letterId, t.userId] })],
);

export const letterAttachmentsTable = pgTable("letter_attachments", {
  id: serial("id").primaryKey(),
  letterId: integer("letter_id")
    .notNull()
    .references(() => lettersTable.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
});

export type Letter = typeof lettersTable.$inferSelect;
export type InsertLetter = typeof lettersTable.$inferInsert;
export type LetterAttachment = typeof letterAttachmentsTable.$inferSelect;
export type InsertLetterAttachment =
  typeof letterAttachmentsTable.$inferInsert;
