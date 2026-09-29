import { createContext, useContext } from "react";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { z } from "zod";

/** Platform storage is scoped to one authenticated session, never a credential. */
export interface MessageStorage {
  read: () => Promise<readonly string[]>;
  write: (
    changes: readonly (readonly [string, string | null])[]
  ) => Promise<void>;
}

const recordSchema = z.object({
  version: z.literal(1),
  key: z
    .array(z.union([z.string(), z.null()]))
    .min(3)
    .max(4),
  data: z.unknown(),
});
export const outgoingSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  status: z.enum(["sending", "accepted", "failed"]),
  input: z.unknown(),
  receipt: z.unknown().optional(),
  recovered: z.boolean().optional(),
});
const prefixes = new Set([
  "agent-draft",
  "matrix-draft",
  "agent-outbox",
  "matrix-outbox",
]);

/** Persist only authored drafts and delivery records; server caches stay separate. */
export class MessagePersistence {
  private writes = Promise.resolve();
  private pending = new Map<string, string | null>();
  private scheduled = false;
  private values = new Map<string, string>();
  private active = true;
  private failures = new Map<string, { value: string | null; error: Error }>();
  private unsubscribe?: () => void;

  constructor(
    private readonly client: QueryClient,
    private readonly storage: MessageStorage,
    private readonly onError: (message: string) => void
  ) {}

  async restore() {
    const records = await this.storage.read();
    if (!this.active) return;
    const queues = new Map<
      string,
      { key: QueryKey; entries: z.infer<typeof outgoingSchema>[] }
    >();
    for (const value of records) {
      const record = recordSchema.parse(JSON.parse(value));
      if (!prefixes.has(record.key[0] ?? "")) continue;
      const hash = JSON.stringify(record.key);
      this.client.setQueryDefaults(record.key, { gcTime: Infinity });
      if (record.key[0]?.endsWith("-draft")) {
        this.values.set(hash, value);
        this.client.setQueryData(record.key, record.data);
      } else {
        const entry = outgoingSchema.parse(record.data);
        this.values.set(JSON.stringify([...record.key, entry.id]), value);
        const queue = queues.get(hash) ?? { key: record.key, entries: [] };
        // Matrix PUTs are idempotent. Eve has no public delivery idempotency key:
        // a lost acknowledgement needs human review, never automatic replay.
        const recoverable = record.key[0] === "matrix-outbox";
        queue.entries.push({
          ...entry,
          status:
            recoverable || entry.status === "sending" ? "failed" : entry.status,
          recovered: recoverable,
        });
        queues.set(hash, queue);
      }
    }
    for (const { key, entries } of queues.values()) {
      entries.sort((a, b) => a.createdAt - b.createdAt);
      this.client.setQueryData(key, entries);
    }
    this.unsubscribe = this.client.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      const key = recordSchema.shape.key.safeParse(event.query.queryKey);
      if (!key.success || !prefixes.has(String(key.data[0]))) return;
      this.save(key.data, event.query.state.data);
    });
  }

  private save(key: QueryKey, data: unknown) {
    const hash = JSON.stringify(key);
    this.client.setQueryDefaults(key, { gcTime: Infinity });
    const next = new Map<string, string>();
    if (String(key[0]).endsWith("-outbox")) {
      for (const entry of z.array(outgoingSchema).parse(data))
        next.set(
          JSON.stringify([...key, entry.id]),
          JSON.stringify({ version: 1, key, data: entry })
        );
    } else if (
      data &&
      (typeof data !== "object" ||
        !("text" in data) ||
        data.text ||
        ("files" in data && Array.isArray(data.files) && data.files.length) ||
        ("reply" in data && data.reply))
    ) {
      next.set(hash, JSON.stringify({ version: 1, key, data }));
    }
    // Individual records prevent another tab's send from replacing this queue.
    const prefix = `${hash.slice(0, -1)},`;
    for (const id of this.values.keys()) {
      if ((id === hash || id.startsWith(prefix)) && !next.has(id))
        this.write(id, null);
    }
    for (const [id, value] of next) {
      if (this.values.get(id) !== value) this.write(id, value);
    }
  }

  private write(id: string, value: string | null) {
    this.pending.set(id, value);
    if (!this.scheduled) {
      this.scheduled = true;
      this.writes = this.writes.then(async () => {
        const changes = [...this.pending];
        this.pending.clear();
        this.scheduled = false;
        try {
          await this.storage.write(changes);
          for (const [key] of changes) this.failures.delete(key);
          if (this.failures.size === 0) this.onError("");
        } catch (cause) {
          for (const [key, failedValue] of changes)
            this.failures.set(key, {
              value: failedValue,
              error:
                cause instanceof Error
                  ? cause
                  : new Error("Local storage unavailable"),
            });
          this.onError(
            "Não foi possível salvar neste dispositivo. Mantenha o app aberto e libere espaço para tentar novamente."
          );
        }
        return;
      });
    }
    if (value === null) this.values.delete(id);
    else this.values.set(id, value);
  }

  async flush() {
    await this.writes;
    if (!this.active) throw new Error("The account was closed.");
    // Retry a failed atomic batch once. A failed draft removal must not leave
    // an otherwise recoverable outbox permanently blocked after disk space returns.
    if (this.failures.size) {
      for (const [id, failed] of this.failures) this.write(id, failed.value);
      await this.writes;
    }
    const failure = this.failures.values().next().value;
    if (failure) throw failure.error;
  }

  close() {
    this.active = false;
    this.unsubscribe?.();
  }
}

export const LocalMessagesContext = createContext<
  MessagePersistence | undefined
>(undefined);
export const useLocalMessages = () => useContext(LocalMessagesContext);
