import { transaction } from "@db/queries";
import type { billingEntitlements } from "@db/schema/billing";
import type { z } from "zod";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "./access";

/**
 * Resolve a billing subject from current app authority, never a submitted payer.
 * This is identity resolution only: it does not read entitlements, reserve a
 * budget, authorize a warehouse connection or create a provider charge.
 * Admission must call it inside the transaction holding its own ordered fences.
 */
export async function resolveWorkspaceBillingSubject(
  actor: z.output<typeof WorkspaceActorSchema>
): Promise<
  Pick<typeof billingEntitlements.$inferSelect, "subjectType" | "subjectId">
> {
  if (
    !actor.authSessionId ||
    actor.groupBindingId ||
    actor.groupEpoch ||
    actor.matrixIdentityId ||
    actor.scheduledRunLeaseToken
  )
    throw new WorkspaceAccessDenied();
  return await transaction(async () => {
    const access = await requireWorkspaceAccess(actor);
    if (access.organizationId !== null) {
      if (
        !access.organizationId ||
        access.organizationId !== access.organizationId.trim()
      )
        throw new WorkspaceAccessDenied();
      return { subjectType: "organization", subjectId: access.organizationId };
    }
    // The existing session predicate proves this exact suffix is its raw
    // BetterAuth userId; remove one prefix, never normalize another principal.
    if (!access.userId.startsWith("better-auth:"))
      throw new WorkspaceAccessDenied();
    const subjectId = access.userId.slice("better-auth:".length);
    if (!subjectId) throw new WorkspaceAccessDenied();
    return { subjectType: "user", subjectId };
  });
}
