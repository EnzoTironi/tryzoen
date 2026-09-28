import { Client } from "eve/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { NewConversation } from "./new-conversation";
import { replyMessage } from "./session/reply";
const mocks = vi.hoisted(() => ({
  create: vi.fn<(input: { message: string }) => Promise<unknown>>(),
  send: vi.fn<(message: string) => Promise<unknown>>(),
  save: vi.fn<(id: string, title: string) => Promise<void>>(),
  created: vi.fn<(id: string, draft?: string) => void>(),
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
it("keeps a Feed reference in the turn while naming the conversation after the user's question", async () => {
  const message = replyMessage("Can I read for five minutes?", {
    id: "feed:123",
    role: "assistant",
    text: "A reading routine",
  });
  await mocks.submit?.(message);
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ message });
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(
    "test-session",
    "Can I read for five minutes?"
  );
});
it("creates the first turn with its session before saving the title and navigating", async () => {
  await mocks.submit?.("Plan tomorrow");
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(
    "test-session",
    "Plan tomorrow"
  );
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
    message: "Plan tomorrow",
  });
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.created).toHaveBeenCalledExactlyOnceWith(
    "test-session",
    undefined
  );
  expect(mocks.create.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.save.mock.invocationCallOrder[0] ?? 0
  );
});
it("preserves the draft and reuses the session after a history write fails", async () => {
  mocks.save.mockRejectedValueOnce(new Error("Offline"));
  await expect(mocks.submit?.("Keep this draft")).rejects.toThrow("Offline");
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.created).not.toHaveBeenCalled();
  await mocks.submit?.("Keep this draft");
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.send).not.toHaveBeenCalled();
});
it("does not save or navigate when the first turn is rejected and allows retry", async () => {
  mocks.create.mockRejectedValueOnce(new Error("Turn rejected"));
  await expect(mocks.submit?.("Try this")).rejects.toThrow("Turn rejected");
  expect(mocks.created).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  await mocks.submit?.("Try this");
  expect(mocks.create).toHaveBeenCalledTimes(2);
  expect(mocks.save).toHaveBeenCalledTimes(1);
});
it("preserves an edited draft when recovering an already accepted first turn", async () => {
  mocks.save.mockRejectedValueOnce(new Error("Offline"));
  await expect(mocks.submit?.("Original request")).rejects.toThrow("Offline");
  await mocks.submit?.("A revised request");
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
    message: "Original request",
  });
  expect(mocks.save).toHaveBeenLastCalledWith(
    "test-session",
    "Original request"
  );
  expect(mocks.created).toHaveBeenCalledExactlyOnceWith(
    "test-session",
    "A revised request"
  );
  expect(mocks.send).not.toHaveBeenCalled();
});
