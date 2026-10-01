import { describe, expect, test, vi } from "vitest";
import {
  gmailSendInputSchema,
  gmailSendSchema,
  NetworkContactInputSchema,
  NetworkDestinationSchema,
  renderApprovalDisclosure,
  renderGmailApproval,
  renderNetworkApproval,
} from "./approval";

const gmail = {
  to: ["friendly@example.com", "second-recipient@example.com"],
  cc: ["copied-recipient@example.com"],
  bcc: ["hidden-recipient@example.com"],
  subject: "Synthetic private memo",
  body: 'Synthetic exact body: Cedarbay cap €75.\nSecond line with "quoted" detail.',
  threadId: "synthetic-thread-to-disclose",
  inReplyTo: "<synthetic-original@example.com>",
  approvalMessage: "Send a public welcome to friendly@example.com: Hello?",
};
const network = {
  username: "cedarbay_bot",
  destination: {
    botId: "11111111-1111-4111-8111-111111111111",
    workspaceId: "company:cedarbay",
    revision: "a".repeat(64),
  },
  text: 'Synthetic exact network message.\nSecond line with "quoted" detail.',
};
const networkSupplementary = "Ask the public support bot a generic greeting?";

function readyText(toolName: string, input: unknown) {
  const schema =
    toolName === "gmail-send"
      ? gmailSendInputSchema
      : NetworkContactInputSchema;
  expect(schema.safeParse(input).success).toBe(true);
  const result = renderApprovalDisclosure(toolName, input);
  expect(result.kind).toBe("ready");
  if (result.kind !== "ready")
    throw new Error("The valid synthetic proposal must be fully disclosed.");
  expect(result.text.length).toBeLessThanOrEqual(16_384);
  return result.text;
}

function expectInvalid(toolName: string, input: unknown) {
  const schema =
    toolName === "gmail-send"
      ? gmailSendInputSchema
      : NetworkContactInputSchema;
  expect(schema.safeParse(input).success).toBe(false);
  const result = renderApprovalDisclosure(toolName, input);
  expect(result.kind).toBe("invalid");
  if (result.kind !== "invalid")
    throw new Error("Invalid known proposals must fail closed.");
  expect(typeof result.message).toBe("string");
  expect(result.message.trim().length).toBeGreaterThan(0);
  expect(result).not.toHaveProperty("text");
}

