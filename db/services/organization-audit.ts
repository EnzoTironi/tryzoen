import { desc, eq } from "drizzle-orm";
import {
  db,
  organizationAuditReceipts,
  type OrganizationAuditMetadata,
} from "@db";

export const organizationAuditActions = [
  "invite_created",
  "invite_accepted",
  "invite_revoked",
  "member_role_changed",
  "member_removed",
  "org_erasure_requested",
  "org_erasure_denied",
] as const;

export type OrganizationAuditAction = (typeof organizationAuditActions)[number];

class OrganizationAuditAppendFailed extends Error {
  readonly _tag = "OrganizationAuditAppendFailed";

  constructor(input: { readonly message: string }) {
    super(input.message);
    this.name = "OrganizationAuditAppendFailed";
    Object.assign(this, input);
  }
}

/**
 * Append-only org admin receipts. Callers must never update or delete rows.
 */
export async function appendOrganizationAuditReceipt(input: {
  id: string;
  organizationId: string;
  actorUserId: string;
  action: OrganizationAuditAction;
  targetUserId?: string | null;
  targetEmail?: string | null;
  metadata?: OrganizationAuditMetadata;
  createdAt?: Date;
}): Promise<void> {
  try {
    await Promise.try(async () => {
      await db.insert(organizationAuditReceipts).values({
        id: input.id,
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: input.action,
        targetUserId: input.targetUserId ?? null,
        targetEmail: input.targetEmail ?? null,
        metadata: input.metadata ?? {},
        createdAt: input.createdAt ?? new Date(),
      });
    });
    return;
  } catch {
    throw new OrganizationAuditAppendFailed({
      message: "Failed to append organization audit receipt.",
    });
  }
}

/** Newest-first receipt list for an organization (admin review / export). */
export async function listOrganizationAuditReceipts(
  organizationId: string,
  limit = 100
) {
  return db
    .select()
    .from(organizationAuditReceipts)
    .where(eq(organizationAuditReceipts.organizationId, organizationId))
    .orderBy(desc(organizationAuditReceipts.createdAt))
    .limit(Math.max(1, Math.min(limit, 500)));
}
