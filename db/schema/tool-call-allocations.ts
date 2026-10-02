import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/** One nonsecret key fingerprint makes replacement fail closed rather than
 * presenting keyed actor/native identities as a fresh unused installation.
 */
export const toolCallAccounting = pgTable(
  "tool_call_accounting",
  {
    id: integer("id").primaryKey().default(1),
    keyFingerprint: text("key_fingerprint").notNull(),
  },
  (t) => [
    unique("tool_call_accounting_key_unique").on(t.id, t.keyFingerprint),
    check("tool_call_accounting_singleton_check", sql`${t.id} = 1`),
    check(
      "tool_call_accounting_key_check",
      sql`${t.keyFingerprint} ~ '^[0-9a-f]{64}$'`
    ),
  ]
);

/** Quota allocations contain only keyed opaque identities and counts. They
 * have no owner/connector FK: deleting a connector must not refund spent work
 * or an unknown hold. This is accounting, never another execution/result store.
 */
export const toolCallAllocations = pgTable(
  "tool_call_allocations",
  {
    id: uuid("id").primaryKey(),
    accountingId: integer("accounting_id").notNull().default(1),
    keyFingerprint: text("key_fingerprint").notNull(),
    operationHash: text("operation_hash").notNull(),
    requestHash: text("request_hash").notNull(),
    actorHash: text("actor_hash").notNull(),
    payerHash: text("payer_hash").notNull(),
    windowDate: date("window_date").notNull(),
    status: text("status", {
      enum: ["reserved", "uncertain", "settled"],
    }).notNull(),
    consumedCalls: integer("consumed_calls"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true, precision: 3 }),
  },
  (t) => [
    foreignKey({
      name: "tool_call_allocations_accounting_key_fkey",
      columns: [t.accountingId, t.keyFingerprint],
      foreignColumns: [
        toolCallAccounting.id,
        toolCallAccounting.keyFingerprint,
      ],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("tool_call_allocations_operation_uidx").on(t.operationHash),
    index("tool_call_allocations_actor_window_idx").on(
      t.actorHash,
      t.windowDate
    ),
    check(
      "tool_call_allocations_hashes_check",
      sql`${t.operationHash} ~ '^[0-9a-f]{64}$' AND ${t.requestHash} ~ '^[0-9a-f]{64}$' AND ${t.actorHash} ~ '^[0-9a-f]{64}$' AND ${t.payerHash} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "tool_call_allocations_state_check",
      sql`CASE
    WHEN ${t.status} = 'settled' THEN ${t.consumedCalls} IS NOT NULL AND ${t.consumedCalls} IN (0,1) AND ${t.settledAt} IS NOT NULL
    WHEN ${t.status} IN ('reserved', 'uncertain') THEN ${t.consumedCalls} IS NULL AND ${t.settledAt} IS NULL
    ELSE false END`
    ),
  ]
);
