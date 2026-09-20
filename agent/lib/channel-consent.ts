import { z } from "zod";
import { createHash } from "node:crypto";
import { parseInputResponse, type InputRequest } from "eve/client";
const identifier = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), "Expected trimmed text")
  .max(256);
const revision = z.string().regex(/^[a-f0-9]{64}$/u);
const reference = z.strictObject({
  requestId: identifier,
  revision,
});
const candidateSchema = z.object({
  intent: z.enum(["approve", "cancel", "correct", "clarify", "conversation"]),
  references: z.array(reference).max(16),
});
const decodeCandidate = candidateSchema.strict();
type ConsentJsonValue = InputRequest["action"]["input"][string] | undefined;
type ActionIntent = "approve" | "cancel" | "correct";
const sourceSchema = z.object({
  sourceMessageId: identifier,
  identityId: identifier,
  sessionId: identifier,
  text: z.string().min(1).max(16_384),
  sourceOccurredAtMs: z.number().min(0),
});
const decodeSource = sourceSchema.strict();

/** Supplied by verified intake, never by the interpreting model. Times are epoch milliseconds. */
export type ChannelConsentSource = z.output<typeof sourceSchema>;
const deliverySchema = z.object({
  receiptId: identifier,
  ...reference.shape,
  identityId: identifier,
  sessionId: identifier,
  deliveredAtMs: z.number().min(0),
  text: z.string().min(1).max(16_384),
  providerMessageIds: z.array(identifier).min(1).max(16),
});
/** Confirmed delivery of ALL proposal chunks; deliveredAtMs is their latest send receipt. */
export type ChannelConsentDelivery = z.output<typeof deliverySchema>;
export interface ChannelConsentSnapshot {
  readonly identityId: string;
  readonly sessionId: string;
  readonly pending: readonly InputRequest[];
  readonly deliveries: readonly ChannelConsentDelivery[];
  /** Source messages already consumed as decisions, not merely accepted into the inbox. */
  readonly consumedSourceMessageIds: readonly string[];
}
export interface ChannelConsentInterpretation {
  /** The orchestration envelope binds the model invocation to its complete source text. */
  readonly sourceMessageId: string;
  readonly sourceText: string;
  readonly candidate: unknown;
}
type Rejection =
  | "invalid_candidate"
  | "invalid_source"
  | "source_mismatch"
  | "scope_mismatch"
  | "replayed_source"
  | "ambiguous_reference"
  | "stale_request"
  | "stale_revision"
  | "unsupported_request"
  | "missing_delivery"
  | "ambiguous_delivery"
  | "delivery_not_before_source";
export type ChannelConsentDecision =
  | {
      readonly status: "rejected";
      readonly reason: Rejection;
    }
  | {
      readonly status: "non_action";
      readonly intent: "clarify" | "conversation";
    }
  | {
      readonly status: "validated";
      readonly intent: ActionIntent;
      readonly binding: ChannelConsentSource & {
        readonly requestId: InputRequest["requestId"];
        readonly revision: string;
        readonly deliveryReceiptId: string;
        readonly deliveryProviderMessageIds: readonly string[];
      };
      /** Correction only cancels the old request; it never approves replacement arguments. */
      readonly response: ReturnType<typeof parseInputResponse>;
    };

/** Includes action, options and prompt; object key order is immaterial, array order is not. */
export function channelConsentRevision(request: InputRequest): string {
  const serialized = JSON.stringify(request, (_key, value: ConsentJsonValue) =>
    Array.isArray(value)
      ? value
      : typeof value === "object" && value !== null
        ? Object.fromEntries(
            Object.entries(value).toSorted(([left], [right]) =>
              left.localeCompare(right)
            )
          )
        : value
  );
  return createHash("sha256").update(serialized).digest("hex");
}

/**
 * Validates references, not the semantic truth of a model's interpretation.
 * The caller must revalidate live authority and atomically fence consumption before dispatch.
 * A successful return performs no mutation and is not an execution receipt.
 */
