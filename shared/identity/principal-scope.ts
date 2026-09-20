import { isValid } from "@shared/validation";
import { z } from "zod";
import type { ConnectionPrincipal } from "eve/connections";
import type { SessionAuthContext } from "eve/context";
import { accessScopeForUser } from "@shared/identity/access-scope";
const identifier = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), "Expected trimmed text");
const decodePrincipal = z.object({
  attributes: z.object({
    workspaceId: identifier,
    workspaceKind: z.optional(z.enum(["personal", "company"])),
  }),
  id: z.optional(identifier),
  principalId: z.optional(identifier),
});
class PrincipalScopeError extends Error {
  readonly _tag = "PrincipalScopeError";
  constructor(input: { readonly message: string }) {
    super(input.message);
    this.name = "PrincipalScopeError";
    Object.assign(this, input);
  }
}

/** Shared executions must not inherit the sender's private workspace. */
export function isSharedPrincipal(
  input:
    | SessionAuthContext
    | Extract<
        ConnectionPrincipal,
        {
          type: "user";
        }
      >
) {
  return (
    ("authenticator" in input && input.authenticator === "a2a") ||
    Boolean(input.attributes?.agentGrantId) ||
    Boolean(input.attributes?.groupBindingId) ||
    input.attributes?.chatKind === "group" ||
    (isValid(z.string(), input.attributes?.conversationScope) &&
      input.attributes.conversationScope.startsWith("group:"))
  );
}
export function scopeFromPrincipal(
  input:
    | SessionAuthContext
    | Extract<
        ConnectionPrincipal,
        {
          type: "user";
        }
      >
) {
  if (isSharedPrincipal(input)) {
    throw new PrincipalScopeError({
      message:
        "Shared agent executions require an explicitly granted workspace tool.",
    });
  }
  const principal = ((parsed) => {
    if (!parsed.success)
      throw (() =>
        new PrincipalScopeError({
          message: "An authenticated workspace user is required.",
        }))();
    return parsed.data;
  })(decodePrincipal.safeParse(input));
  const userId = principal.id ?? principal.principalId;
  if (
    !userId ||
    (principal.id &&
      principal.principalId &&
      principal.id !== principal.principalId)
  ) {
    throw new PrincipalScopeError({
      message: "An unambiguous authenticated workspace user is required.",
    });
  }
  const scope = accessScopeForUser(userId);
  // This marker is issued only by an authenticated route after live membership
  // validation. Resource services still recheck membership at execution time.
  if (
    principal.attributes.workspaceKind === "company" &&
    !principal.attributes.workspaceId.startsWith("personal:")
  ) {
    return {
      userId,
      workspaceId: principal.attributes.workspaceId,
    };
  }
  if (scope.workspaceId !== principal.attributes.workspaceId) {
    throw new PrincipalScopeError({
      message: "The workspace does not belong to the authenticated user.",
    });
  }
  return scope;
}
