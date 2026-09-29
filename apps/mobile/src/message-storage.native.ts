import { openDatabaseAsync } from "expo-sqlite";
import type { MessageStorage } from "@zoen/companion-ui/local-messages";

const openMessages = async () => {
  const db = await openDatabaseAsync("local-messages.db");
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (scope TEXT PRIMARY KEY, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS messages (scope TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY (scope, id));
  `);
  return db;
};

let connection: ReturnType<typeof openMessages> | undefined;
function database() {
  connection ??= openMessages().catch((error: unknown) => {
    connection = undefined;
    throw error;
  });
  return connection;
}

export function mobileMessageStorage(scope: string): MessageStorage {
  return {
    async read() {
      const db = await database();
      await db.runAsync(
        "INSERT OR IGNORE INTO sessions (scope) VALUES (?)",
        scope
      );
      const session = await db.getFirstAsync<{ revoked: number }>(
        "SELECT revoked FROM sessions WHERE scope = ?",
        scope
      );
      if (session?.revoked !== 0) throw new Error("The account was closed.");
      const rows = await db.getAllAsync<{ value: string }>(
        "SELECT value FROM messages WHERE scope = ? LIMIT 201",
        scope
      );
      if (rows.length > 200)
        throw new Error("Local message storage limit exceeded.");
      return rows.map((row) => row.value);
    },
    async write(changes) {
      const db = await database();
      await db.withExclusiveTransactionAsync(async (transaction) => {
        const session = await transaction.getFirstAsync<{ revoked: number }>(
          "SELECT revoked FROM sessions WHERE scope = ?",
          scope
        );
        if (session?.revoked !== 0) throw new Error("The account was closed.");
        for (const [id, value] of changes) {
          if (value === null)
            await transaction.runAsync(
              "DELETE FROM messages WHERE scope = ? AND id = ?",
              scope,
              id
            );
          else
            await transaction.runAsync(
              "INSERT OR REPLACE INTO messages (scope, id, value, bytes) VALUES (?, ?, ?, ?)",
              scope,
              id,
              value,
              value.length * 2
            );
        }
        const usage = await transaction.getFirstAsync<{
          count: number;
          bytes: number;
        }>(
          "SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes FROM messages WHERE scope = ?",
          scope
        );
        if (!usage || usage.count > 200 || usage.bytes > 32 * 1024 * 1024)
          throw new Error("Local message storage is full.");
      });
    },
  };
}

export async function clearMobileMessages() {
  const db = await database();
  await db.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.execAsync(
      "UPDATE sessions SET revoked = 1; DELETE FROM messages;"
    );
  });
}
