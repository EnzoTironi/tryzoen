import { Client } from "eve/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { NewConversation } from "./new-conversation";
const mocks = vi.hoisted(() => ({
  create: vi.fn<() => Promise<unknown>>(),
  send: vi.fn<(message: string) => Promise<unknown>>(),
  save: vi.fn<(id: string, title: string) => Promise<void>>(),
  created: vi.fn<(id: string) => void>(),
  submit: undefined as ((text: string) => Promise<void>) | undefined,
}));
vi.mock("eve/client", () => ({
  Client: class {
    sessions = { create: mocks.create };
  },
}));
vi.mock("./welcome", () => ({
  Welcome: ({ onSend }: { onSend: (text: string) => Promise<void> }) => {
    mocks.submit = onSend;
    return <div>Welcome</div>;
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({
    session: { state: { sessionId: "test-session" }, send: mocks.send },
  });
  mocks.send.mockResolvedValue({});
  mocks.save.mockResolvedValue(undefined);
  renderToStaticMarkup(
    <NewConversation
      client={new Client({ host: "" })}
      save={mocks.save}
      onCreated={mocks.created}
    />
  );
});
it("does not create a session until the user submits", () => {
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});
it("saves history before accepting the first turn and opening the conversation", async () => {
  await mocks.submit?.("Plan tomorrow");
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(
    "test-session",
    "Plan tomorrow"
  );
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith("Plan tomorrow");
  expect(mocks.created).toHaveBeenCalledExactlyOnceWith("test-session");
  expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.send.mock.invocationCallOrder[0] ?? 0
  );
});
it("preserves the draft and reuses the session after a history write fails", async () => {
  mocks.save.mockRejectedValueOnce(new Error("Offline"));
  await expect(mocks.submit?.("Keep this draft")).rejects.toThrow("Offline");
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.created).not.toHaveBeenCalled();
  await mocks.submit?.("Keep this draft");
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.send).toHaveBeenCalledTimes(1);
});
it("does not navigate on a rejected turn and retries without creating duplicate history", async () => {
  mocks.send.mockRejectedValueOnce(new Error("Turn rejected"));
  await expect(mocks.submit?.("Try this")).rejects.toThrow("Turn rejected");
  expect(mocks.created).not.toHaveBeenCalled();
  await mocks.submit?.("Try this");
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.save).toHaveBeenCalledTimes(1);
});