export function validateChannelConsent(
  source: ChannelConsentSource,
  interpretation: ChannelConsentInterpretation,
  snapshot: ChannelConsentSnapshot
): ChannelConsentDecision {
  const sourceRejection = validateConsentSource(
    source,
    interpretation,
    snapshot
  );
  if (sourceRejection)
    return {
      status: "rejected",
      reason: sourceRejection,
    };
  const decoded = decodeCandidate.safeParse(interpretation.candidate);
  if (!decoded.success)
    return {
      status: "rejected",
      reason: "invalid_candidate",
    };
  const candidate = decoded.data;
  if (candidate.intent === "clarify" || candidate.intent === "conversation") {
    return candidate.references.length === 0
      ? {
          status: "non_action",
          intent: candidate.intent,
        }
      : {
          status: "rejected",
          reason: "invalid_candidate",
        };
  }
  const [target] = candidate.references;
  if (candidate.references.length !== 1 || !target) {
    return {
      status: "rejected",
      reason: "ambiguous_reference",
    };
  }
  const matches = snapshot.pending.filter(
    (request) => request.requestId === target.requestId
  );
  const [request] = matches;
  if (!request)
    return {
      status: "rejected",
      reason: "stale_request",
    };
  if (matches.length !== 1)
    return {
      status: "rejected",
      reason: "ambiguous_reference",
    };
  if (channelConsentRevision(request) !== target.revision) {
    return {
      status: "rejected",
      reason: "stale_revision",
    };
  }
  const optionId = candidate.intent === "approve" ? "approve" : "cancel";
  if (
    request.kind !== "tool-approval" ||
    request.options?.filter((option) => option.id === optionId).length !== 1
  ) {
    return {
      status: "rejected",
      reason: "unsupported_request",
    };
  }
  const deliveryResult = resolveConsentDelivery(
    source,
    target,
    snapshot.deliveries
  );
  if (!deliveryResult.ok)
    return {
      status: "rejected",
      reason: deliveryResult.error,
    };
  const delivery = deliveryResult.value;
  return {
    status: "validated",
    intent: candidate.intent,
    binding: {
      ...source,
      requestId: request.requestId,
      revision: target.revision,
      deliveryReceiptId: delivery.receiptId,
      deliveryProviderMessageIds: [...delivery.providerMessageIds],
    },
    response: parseInputResponse({
      requestId: request.requestId,
      optionId,
    }),
  };
}
function validateConsentSource(
  source: ChannelConsentSource,
  interpretation: ChannelConsentInterpretation,
  snapshot: ChannelConsentSnapshot
): Rejection | undefined {
  if (!decodeSource.safeParse(source).success || !source.text.trim()) {
    return "invalid_source";
  }
  if (
    source.sourceMessageId !== interpretation.sourceMessageId ||
    source.text !== interpretation.sourceText
  ) {
    return "source_mismatch";
  }
  if (
    source.identityId !== snapshot.identityId ||
    source.sessionId !== snapshot.sessionId
  ) {
    return "scope_mismatch";
  }
  if (snapshot.consumedSourceMessageIds.includes(source.sourceMessageId)) {
    return "replayed_source";
  }
  return undefined;
}
function resolveConsentDelivery(
  source: ChannelConsentSource,
  target: z.output<typeof reference>,
  receipts: readonly ChannelConsentDelivery[]
):
  | {
      ok: true;
      value: ChannelConsentDelivery;
    }
  | {
      ok: false;
      error: Rejection;
    } {
  const deliveries = receipts.filter(
    (delivery) =>
      delivery.requestId === target.requestId &&
      delivery.revision === target.revision &&
      delivery.identityId === source.identityId &&
      delivery.sessionId === source.sessionId
  );
  const [delivery] = deliveries;
  if (!delivery)
    return {
      ok: false as const,
      error: "missing_delivery",
    };
  if (deliveries.length !== 1)
    return {
      ok: false as const,
      error: "ambiguous_delivery",
    };
  if (
    !Number.isFinite(delivery.deliveredAtMs) ||
    delivery.deliveredAtMs >= source.sourceOccurredAtMs
  ) {
    return {
      ok: false as const,
      error: "delivery_not_before_source",
    };
  }
  if (
    !deliverySchema.safeParse(delivery).success ||
    !delivery.text.trim() ||
    new Set(delivery.providerMessageIds).size !==
      delivery.providerMessageIds.length ||
    !delivery.providerMessageIds.includes(delivery.receiptId)
  ) {
    return {
      ok: false as const,
      error: "missing_delivery",
    };
  }
  return {
    ok: true as const,
    value: delivery,
  };
}
