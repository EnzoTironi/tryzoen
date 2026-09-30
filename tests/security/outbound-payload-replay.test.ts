import type { gmail_v1 } from "@googleapis/gmail";
import type { ToolContext } from "eve/tools";
import { beforeEach, describe, expect, test, vi } from "vitest";

const provider = vi.hoisted(() => ({
  list: vi.fn<
    (
      request: gmail_v1.Params$Resource$Users$Messages$List
    ) => Promise<{ data: gmail_v1.Schema$ListMessagesResponse }>
  >(),
  get: vi.fn<
    (
      request: gmail_v1.Params$Resource$Users$Messages$Get
    ) => Promise<{ data: gmail_v1.Schema$Message | null }>
  >(),
  send: vi.fn<
    (
      request: gmail_v1.Params$Resource$Users$Messages$Send
    ) => Promise<{ data: gmail_v1.Schema$Message }>
  >(),
  create: vi.fn<() => unknown>(),
  authorize:
    vi.fn<
      (
        context: ToolContext,
        execute: (auth: unknown) => Promise<unknown>
      ) => Promise<unknown>
    >(),
}));

vi.mock("@googleapis/gmail", () => ({ gmail: provider.create }));
vi.mock("@agent/lib/google-workspace/client", () => ({
  withGoogleAuth: provider.authorize,
  googleApiErrorStatus: () => undefined,
}));

import { gmailSendSchema, sendGmail } from "@agent/lib/google-workspace/gmail";

// These tests invoke the adapter with a synthetic stable call identity. They do
// not imply that a client can replace an Eve stored approval input. The provider
// is a fake transport, not an exactly-once guarantee or a live Gmail validation.
const context = {
  abortSignal: new AbortController().signal,
  callId: "synthetic-approved-call",
  toolName: "gmail-send",
  session: {
    id: "synthetic-session",
    auth: { current: null, initiator: null },
    turn: { id: "synthetic-turn", sequence: 1 },
  },
  getSandbox: async () => {
    throw new Error("No sandbox access");
  },
  getSkill: () => {
    throw new Error("No skill access");
  },
  getToken: async () => {
    throw new Error("No credentials");
  },
  requireAuth: () => {
    throw new Error("No real authorization");
  },
} satisfies ToolContext;

const payload = () =>
  gmailSendSchema.parse({
    to: ["reviewer@example.com"],
    cc: ["colleague@example.com"],
    bcc: ["audit@example.com"],
    subject: "Synthetic reviewed subject",
    body: "Synthetic reviewed body",
    inReplyTo: "<reviewed-message@example.com>",
    threadId: "reviewed-thread",
  });

beforeEach(() => {
  vi.resetAllMocks();
  let sent: gmail_v1.Schema$Message | null = null;
  provider.authorize.mockImplementation(async (_context, execute) =>
    execute({ synthetic: true })
  );
  provider.create.mockReturnValue({
    users: {
      messages: {
        list: provider.list,
        get: provider.get,
        send: provider.send,
      },
    },
  });
  provider.list.mockImplementation(async () => ({
    data: { messages: sent ? [{ id: sent.id }] : [] },
  }));
  provider.get.mockImplementation(async () => ({ data: sent }));
  provider.send.mockImplementation(async (request) => {
    const encoded = request.requestBody?.raw;
    if (typeof encoded !== "string")
      throw new Error("Synthetic MIME is required");
    const raw = Buffer.from(encoded, "base64url").toString("utf8");
    const headers = raw
      .split("\r\n\r\n", 1)
      .join("")
      .split("\r\n")
      .map((line) => {
        const colon = line.indexOf(":");
        return {
          name: line.slice(0, colon),
          value: line.slice(colon + 1).trim(),
        };
      });
    sent = {
      id: "synthetic-sent-1",
      threadId: request.requestBody?.threadId,
      labelIds: ["SENT"],
      payload: { headers },
    };
    return { data: { id: sent.id, threadId: sent.threadId } };
  });
});

