import { pgTable, serial, text, integer } from "drizzle-orm/pg-core";

export const spacesTable = pgTable("spaces", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export type Space = typeof spacesTable.$inferSelect;
export type InsertSpace = typeof spacesTable.$inferInsert;
