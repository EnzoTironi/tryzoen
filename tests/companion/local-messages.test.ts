import * as indexedDBGlobals from "fake-indexeddb";
import { QueryClient } from "@tanstack/react-query";
import { afterAll, expect, it, vi } from "vitest";
import { MessagePersistence } from "../../packages/companion-ui/src/conversation/persistence";
import {
  browserMessageStorage,
  clearBrowserMessages,
} from "../../web/trpc/message-storage";

for (const [name, value] of Object.entries(indexedDBGlobals))
  if (name === "indexedDB" || name.startsWith("IDB"))
    vi.stubGlobal(name, value);
afterAll(() => {
  vi.unstubAllGlobals();
});

const draftKey = ["agent-draft", "person:workspace:login", "session"];
const roomKey = ["matrix-outbox", "person:workspace", "room"];
const agentKey = ["agent-outbox", "person:workspace:login", "session"];
const draft = { text: "Retained draft", files: [] };
const outgoing = {
  id: "operation",
  input: { text: "Hello", operationId: "operation" },
  status: "sending",
  createdAt: 1,
};

it("restores private drafts and delivery identities, but never auto-replays an uncertain agent submission", async () => {
  const storage = browserMessageStorage(crypto.randomUUID());
  const client = new QueryClient();
  const first = new MessagePersistence(
    client,
    storage,
    vi.fn<(message: string) => void>()
  );
  await first.restore();
  client.setQueryData(draftKey, draft);
  client.setQueryData(roomKey, [outgoing]);
  client.setQueryData(agentKey, [
    { ...outgoing, input: { message: "Hello", streamIndex: 1 } },
  ]);
  client.setQueryData(["credentials"], { secret: "must never be persisted" });
  await first.flush();
  first.close();
  const reopened = new QueryClient();
  const second = new MessagePersistence(
    reopened,
    storage,
    vi.fn<(message: string) => void>()
  );
  await second.restore();
  expect(reopened.getQueryData(draftKey)).toEqual(draft);
  expect(reopened.getQueryData(roomKey)).toEqual([
    expect.objectContaining({
      id: "operation",
      status: "failed",
      recovered: true,
    }),
  ]);
  expect(reopened.getQueryData(agentKey)).toEqual([
    expect.objectContaining({ status: "failed", recovered: false }),
  ]);
  expect(reopened.getQueryData(["credentials"])).toBeUndefined();
  second.close();
  client.clear();
  reopened.clear();
});

it("commits draft removal and enqueue atomically before delivery may proceed", async () => {
  const storage = browserMessageStorage(crypto.randomUUID());
  const client = new QueryClient();
  const persistence = new MessagePersistence(
    client,
    storage,
    vi.fn<(message: string) => void>()
  );
  await persistence.restore();
  client.setQueryData(draftKey, draft);
  await persistence.flush();
  const write = vi.spyOn(storage, "write");
  client.setQueryData(roomKey, [outgoing]);
  client.setQueryData(draftKey, { text: "", files: [] });
  await persistence.flush();
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0]?.[0]).toHaveLength(2);
  expect(await storage.read()).toHaveLength(1);
  persistence.close();
  client.clear();
});

it("keeps another tab's queue entry when this tab changes or settles its own", async () => {
  const storage = browserMessageStorage(crypto.randomUUID());
  const a = new QueryClient();
  const b = new QueryClient();
  const first = new MessagePersistence(
    a,
    storage,
    vi.fn<(message: string) => void>()
  );
  const second = new MessagePersistence(
    b,
    storage,
    vi.fn<(message: string) => void>()
  );
  await first.restore();
  await second.restore();
  a.setQueryData(roomKey, [outgoing]);
  b.setQueryData(roomKey, [{ ...outgoing, id: "second" }]);
  await Promise.all([first.flush(), second.flush()]);
  a.setQueryData(roomKey, []);
  await first.flush();
  expect(await storage.read()).toEqual([
    expect.stringContaining('"id":"second"'),
  ]);
  first.close();
  second.close();
  a.clear();
  b.clear();
});

it("isolates sessions, revokes late writes on logout, and leaves a new login usable", async () => {
  const first = browserMessageStorage(crypto.randomUUID());
  const other = browserMessageStorage(crypto.randomUUID());
  await first.read();
  await other.read();
  await first.write([["draft", "private"]]);
  expect(await other.read()).toEqual([]);
  await clearBrowserMessages();
  await expect(first.write([["late", "must not return"]])).rejects.toThrow(
    "closed"
  );
  await expect(first.read()).rejects.toThrow("Sign in again");
  const newLogin = browserMessageStorage(crypto.randomUUID());
  expect(await newLogin.read()).toEqual([]);
  await newLogin.write([["new", "works"]]);
  expect(await newLogin.read()).toEqual(["works"]);
});

it("rejects quota overflow atomically without deleting the existing draft", async () => {
  const storage = browserMessageStorage(crypto.randomUUID());
  await storage.read();
  await storage.write([["draft", "keep"]]);
  const overflow = Array.from(
    { length: 201 },
    (_, index) => [String(index), "value"] as const
  );
  await expect(storage.write([["draft", null], ...overflow])).rejects.toThrow(
    "full"
  );
  expect(await storage.read()).toEqual(["keep"]);
});

it("does not allow an unrelated successful write to hide a failed outbox commit", async () => {
  const storage = browserMessageStorage(crypto.randomUUID());
  const client = new QueryClient();
  const error = vi.fn<(message: string) => void>();
  const persistence = new MessagePersistence(client, storage, error);
  await persistence.restore();
  const originalWrite = storage.write;
  const write = vi
    .spyOn(storage, "write")
    .mockImplementation(async (changes) => {
      if (changes.some(([id, value]) => id.includes("matrix-outbox") && value))
        throw new Error("Disk full");
      await originalWrite(changes);
    });
  client.setQueryData(roomKey, [outgoing]);
  await expect(persistence.flush()).rejects.toThrow("Disk full");
  client.setQueryData(draftKey, draft);
  await expect(persistence.flush()).rejects.toThrow("Disk full");
  expect(error).toHaveBeenCalledWith(expect.stringContaining("salvar"));
  write.mockImplementation(originalWrite);
  await persistence.flush();
  expect(await storage.read()).toHaveLength(2);
  persistence.close();
  client.clear();
});
