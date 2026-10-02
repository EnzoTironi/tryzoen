import type { gmail_v1 } from "@googleapis/gmail";
import { auth } from "@googleapis/gmail";
import type * as GmailApi from "@googleapis/gmail";
import type * as Sessions from "@db/services/sessions";
import type * as WorkspaceAccess from "../../server/workspaces/access";
import type { ToolContext } from "eve/tools";
import type { InputRequest } from "eve/client";
import type * as GoogleClient from "@agent/lib/google-workspace/client";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { withGoogleAuth } from "@agent/lib/google-workspace/client";
import { authorizeApprovalResponse } from "@agent/lib/approval-response";
import { renderChannelInput } from "@agent/lib/channel-input";
import {
  gmailSendInputSchema,
  gmailSendSchema,
  renderApprovalDisclosure,
} from "@zoen/companion-ui/approval";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { gmailSend } from "../../server/tools/tools/gmail";

const boundary = vi.hoisted(() => {
  const listed = { data: { messages: [] } };
  const sent = {
    data: { id: "synthetic-sent-message", threadId: "synthetic-thread" },
  };
  return {
    query: vi.fn<() => never>(() => {
      throw new Error("Database access is forbidden in this acceptance test.");
    }),
    owned: vi.fn<typeof Sessions.isSessionOwned>().mockResolvedValue(true),
    list: vi.fn<() => Promise<typeof listed>>().mockResolvedValue(listed),
    send: vi
      .fn<
        (
          request: gmail_v1.Params$Resource$Users$Messages$Send
        ) => Promise<typeof sent>
      >()
      .mockResolvedValue(sent),
    forbiddenAuth: vi.fn<() => never>(() => {
      throw new Error(
        "Live authentication is forbidden in this acceptance test."
      );
    }),
  };
});

vi.mock("@db/queries", () => ({
  query: boundary.query,
  transaction: boundary.query,
}));
vi.mock("@db/services/sessions", () => ({ isSessionOwned: boundary.owned }));
vi.mock("../../server/matrix/authority", () => ({
  matrixSessionActor: boundary.forbiddenAuth,
}));
vi.mock("../../server/workspaces/access", async (importOriginal) => {
  const original = await importOriginal<typeof WorkspaceAccess>();
  return {
    ...original,
    requireWorkspaceMembership: boundary.forbiddenAuth,
    requireWorkspaceAccess: boundary.forbiddenAuth,
    workspaceActorFromPrincipal: boundary.forbiddenAuth,
  };
});
vi.mock("../../server/channels/principal", () => ({
  requireChannelPrincipal: boundary.forbiddenAuth,
}));
vi.mock("@agent/lib/google-workspace/client", () => ({
  withGoogleAuth: vi.fn<typeof GoogleClient.withGoogleAuth>((_ctx, execute) =>
    execute(new auth.OAuth2())
  ),
  googleApiErrorStatus: () => undefined,
}));
vi.mock("@googleapis/gmail", async (importOriginal) => {
  const original = await importOriginal<typeof GmailApi>();
  const provider = {
    users: { messages: { list: boundary.list, send: boundary.send } },
  };
  return {
    ...original,
    gmail: vi.fn<() => typeof provider>(() => provider),
  };
});

const supplementarySummary =
  "Send a public welcome to friendly@example.com with the subject Welcome and body Hello?";
const input = {
  ...gmailSendSchema.parse({
    to: ["friendly@example.com", "second-recipient@example.com"],
    cc: ["copied-recipient@example.com"],
    bcc: ["hidden-recipient@example.com"],
    subject: "Synthetic private account memo",
    body: "Synthetic private memo: Cedarbay internal cap €75.\nKeep this exact second line.",
    threadId: "synthetic-thread-to-disclose",
    inReplyTo: "<synthetic-original-message@example.com>",
  }),
  approvalMessage: supplementarySummary,
};

function proposal(payload = input): InputRequest {
  return {
    kind: "tool-approval",
    display: "confirmation",
    requestId: "synthetic-request",
    prompt: "Approve this outgoing email?",
    options: [
      { id: "approve", label: "Approve" },
      { id: "cancel", label: "Cancel" },
    ],
    action: {
      kind: "tool-call",
      callId: "synthetic-call",
      toolName: "gmail-send",
      input: payload,
    },
  };
}

