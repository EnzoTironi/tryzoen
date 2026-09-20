import { and, eq } from "drizzle-orm";
import { db, organizationMemberships } from "@db";
import {
  assertOrgErasureAllowed,
  type OrgErasureDecision,
} from "@shared/identity/org-erasure";
import { appendOrganizationAuditReceipt } from "./organization-audit";

import { OrganizationMembershipMissing } from "./organizations";

/**
 * Request org-scoped erasure. Always fail-closed until cascade is implemented;
 * writes append-only receipts for both request and denial.
 */
export async function requestOrganizationErasure(input: {
  organizationId: string;
  actorUserId: string;
  requestReceiptId: string;
  decisionReceiptId: string;
  retentionHold?: boolean;
}): Promise<OrgErasureDecision> {
  const actor = await (async () => {
    const rows = await db
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, input.organizationId),
          eq(organizationMemberships.userId, input.actorUserId)
        )
      )
      .limit(1);
    return rows[0];
  })();
  if (actor === undefined) {
    await Promise.reject(
      new OrganizationMembershipMissing({
        organizationId: input.organizationId,
        userId: input.actorUserId,
      })
    );
    return {
      status: "denied" as const,
      reason: "not_admin" as const,
      notErased: [],
      limits: "missing membership",
    };
  }

  await appendOrganizationAuditReceipt({
    id: input.requestReceiptId,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: "org_erasure_requested",
    metadata: { retentionHold: Boolean(input.retentionHold) },
  });

  const decision = await assertOrgErasureAllowed({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorRole: actor.role,
    retentionHold: input.retentionHold,
  });

  await appendOrganizationAuditReceipt({
    id: input.decisionReceiptId,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: "org_erasure_denied",
    metadata: {
      reason: decision.reason,
      notErased: [...decision.notErased],
    },
  });

  return decision;
}
