import { pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { agentSessions } from "./sessions";

// Eve owns messages; these are the conversation owner's product annotations.
export const messageReactions = pgTable(
  "message_reactions",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSessions.sessionId, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    emoji: text("emoji").notNull(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.messageId] })]
);
