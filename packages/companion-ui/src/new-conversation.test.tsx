import { Client } from "eve/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { NewConversation } from "./new-conversation";
import type { ConversationDraft } from "./session/input";
import type { UserContent } from "ai";
import { replyMessage } from "./session/reply";
const mocks = vi.hoisted(() => ({
  create:
    vi.fn<(input: { message: string | UserContent }) => Promise<unknown>>(),
  send: vi.fn<(message: string) => Promise<unknown>>(),
  save: vi.fn<(id: string, title: string) => Promise<void>>(),
  created: vi.fn<(id: string, draft?: ConversationDraft) => void>(),
  submit: undefined as
    | ((message: ConversationDraft) => Promise<void>)
    | undefined,
}));
vi.mock("eve/client", () => ({
  Client: class {
    sessions = { create: mocks.create };
  },
}));
vi.mock("./welcome", () => ({
  Welcome: ({
    onSend,
  }: {
    onSend: (message: ConversationDraft) => Promise<void>;
  }) => {
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
  await mocks.submit?.({ text: message, files: [] });
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ message });
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(
    "test-session",
    "Can I read for five minutes?"
  );
});
it("creates the first turn with its session before saving the title and navigating", async () => {
  await mocks.submit?.({ text: "Plan tomorrow", files: [] });
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
  await expect(
    mocks.submit?.({ text: "Keep this draft", files: [] })
  ).rejects.toThrow("Offline");
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.created).not.toHaveBeenCalled();
  await mocks.submit?.({ text: "Keep this draft", files: [] });
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.send).not.toHaveBeenCalled();
});
it("does not save or navigate when the first turn is rejected and allows retry", async () => {
  mocks.create.mockRejectedValueOnce(new Error("Turn rejected"));
  await expect(mocks.submit?.({ text: "Try this", files: [] })).rejects.toThrow(
    "Turn rejected"
  );
  expect(mocks.created).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  await mocks.submit?.({ text: "Try this", files: [] });
  expect(mocks.create).toHaveBeenCalledTimes(2);
  expect(mocks.save).toHaveBeenCalledTimes(1);
});
it("preserves an edited draft when recovering an already accepted first turn", async () => {
  mocks.save.mockRejectedValueOnce(new Error("Offline"));
  await expect(
    mocks.submit?.({ text: "Original request", files: [] })
  ).rejects.toThrow("Offline");
  await mocks.submit?.({ text: "A revised request", files: [] });
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
    message: "Original request",
  });
  expect(mocks.save).toHaveBeenLastCalledWith(
    "test-session",
    "Original request"
  );
  expect(mocks.created).toHaveBeenCalledExactlyOnceWith("test-session", {
    text: "A revised request",
    files: [],
  });
  expect(mocks.send).not.toHaveBeenCalled();
});

it("sends a file-only first turn and does not replay accepted files after a title failure", async () => {
  const file = {
    type: "file" as const,
    filename: "note.txt",
    mediaType: "text/plain",
    url: "data:text/plain;base64,YQ==",
  };
  const draft = { text: "", files: [file] };
  mocks.save.mockRejectedValueOnce(new Error("Offline"));
  await expect(mocks.submit?.(draft)).rejects.toThrow("Offline");
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
    message: [
      {
        type: "file",
        filename: "note.txt",
        mediaType: "text/plain",
        data: file.url,
      },
    ],
  });
  await mocks.submit?.(draft);
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.save).toHaveBeenLastCalledWith("test-session", "note.txt");
  expect(mocks.created).toHaveBeenCalledWith("test-session", undefined);
});

it("retains changed attachments when recovering an already accepted first turn", async () => {
  const file = {
    type: "file" as const,
    filename: "note.txt",
    mediaType: "text/plain",
    url: "data:text/plain;base64,YQ==",
  };
  mocks.save.mockRejectedValueOnce(new Error("Offline"));
  await expect(mocks.submit?.({ text: "Read", files: [file] })).rejects.toThrow(
    "Offline"
  );
  const updated = {
    text: "Read",
    files: [{ ...file, url: "data:text/plain;base64,Yg==" }],
  };
  await mocks.submit?.(updated);
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.created).toHaveBeenCalledWith("test-session", updated);
});
