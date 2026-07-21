import { pgTable, serial, text, integer } from "drizzle-orm/pg-core";
import { spacesTable } from "./spaces";

export const tagsTable = pgTable("tags", {
  id: serial("id").primaryKey(),
  spaceId: integer("space_id")
    .notNull()
    .references(() => spacesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  type: text("type").notNull().$type<"postbox" | "chat">(),
  icon: text("icon"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export type Tag = typeof tagsTable.$inferSelect;
export type InsertTag = typeof tagsTable.$inferInsert;