describe("Gmail exact payload reconciliation", () => {
  test("unchanged payload replay reconciles the fake provider receipt without a second send", async () => {
    const first = await sendGmail(context, payload());
    expect(await sendGmail(context, payload())).toMatchObject(first);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  test.each([
    "to",
    "cc",
    "bcc",
    "body",
    "subject",
    "threadId",
    "inReplyTo",
  ] as const)(
    "rejects a replay with changed %s under the same approved call identity",
    async (field) => {
      await sendGmail(context, payload());
      const changed = gmailSendSchema.parse({
        ...payload(),
        [field]: ["to", "cc", "bcc"].includes(field)
          ? ["changed-audience@example.com"]
          : "Changed synthetic value",
      });
      await expect(sendGmail(context, changed)).rejects.toThrow(
        /payload|receipt|reconcil/iu
      );
      expect(provider.send).toHaveBeenCalledTimes(1);
    }
  );

  test("an unrelated search hit cannot masquerade as a settled send", async () => {
    provider.list.mockResolvedValue({
      data: { messages: [{ id: "synthetic-inbox-hit" }] },
    });
    provider.get.mockResolvedValue({
      data: {
        id: "synthetic-inbox-hit",
        labelIds: ["INBOX"],
        payload: { headers: [] },
      },
    });
    await expect(sendGmail(context, payload())).rejects.toThrow(
      /payload|receipt|reconcil/iu
    );
    expect(provider.send).not.toHaveBeenCalled();
  });

  test("rejects a receipt bound to another operation", async () => {
    await sendGmail(context, payload());
    await expect(
      sendGmail({ ...context, callId: "different-synthetic-call" }, payload())
    ).rejects.toThrow(/receipt/iu);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  test("uncertain accepted send recovers only its exact receipt", async () => {
    const accept = provider.send.getMockImplementation();
    if (!accept) throw new Error("Synthetic send implementation is required");
    provider.send.mockImplementationOnce(async (request) => {
      await accept(request);
      throw new Error("Synthetic timeout after acceptance");
    });
    expect(await sendGmail(context, payload())).toMatchObject({
      id: "synthetic-sent-1",
    });
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(provider.list).toHaveBeenCalledTimes(2);
    expect(provider.list.mock.calls[0]?.[0].q).toMatch(/^in:sent /u);
  });

  test("a mutable caller object cannot change the wire payload during asynchronous authorization", async () => {
    const input = payload();
    provider.authorize.mockImplementationOnce(async (_context, execute) => {
      input.to[0] = "changed-after-start@example.com";
      input.body = "Changed after start";
      input.threadId = "changed-after-start-thread";
      return execute({ synthetic: true });
    });
    await sendGmail(context, input);
    const request = provider.send.mock.calls[0]?.[0];
    const encoded = request?.requestBody?.raw;
    if (typeof encoded !== "string")
      throw new Error("Synthetic MIME is required");
    const raw = Buffer.from(encoded, "base64url").toString("utf8");
    expect(raw).toContain("To: reviewer@example.com");
    expect(raw.endsWith("Synthetic reviewed body")).toBe(true);
    expect(request?.requestBody?.threadId).toBe("reviewed-thread");
  });

  test("rejects header mutation before any provider access", async () => {
    await expect(
      sendGmail(context, {
        ...payload(),
        subject: "Reviewed\r\nBcc: hidden@example.com",
      })
    ).rejects.toThrow(/Mail headers/iu);
    expect(provider.create).not.toHaveBeenCalled();
  });

  test("encodes the exact validated audience and body in the outgoing fake-provider message", async () => {
    const input = payload();
    await sendGmail(context, input);
    const request = provider.send.mock.calls[0]?.[0];
    const encoded = request?.requestBody?.raw;
    if (typeof encoded !== "string")
      throw new Error("Synthetic MIME is required");
    const raw = Buffer.from(encoded, "base64url").toString("utf8");
    expect(raw).toContain(`To: ${input.to.join(", ")}`);
    expect(raw).toContain(`Cc: ${input.cc.join(", ")}`);
    expect(raw).toContain(`Bcc: ${input.bcc.join(", ")}`);
    expect(raw).toContain(`Subject: ${input.subject}`);
    expect(raw.split("\r\n\r\n").slice(1).join("\r\n\r\n")).toBe(input.body);
    expect(request?.requestBody?.threadId).toBe(input.threadId);
  });
});
