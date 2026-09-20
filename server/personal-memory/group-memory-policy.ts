import { z } from "zod";
import type { SessionAuthContext } from "eve/context";
import { ProviderReferenceSchema } from "../channels/inbound";
import { PersonalMemoryError } from "./access";

/**
 * G01 conversationScope: `group:<channel>:<installation>:<chatId>`.
 * Personal (private) sessions omit this attribute or use non-group keys.
 */
const GroupConversationScopeSchema = z.templateLiteral([
  z.literal("group:"),
  z.enum(["telegram", "kapso"]),
  z.literal(":"),
  ProviderReferenceSchema,
  z.literal(":"),
  ProviderReferenceSchema,
]);
const GroupScopePartsSchema = z.object({
  kind: z.literal("shared-group"),
  conversationScope: GroupConversationScopeSchema,
  channel: z.enum(["telegram", "kapso"]),
  installationId: ProviderReferenceSchema,
  chatId: ProviderReferenceSchema,
});
export type MemoryConversationKind = "personal" | "shared-group";
export type ParsedConversationMemoryScope =
  | z.output<typeof GroupScopePartsSchema>
  | {
      readonly kind: "personal";
      readonly conversationScope: null;
    }
  | {
      readonly kind: "shared-group";
      readonly conversationScope: string;
    };

/**
 * Intended shared-group memory model for group chats.
 * Storage is a stub/skeleton in G02 — keys and isolation rules are real;
 * persistence and membership grants land with later group-workspace work.
 */
export const sharedGroupMemoryModel = {
  version: 1,
  storage: "stub" as const,
  namespace: "shared-group-memory",
  /**
   * Stable key equals G01 `bindGroupChannelIdentity` conversationScope.
   * Never reuse personal workspace / Eve profile binding keys.
   */
  keyFromConversationScope: (conversationScope: string) => conversationScope,
  rules: {
    /** Group-scoped sessions must not freely read unrelated personal memory. */
    personalRecallFromGroupSession: "deny" as const,
    /** Personal forget/wipe must not delete or poison shared-group keys. */
    personalWipeAffectsSharedGroup: false as const,
    /** Future shared wipe must not erase personal profile bindings. */
    sharedGroupWipeAffectsPersonal: false as const,
    /** One group scope must not read another group's shared memory. */
    crossGroupRead: "deny" as const,
  },
} as const;

/** What PersonalMemory.wipe actually covers today (workspace personal only). */
export const personalWipeCoverage = {
  wiped: ["structured-profile", "bound-profile-notes"] as const,
  neverWiped: [
    "shared-group-memory",
    "group-conversation-scopes",
    "conversation-history",
    "unbound-memory-documents",
  ] as const,
} as const;
const groupConversationScopePattern =
  /^group:(telegram|kapso):([^:\s]{1,256}):([^:\s]{1,256})$/;
export const parseConversationMemoryScope = (
  raw: string | null | undefined
): ParsedConversationMemoryScope => {
  if (raw === null || raw === undefined) {
    return {
      kind: "personal",
      conversationScope: null,
    };
  }
  const trimmed = raw.trim();
  if (!trimmed)
    return {
      kind: "personal",
      conversationScope: null,
    };
  const match = groupConversationScopePattern.exec(trimmed);
  if (match) {
    const decoded = GroupScopePartsSchema.safeParse({
      kind: "shared-group",
      conversationScope: trimmed,
      channel: match[1],
      installationId: match[2],
      chatId: match[3],
    });
    const parts = ((parsed) => (parsed.success ? parsed.data : (() => null)()))(
      decoded
    );
    if (parts) return parts;
  }
  // Malformed `group:` prefixes fail closed as shared-group (deny personal).
  if (trimmed.startsWith("group:")) {
    return {
      kind: "shared-group",
      conversationScope: trimmed,
    };
  }
  return {
    kind: "personal",
    conversationScope: null,
  };
};
const SessionMemoryHintsSchema = z.object({
  conversationScope: z.optional(z.string().min(1).max(320)),
  chatKind: z.optional(z.enum(["private", "group"])),
});
export const classifySessionMemoryKind = (input: {
  readonly conversationScope?: string | null;
  readonly chatKind?: "private" | "group" | null;
}): MemoryConversationKind => {
  if (input.chatKind === "group") return "shared-group";
  return parseConversationMemoryScope(input.conversationScope ?? null).kind;
};

