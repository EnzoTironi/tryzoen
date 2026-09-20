import type { ToolContext } from "eve/tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type * as GmailModule from "@agent/lib/google-workspace/gmail";
import type * as CalendarModule from "@agent/lib/google-workspace/calendar";
import type { updateGmail } from "@agent/lib/google-workspace/gmail";

const gmail = vi.hoisted(() => ({
  update: vi
    .fn<typeof updateGmail>()
    .mockResolvedValue({ action: "archive", updatedCount: 2 }),
  send: vi.fn<typeof GmailModule.sendGmail>(),
}));
const calendar = vi.hoisted(() => ({
  create: vi.fn<typeof CalendarModule.createCalendarEvent>(),
}));

vi.mock("@agent/lib/google-workspace/gmail", async (importOriginal) => ({
  ...(await importOriginal<typeof GmailModule>()),
  updateGmail: gmail.update,
  sendGmail: gmail.send,
}));
vi.mock("@agent/lib/google-workspace/calendar", async (importOriginal) => ({
  ...(await importOriginal<typeof CalendarModule>()),
  createCalendarEvent: calendar.create,
}));

import { gmailSend, gmailUpdate } from "../../../server/tools/tools/gmail";
import { calendarCreateEvent } from "../../../server/tools/tools/calendar";
import { calendarEventSchema } from "@agent/lib/google-workspace/calendar";
import { gmailSendSchema } from "@agent/lib/google-workspace/gmail";

afterEach(() => vi.clearAllMocks());

describe("Google Workspace tools", () => {
  it.each([calendarCreateEvent, gmailSend])(
    "publishes provider-compatible JSON Schema without email lookaround",
    (tool) => {
      if (!(tool.inputSchema instanceof z.ZodType))
        throw new Error("Expected an authored Zod tool schema.");
      expect(JSON.stringify(z.toJSONSchema(tool.inputSchema))).not.toMatch(
        /\(\?(?:[=!]|<[=!])/u
      );
    }
  );

  it.each([
    ".leading@example.com",
    "two..dots@example.com",
    "bad @example.com",
    "person@localhost",
    "person@example.com\r\nBcc: other@example.com",
  ])("rejects invalid attendee %s before a Calendar effect", async (email) => {
    const invocation = calendarEventSchema
      .parseAsync({
        attendees: [email],
        summary: "Synthetic schema test",
        start: "2026-09-21T09:00:00Z",
        end: "2026-09-21T10:00:00Z",
        approvalMessage: "Create this synthetic event?",
      })
      .then((input) =>
        calendarCreateEvent.execute(
          { ...input, approvalMessage: "Create this synthetic event?" },
          toolContext()
        )
      );

    await expect(invocation).rejects.toBeInstanceOf(z.ZodError);
    expect(calendar.create).not.toHaveBeenCalled();
  });

  it.each(["to", "cc", "bcc"] as const)(
    "rejects invalid Gmail %s before any send",
    async (field) => {
      const invocation = gmailSendSchema
        .parseAsync({
          to: ["person@example.com"],
          [field]: ["two..dots@example.com"],
          subject: "Synthetic schema test",
          body: "Not sent",
          approvalMessage: "Send this synthetic email?",
        })
        .then((input) =>
          gmailSend.execute(
            { ...input, approvalMessage: "Send this synthetic email?" },
            toolContext()
          )
        );

      await expect(invocation).rejects.toBeInstanceOf(z.ZodError);
      expect(gmail.send).not.toHaveBeenCalled();
    }
  );

  it("retains valid recipients and array bounds", () => {
    const email = "person+qa@example.com";
    const input = {
      to: [email],
      cc: [email],
      bcc: [email],
      subject: "Synthetic schema test",
      body: "Not sent",
      approvalMessage: "Send this synthetic email?",
    };
    expect(gmailSendSchema.parse(input)).toMatchObject({
      to: [email],
      cc: [email],
      bcc: [email],
    });
    expect(gmailSendSchema.safeParse({ ...input, to: [] }).success).toBe(false);
    expect(
      gmailSendSchema.safeParse({ ...input, cc: Array(21).fill(email) }).success
    ).toBe(false);
  });

  it("reports the selected Gmail update without an action discriminator", async () => {
    const context = toolContext();
    const result = await gmailUpdate.execute(
      { messageIds: ["message-1", "message-2"], update: "archive" },
      context
    );

    expect(gmail.update).toHaveBeenCalledExactlyOnceWith(
      context,
      ["message-1", "message-2"],
      "archive"
    );
    expect(result).toEqual({ update: "archive", updatedCount: 2 });
  });
});

function toolContext() {
  return {
    abortSignal: new AbortController().signal,
    callId: "call-1",
    async getSandbox() {
      throw new Error("Sandbox access is outside this focused test.");
    },
    getSkill() {
      throw new Error("Skill access is outside this focused test.");
    },
    async getToken() {
      throw new Error("Token access is outside this focused test.");
    },
    requireAuth() {
      throw new Error("Authorization is outside this focused test.");
    },
    session: {
      auth: { current: null, initiator: null },
      id: "session-1",
      turn: { id: "turn-1", sequence: 0 },
    },
    toolName: "gmail-update",
  } satisfies ToolContext;
}
