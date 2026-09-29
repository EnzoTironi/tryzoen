import { openDB, type DBSchema } from "idb";
import type { MessageStorage } from "@zoen/companion-ui/local-messages";

interface MessageDatabase extends DBSchema {
  records: {
    key: [string, string];
    value: { scope: string; id: string; value: string };
    indexes: { scope: string };
  };
  sessions: {
    key: string;
    value: { revoked: boolean; count: number; bytes: number };
  };
}

const openMessages = () =>
  openDB<MessageDatabase>("zoen-local-messages", 1, {
    upgrade(db) {
      const records = db.createObjectStore("records", {
        keyPath: ["scope", "id"],
      });
      records.createIndex("scope", "scope");
      db.createObjectStore("sessions");
    },
  });

let connection: ReturnType<typeof openMessages> | undefined;
function database() {
  connection ??= openMessages().catch((error: unknown) => {
    connection = undefined;
    throw error;
  });
  return connection;
}

export function browserMessageStorage(scope: string): MessageStorage {
  return {
    async read() {
      const db = await database();
      const transaction = db.transaction(["records", "sessions"], "readwrite");
      const session = await transaction.objectStore("sessions").get(scope);
      if (session?.revoked)
        throw new Error("Sign in again to recover local messages.");
      if (!session)
        await transaction
          .objectStore("sessions")
          .put({ revoked: false, count: 0, bytes: 0 }, scope);
      const records = await transaction
        .objectStore("records")
        .index("scope")
        .getAll(scope, 201);
      await transaction.done;
      if (records.length > 200)
        throw new Error("Local message storage limit exceeded.");
      return records.map((record) => record.value);
    },
    async write(changes) {
      const db = await database();
      const transaction = db.transaction(["records", "sessions"], "readwrite");
      const sessions = transaction.objectStore("sessions");
      const session = await sessions.get(scope);
      if (!session || session.revoked)
        throw new Error("The account was closed.");
      const records = transaction.objectStore("records");
      let { count, bytes } = session;
      for (const [id, value] of changes) {
        const previous = await records.get([scope, id]);
        count += Number(value !== null) - Number(Boolean(previous));
        bytes += (value?.length ?? 0) * 2 - (previous?.value.length ?? 0) * 2;
      }
      if (count > 200 || bytes > 32 * 1024 * 1024)
        throw new Error("Local message storage is full.");
      for (const [id, value] of changes) {
        if (value === null) await records.delete([scope, id]);
        else await records.put({ scope, id, value });
      }
      await sessions.put({ revoked: false, count, bytes }, scope);
      await transaction.done;
    },
  };
}

/** Revocation and deletion share a transaction, including writes from other tabs. */
export async function clearBrowserMessages() {
  const db = await database();
  const transaction = db.transaction(["records", "sessions"], "readwrite");
  const sessions = transaction.objectStore("sessions");
  for (const scope of await sessions.getAllKeys())
    await sessions.put({ revoked: true, count: 0, bytes: 0 }, scope);
  await transaction.objectStore("records").clear();
  await transaction.done;
}
