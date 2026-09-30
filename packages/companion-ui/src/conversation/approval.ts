import { z } from "zod";
import { creatorPilotInviteSchema } from "../creators/schema";

// Unicode mode consumes valid surrogate pairs as one code point. Only lone
// surrogates match this range, including on ES2022/native engines.
const wellFormedText = z
  .string()
  .refine(
    (text) => !/[\uD800-\uDFFF]/u.test(text),
    "Text must be well-formed Unicode."
  );

/** Presentation validation only. Eve owns approval and current authority. */
export const approvalTextSchema = wellFormedText
  .min(1)
  .max(16_384)
  .refine(
    (text) => text.trim().length > 0,
    "Approval details must be complete, non-empty, well-formed text."
  );

const emailAddress = z
  .string()
  .refine(
    (value) => z.email().safeParse(value).success,
    "Invalid email address"
  );
const mailHeader = wellFormedText
  .min(1)
  .max(998)
  .refine(
    (value) =>
      value === value.trim() &&
      Array.from(value).every(
        (character) =>
          character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127
      ),
    "Mail headers must be well-formed, trimmed text without line breaks"
  );

export const gmailSendSchema = z.object({
  bcc: z.array(emailAddress).max(20).default([]),
  body: wellFormedText.min(1).max(100_000),
  cc: z.array(emailAddress).max(20).default([]),
  inReplyTo: mailHeader.optional(),
  subject: mailHeader,
  threadId: z.string().min(1).max(200).optional(),
  to: z.array(emailAddress).min(1).max(20),
});

/** The exact bot identity and publication selected for this action. */
export const NetworkDestinationSchema = z.strictObject({
  botId: z.uuid(),
  workspaceId: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => value === value.trim(), "Expected trimmed text"),
  revision: z.string().regex(/^[a-f0-9]{64}$/u),
});
const networkContactPayloadSchema = z.strictObject({
  // People and bots use the same existing public handle rule.
  username: creatorPilotInviteSchema.shape.username,
  destination: NetworkDestinationSchema,
  text: wellFormedText
    .min(1)
    .max(8000)
    .refine(
      (value) => value === value.trim(),
      "Expected trimmed, well-formed text"
    ),
});

function disclose(title: string, payload: unknown, supplementary?: unknown) {
  return approvalTextSchema.parse(
    `${title} — exact payload\n${JSON.stringify(payload, null, 2)}` +
      (supplementary === undefined
        ? ""
        : `\n\nSupplementary context (does not change the payload):\n${approvalTextSchema.parse(supplementary)}`)
  );
}

export function renderGmailApproval(raw: unknown, supplementary?: unknown) {
  return disclose("Gmail email", gmailSendSchema.parse(raw), supplementary);
}

export function renderNetworkApproval(raw: unknown, supplementary?: unknown) {
  const { approvalMessage: _supplementary, ...payload } = z
    .record(z.string(), z.unknown())
    .parse(raw);
  return disclose(
    "Network contact",
    networkContactPayloadSchema.parse(payload),
    supplementary
  );
}

export const NetworkContactInputSchema = networkContactPayloadSchema.refine(
  (input) => {
    try {
      renderNetworkApproval(input);
      return true;
    } catch {
      return false;
    }
  },
  "The complete recipient and payload must fit the approval display. Use a smaller message; no content may be omitted."
);

/** Invalid known actions are distinct from unsupported actions. An invalid result
 * must disable approval; it must never select generic or summary-only fallback. */
export function renderApprovalDisclosure(toolName: string, input: unknown) {
  if (toolName !== "gmail-send" && toolName !== "network-contact")
    return { kind: "unsupported" } as const;
  try {
    const payload = z.record(z.string(), z.unknown()).parse(input);
    const text =
      toolName === "gmail-send"
        ? renderGmailApproval(payload, payload.approvalMessage)
        : renderNetworkApproval(payload, payload.approvalMessage);
    return { kind: "ready", text } as const;
  } catch {
    return {
      kind: "invalid",
      message:
        "Complete approval details are invalid or exceed 16384 characters. Review a smaller exact action before approving.",
    } as const;
  }
}