function context(): ToolContext {
  const scope = accessScopeForUser("synthetic-user");
  const principal = {
    principalId: scope.userId,
    principalType: "user" as const,
    authenticator: "authjs",
    attributes: { workspaceId: scope.workspaceId, conversationChannel: "eve" },
  };
  return {
    abortSignal: new AbortController().signal,
    callId: "synthetic-call",
    toolName: "gmail-send",
    getSandbox: boundary.forbiddenAuth,
    getSkill: boundary.forbiddenAuth,
    getToken: boundary.forbiddenAuth,
    requireAuth: boundary.forbiddenAuth,
    session: {
      id: "synthetic-session",
      auth: { current: principal, initiator: principal },
      turn: { id: "synthetic-turn", sequence: 1 },
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("outgoing Gmail approval disclosure acceptance", () => {
  test("native UI and authored Gmail tool share the same canonical input schema", () => {
    expect(gmailSend.inputSchema).toBe(gmailSendInputSchema);
    expect(gmailSendInputSchema.safeParse(input).success).toBe(true);
    const disclosure = renderApprovalDisclosure("gmail-send", input);
    expect(disclosure.kind).toBe("ready");
    if (disclosure.kind !== "ready")
      throw new Error("Valid native mail requires exact disclosure.");
    expect(renderChannelInput(proposal())).toContain(disclosure.text);
    const { approvalMessage: _summary, ...material } = input;
    expect(gmailSendInputSchema.safeParse(material).success).toBe(false);
    expect(renderApprovalDisclosure("gmail-send", material).kind).toBe(
      "invalid"
    );
    expect(withGoogleAuth).not.toHaveBeenCalled();
    expect(boundary.send).not.toHaveBeenCalled();
    expect(boundary.query).not.toHaveBeenCalled();
  });

  test("owner authorization and execution retain the real payload independently of supplementary wording", async () => {
    const request = proposal();
    const displayed = renderChannelInput(request);
    expect(displayed).toContain(supplementarySummary);
    const ctx = context();
    const responder = ctx.session.auth.current;
    if (!responder) throw new Error("Synthetic owner is required.");
    expect(
      await authorizeApprovalResponse({
        responder,
        session: { id: ctx.session.id, initiator: ctx.session.auth.initiator },
      })
    ).toEqual({ status: "allowed" });

    // Direct execution models an already-approved call; it is not an Eve runtime bypass test.
    expect(await gmailSend.execute(input, ctx)).toMatchObject({ sent: true });
    expect(boundary.owned).toHaveBeenCalledExactlyOnceWith(
      accessScopeForUser(responder.principalId),
      ctx.session.id
    );
    expect(boundary.send).toHaveBeenCalledOnce();
    const sent = boundary.send.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      userId: "me",
      requestBody: { threadId: input.threadId },
    });
    const raw = sent?.requestBody?.raw;
    if (typeof raw !== "string") throw new Error("Synthetic MIME is required.");
    const mime = Buffer.from(raw, "base64url").toString("utf8");
    const replyTo = input.inReplyTo;
    if (typeof replyTo !== "string")
      throw new Error("Synthetic reply context is required.");
    expect(mime).toContain(`To: ${input.to.join(", ")}\r\n`);
    expect(mime).toContain(`Cc: ${input.cc.join(", ")}\r\n`);
    expect(mime).toContain(`Bcc: ${input.bcc.join(", ")}\r\n`);
    expect(mime).toContain(`Subject: ${input.subject}\r\n`);
    expect(mime).toContain(`In-Reply-To: ${replyTo}\r\n`);
    expect(mime).toContain(`References: ${replyTo}\r\n`);
    expect(mime.split("\r\n\r\n").slice(1).join("\r\n\r\n")).toBe(input.body);
    expect(mime).not.toContain(supplementarySummary);
    expect(boundary.query).not.toHaveBeenCalled();
    expect(boundary.forbiddenAuth).not.toHaveBeenCalled();
  });

  test.each([
    ["To", input.to],
    ["Cc", input.cc],
    ["Bcc", input.bcc],
    ["subject", [input.subject]],
    ["complete body", [JSON.stringify(input.body)]],
    ["thread", [input.threadId]],
    ["In-Reply-To", [input.inReplyTo]],
  ])(
    "discloses every exact %s value despite misleading supplementary prose",
    (_field, values) => {
      const displayed = renderChannelInput(proposal());
      for (const value of values) expect(displayed).toContain(value);
      expect(boundary.send).not.toHaveBeenCalled();
      expect(boundary.query).not.toHaveBeenCalled();
    }
  );

  test("refuses a proposal whose complete payload exceeds the channel display limit", () => {
    const oversized = proposal({ ...input, body: "x".repeat(16_384) });
    expect(() => renderChannelInput(oversized)).toThrow(/16384/u);
    expect(boundary.send).not.toHaveBeenCalled();
    expect(boundary.query).not.toHaveBeenCalled();
  });

  test.each([
    ["full body", { ...input, body: "x".repeat(16_384) }],
    [
      "supplementary context",
      { ...input, approvalMessage: "x".repeat(16_384) },
    ],
  ])(
    "rejects oversized %s in the authored schema before provider access",
    (_field, payload) => {
      const schema = gmailSend.inputSchema;
      if (!(schema instanceof z.ZodType))
        throw new Error(
          "The authored Gmail schema must validate complete disclosure."
        );
      expect(schema.safeParse(payload).success).toBe(false);
      expect(withGoogleAuth).not.toHaveBeenCalled();
      expect(boundary.list).not.toHaveBeenCalled();
      expect(boundary.send).not.toHaveBeenCalled();
      expect(boundary.query).not.toHaveBeenCalled();
    }
  );

  test.each(
    (["to", "cc", "bcc"] as const).flatMap((field) =>
      [
        "friendly@example.com\r\nBcc: injected@example.com",
        "friendly@example.com\u0000hidden",
        "friendly@example.com\t",
        " friendly@example.com",
        "friendly@example.com ",
        "friendly@example.com\u007F",
      ].map((recipient) => ({ field, recipient }))
    )
  )(
    "rejects unsafe $field recipients before authentication or provider access: $recipient",
    async ({ field, recipient }) => {
      const payload = { ...input, [field]: [recipient] };
      expect(gmailSendInputSchema.safeParse(payload).success).toBe(false);
      expect(renderApprovalDisclosure("gmail-send", payload).kind).toBe(
        "invalid"
      );
      await expect(
        gmailSend.execute(payload, context())
      ).rejects.toHaveProperty("name", "ZodError");
      expect(withGoogleAuth).not.toHaveBeenCalled();
      expect(boundary.list).not.toHaveBeenCalled();
      expect(boundary.send).not.toHaveBeenCalled();
      expect(boundary.query).not.toHaveBeenCalled();
    }
  );

  test.each([
    { subject: "Status\r\nBcc: injected-recipient@example.com" },
    { subject: " Different subject after trimming " },
    { subject: "Status\u0000hidden" },
    { inReplyTo: "<original@example.com>\tadditional" },
    { inReplyTo: "<original@example.com>\nReferences: <injected@example.com>" },
    { inReplyTo: "" },
    { subject: "Malformed \uD800" },
    { body: "Malformed body \uD800" },
  ])(
    "rejects invalid exact mail text before authentication or provider access: %j",
    async (change) => {
      const payload = { ...input, ...change };
      const schema = gmailSend.inputSchema;
      if (!(schema instanceof z.ZodType))
        throw new Error(
          "The authored Gmail schema must validate exact mail text."
        );
      expect(schema.safeParse(payload).success).toBe(false);
      await expect(
        gmailSend.execute(payload, context())
      ).rejects.toHaveProperty("name", "ZodError");
      expect(withGoogleAuth).not.toHaveBeenCalled();
      expect(boundary.list).not.toHaveBeenCalled();
      expect(boundary.send).not.toHaveBeenCalled();
      expect(boundary.query).not.toHaveBeenCalled();
    }
  );
});