describe("shared exact approval disclosure", () => {
  test.each([
    ["calendar-create-event", {}],
    ["unrecognized-outbound-tool", null],
    ["GMAIL-SEND", gmail],
  ])(
    "keeps unsupported %s distinct from a malformed known action",
    (toolName, input) => {
      expect(renderApprovalDisclosure(toolName, input)).toEqual({
        kind: "unsupported",
      });
      expectInvalid("gmail-send", {});
      expectInvalid("network-contact", {});
    }
  );

  test("discloses every exact Gmail field despite misleading supplementary wording", () => {
    const before = structuredClone(gmail);
    const text = readyText("gmail-send", gmail);
    for (const recipient of [...gmail.to, ...gmail.cc, ...gmail.bcc])
      expect(text).toContain(recipient);
    expect(text).toContain(JSON.stringify(gmail.subject));
    expect(text).toContain(JSON.stringify(gmail.body));
    expect(text).toContain(gmail.threadId);
    expect(text).toContain(gmail.inReplyTo);
    expect(text).toContain(gmail.approvalMessage);
    expect(gmail).toEqual(before);
    expect(text).toBe(renderGmailApproval(gmail, gmail.approvalMessage));
  });

  test("discloses the immutable network audience and complete native message", () => {
    const before = structuredClone(network);
    const text = readyText("network-contact", network);
    expect(text).toContain(network.username);
    expect(text).toContain(network.destination.botId);
    expect(text).toContain(network.destination.workspaceId);
    expect(text).toContain(network.destination.revision);
    expect(text).toContain(JSON.stringify(network.text));
    expect(network).toEqual(before);
    expect(text).toBe(renderNetworkApproval(network));
  });

  test("keeps material formatters separate from required native Gmail supplementary input", () => {
    const { approvalMessage: _gmailSummary, ...mailPayload } = gmail;
    expect(renderGmailApproval(mailPayload)).toContain(
      JSON.stringify(mailPayload.body)
    );
    expectInvalid("gmail-send", mailPayload);
    expect(readyText("network-contact", network)).toBe(
      renderNetworkApproval(network)
    );
  });

  test("explicit network supplementary context cannot replace its exact audience or message", () => {
    const text = renderNetworkApproval(network, networkSupplementary);
    expect(text).toContain(networkSupplementary);
    expect(text).toContain(network.destination.botId);
    expect(text).toContain(network.destination.workspaceId);
    expect(text).toContain(network.destination.revision);
    expect(text).toContain(JSON.stringify(network.text));
    expect(text).toContain(renderNetworkApproval(network));
    expect(readyText("network-contact", network)).not.toContain(
      networkSupplementary
    );
  });

  test("retains the full beginning, middle and ending of a large Gmail body", () => {
    const body = `First exact line\n${"synthetic-middle-".repeat(700)}\nLast exact line`;
    const text = readyText("gmail-send", { ...gmail, body });
    expect(text).toContain(JSON.stringify(body));
  });

  test.each([null, [], "not a proposal", 5])(
    "rejects non-object known payload %j",
    (input) => {
      expect.hasAssertions();
      expectInvalid("gmail-send", input);
      expectInvalid("network-contact", input);
    }
  );

  test.each([
    { to: [] },
    { to: "friendly@example.com" },
    { to: ["not-an-email"] },
    { cc: ["not-an-email"] },
    { bcc: ["not-an-email"] },
    { subject: "" },
    { subject: "Status\r\nBcc: injected@example.com" },
    { subject: " Different value after trimming " },
    { subject: "Status\u0000hidden" },
    { inReplyTo: "<original@example.com>\tadditional" },
    { inReplyTo: "" },
    { threadId: "" },
    { subject: "Malformed \uD800" },
    { body: "" },
    { body: "Malformed \uD800" },
  ])("rejects malformed Gmail material fields %j", (change) => {
    const input = { ...gmail, ...change };
    expect(gmailSendSchema.safeParse(input).success).toBe(false);
    expectInvalid("gmail-send", input);
  });

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
    "rejects unsafe exact recipient $field: $recipient",
    ({ field, recipient }) => {
      const payload = { ...gmail, [field]: [recipient] };
      expect(gmailSendSchema.safeParse(payload).success).toBe(false);
      expectInvalid("gmail-send", payload);
    }
  );

  test.each([
    { botId: "not-a-uuid" },
    { workspaceId: "" },
    { workspaceId: " company:cedarbay " },
    { revision: "a".repeat(63) },
    { revision: "A".repeat(64) },
    { unexpectedAuthority: "grant-selected-by-model" },
  ])("rejects malformed network destination %j", (change) => {
    const destination = { ...network.destination, ...change };
    expect(NetworkDestinationSchema.safeParse(destination).success).toBe(false);
    expectInvalid("network-contact", { ...network, destination });
  });

  test.each([
    { username: "Bad Handle" },
    { destination: null },
    { text: "" },
    { text: " Different text after trimming " },
    { text: "Malformed \uD800" },
    { text: "x".repeat(8001) },
  ])("rejects malformed network payload %j", (change) => {
    const payload = { ...network, ...change };
    expect(NetworkContactInputSchema.safeParse(payload).success).toBe(false);
    expectInvalid("network-contact", { ...network, ...change });
  });

  test.each([
    ["gmail-send", { ...gmail, body: "x".repeat(16_384) }],
    ["gmail-send", { ...gmail, approvalMessage: "x".repeat(16_384) }],
    ["gmail-send", { ...gmail, body: `Start${"\u0000".repeat(3000)}End` }],
    [
      "network-contact",
      { ...network, text: `Start${"\u0000".repeat(3000)}End` },
    ],
  ])(
    "fails closed instead of truncating oversized %s disclosure",
    (toolName, input) => {
      expect.hasAssertions();
      expectInvalid(toolName, input);
    }
  );

  test.each(["", "  ", "Malformed \uD800"])(
    "rejects malformed supplementary text %j",
    (approvalMessage) => {
      expect.hasAssertions();
      expectInvalid("gmail-send", { ...gmail, approvalMessage });
      expect(() => renderNetworkApproval(network, approvalMessage)).toThrow(
        /well-formed|complete|non-empty|>=1/u
      );
    }
  );

  test("rejects oversized explicit network supplementary context without truncation", () => {
    expect(() => renderNetworkApproval(network, "x".repeat(16_384))).toThrow(
      /16384/u
    );
  });

  test("preserves valid surrogate pairs and emoji in exact Gmail and network content", () => {
    const body = "Valid \uD83D\uDE80 surrogate pair and 🛰️ content.";
    const subject = "Synthetic 📨 memo";
    const text = "Valid \uD83D\uDE80 exact network content.";
    expect(readyText("gmail-send", { ...gmail, subject, body })).toContain(
      JSON.stringify(body)
    );
    expect(readyText("gmail-send", { ...gmail, subject, body })).toContain(
      JSON.stringify(subject)
    );
    expect(readyText("network-contact", { ...network, text })).toContain(
      JSON.stringify(text)
    );
  });

  test.each(["\uD800", "\uDC00", "\uD800X\uDC00"])(
    "rejects unpaired surrogate sequence %j in material and supplementary text",
    (invalid) => {
      expect.hasAssertions();
      expectInvalid("gmail-send", { ...gmail, body: invalid });
      expectInvalid("gmail-send", { ...gmail, subject: invalid });
      expectInvalid("network-contact", { ...network, text: invalid });
      expectInvalid("gmail-send", { ...gmail, approvalMessage: invalid });
      expect(() => renderNetworkApproval(network, invalid)).toThrow(
        /well-formed/u
      );
    }
  );

  test("validates exact text without invoking the ES2024 String well-formedness method", () => {
    const wellFormed = vi
      .spyOn(String.prototype, "isWellFormed")
      .mockImplementation(() => {
        throw new Error(
          "Portable approval validation must not invoke the ES2024 String method."
        );
      });
    try {
      const body = "Valid \uD83D\uDE80 content without a runtime polyfill.";
      expect(readyText("gmail-send", { ...gmail, body })).toContain(
        JSON.stringify(body)
      );
      expect(
        readyText("network-contact", { ...network, text: body })
      ).toContain(JSON.stringify(body));
      expectInvalid("gmail-send", { ...gmail, body: "\uDC00" });
      expectInvalid("network-contact", { ...network, text: "\uD800" });
      expect(wellFormed).not.toHaveBeenCalled();
    } finally {
      wellFormed.mockRestore();
    }
  });

  test("accepts the full 16384-character disclosure and rejects the next character without truncation", () => {
    const baseline = renderGmailApproval(
      { ...gmail, body: "x" },
      gmail.approvalMessage
    );
    const body = "x".repeat(16_384 - baseline.length + 1);
    const text = readyText("gmail-send", { ...gmail, body });
    expect(text).toHaveLength(16_384);
    expect(text).toContain(JSON.stringify(body));
    expectInvalid("gmail-send", { ...gmail, body: `${body}x` });
  });

  test("rejects a native Gmail request missing its required approvalMessage", () => {
    expect.hasAssertions();
    const { approvalMessage: _summary, ...payload } = gmail;
    expectInvalid("gmail-send", payload);
  });

  test("rejects a native network request containing prohibited approvalMessage", () => {
    const payload = { ...network, approvalMessage: networkSupplementary };
    expect(NetworkContactInputSchema.safeParse(payload).success).toBe(false);
    expectInvalid("network-contact", payload);
  });
});