/**
 * Attributes to attach when a group session is minted from a G01 binding.
 * PersonalMemory / recall gates read these; private principals omit them.
 */
export const groupSessionMemoryAttributes = (binding: {
  readonly conversationScope: string;
  readonly chatKind: "group";
  readonly chatId: string;
}) => ({
  conversationScope: binding.conversationScope,
  chatKind: "group" as const,
  groupChatId: binding.chatId,
});
const sessionConversationHints = (
  principal: SessionAuthContext | null | undefined
) => {
  const hints = ((parsed) =>
    parsed.success
      ? parsed.data
      : ((): z.output<typeof SessionMemoryHintsSchema> => ({}))())(
    SessionMemoryHintsSchema.safeParse(principal?.attributes ?? {})
  );
  return {
    conversationScope: hints.conversationScope ?? null,
    chatKind: hints.chatKind ?? null,
  } as const;
};

/**
 * Authorization gate: personal memory surfaces (recall/bind/inspect/mutate)
 * are admitted only for personal conversation kind. Group scopes fail closed.
 */
export const admitPersonalMemoryAccess = async function (input: {
  readonly conversationScope?: string | null;
  readonly chatKind?: "private" | "group" | null;
}) {
  const kind = classifySessionMemoryKind(input);
  if (kind === "shared-group") {
    throw new PersonalMemoryError({
      reason: "cross_scope",
    });
  }
  return {
    kind: "personal" as const,
    parsed: parseConversationMemoryScope(input.conversationScope ?? null),
  };
};

/** Hook used by PersonalMemory / recall paths from the live session principal. */
export const admitPersonalMemoryFromSession = async function (
  principal: SessionAuthContext | null | undefined
) {
  return await admitPersonalMemoryAccess(sessionConversationHints(principal));
};

/**
 * Personal wipe/forget must stay on the personal workspace surface.
 * Passing a group conversationScope as the wipe target is rejected so a
 * forget cannot incorrectly address or poison shared-group scope.
 */
export const admitPersonalWipeTarget = async function (input: {
  readonly conversationScope?: string | null;
  readonly chatKind?: "private" | "group" | null;
}) {
  await admitPersonalMemoryAccess(input);
  // personalWipeAffectsSharedGroup is false by model contract; coverage documents isolation.
  return personalWipeCoverage;
};

/**
 * Shared-group memory read skeleton. Validates scope shape; returns empty
 * stub projection (no storage). Cross-scope personal keys are never returned.
 */
export const readSharedGroupMemoryStub = async function (
  conversationScope: string
) {
  const parsed = parseConversationMemoryScope(conversationScope);
  if (parsed.kind !== "shared-group" || !("channel" in parsed)) {
    throw new PersonalMemoryError({
      reason: "invalid_binding",
    });
  }
  const key = sharedGroupMemoryModel.keyFromConversationScope(
    parsed.conversationScope
  );
  return {
    scope: key,
    namespace: sharedGroupMemoryModel.namespace,
    status: "stub" as const,
    storage: sharedGroupMemoryModel.storage,
    documents: [] as const,
    /** Explicitly empty — never projects personal profile notes. */
    personalProjection: null,
  };
};

/** Deny reading group A's stub under group B's scope (negative isolation). */
export const admitSharedGroupMemoryRead = async function (input: {
  readonly requestedScope: string;
  readonly sessionScope: string;
}) {
  const requested = parseConversationMemoryScope(input.requestedScope);
  const session = parseConversationMemoryScope(input.sessionScope);
  if (
    requested.kind !== "shared-group" ||
    session.kind !== "shared-group" ||
    requested.conversationScope !== session.conversationScope
  ) {
    throw new PersonalMemoryError({
      reason: "cross_scope",
    });
  }
  return await readSharedGroupMemoryStub(requested.conversationScope);
};
