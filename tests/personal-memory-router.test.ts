import { beforeEach, expect, it, vi } from "vitest";
import { createTRPCRouter } from "@web/trpc/init";
import { personalMemoryRouter } from "@web/trpc/personal-memory";
import { emptyUserProfile } from "@shared/user-profile/schema";
import { PersonalNoteInvalid } from "@shared/personal-memory/document";
import * as memory from "../server/personal-memory/export";
import * as notes from "../server/personal-memory/notes";
import { PersonalMemoryError } from "../server/personal-memory/access";

const headers = new Headers({ cookie: "synthetic-test-session" });
const caller = createTRPCRouter(personalMemoryRouter).createCaller({
  requestHeaders: headers,
  scope: { userId: "current-user", workspaceId: "selected-team" },
});
const input = {
  expectedVersion: "76d773b3-77e3-4f62-a2cb-448b84b9f02c",
  content: "A corrected preference",
};
beforeEach(() => vi.restoreAllMocks());

it("resolves personal memory through the current session rather than the selected workspace", async () => {
  const read = vi.spyOn(memory, "inspectPersonalMemory").mockResolvedValue({
    scope: "stored-personal-memory",
    generatedAt: new Date().toISOString(),
    profile: emptyUserProfile,
    notes: { status: "unresolved", documents: [] },
    coverage: {
      included: ["structured-profile", "bound-profile-notes"],
      excluded: [
        "conversation-history",
        "artifacts",
        "connected-accounts",
        "schedules",
        "unbound-memory-documents",
      ],
    },
  });
  expect((await caller.read()).notes.status).toBe("unresolved");
  expect(read).toHaveBeenCalledExactlyOnceWith(headers);
});
it("passes only the reviewed revision and content to the owning write boundary", async () => {
  const write = vi
    .spyOn(notes, "updatePersonalNote")
    .mockResolvedValue({ content: "saved", version: input.expectedVersion });
  await caller.updateNote(input);
  expect(write).toHaveBeenCalledExactlyOnceWith(headers, input);
  await expect(
    caller.updateNote({
      ...input,
      // @ts-expect-error Simulate an untyped client attempting to select another document.
      key: "foreign-document",
    })
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(write).toHaveBeenCalledTimes(1);
});
it("returns a recoverable conflict for an outdated or foreign revision", async () => {
  vi.spyOn(notes, "updatePersonalNote").mockRejectedValue(
    new notes.PersonalNoteChanged()
  );
  await expect(caller.updateNote(input)).rejects.toMatchObject({
    code: "CONFLICT",
    message: "This note changed. Reload it before saving again.",
  });
});
it("requires sign-in again when the exact session has been revoked", async () => {
  vi.spyOn(notes, "updatePersonalNote").mockRejectedValue(
    new PersonalMemoryError({ reason: "unauthenticated" })
  );
  await expect(caller.updateNote(input)).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
});

it("returns actionable note validation without exposing unexpected storage errors", async () => {
  const write = vi.spyOn(notes, "updatePersonalNote");
  write.mockRejectedValueOnce(new PersonalNoteInvalid("Shorten this note."));
  await expect(caller.updateNote(input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: "Shorten this note.",
  });
  write.mockRejectedValueOnce(new Error("private database details"));
  await expect(caller.updateNote(input)).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
    message: "Your personal memory is temporarily unavailable. Try again.",
  });
});
