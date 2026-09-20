import type { CompanyRole } from "./org-rbac";

/**
 * Google Workspace SSO / invite acceptance rules for C02.
 *
 * Better Auth remains the identity provider (`account.providerId === "google"`).
 * Organization membership stays product-owned (C01 tables) — we do not adopt the
 * Better Auth organization plugin in this slice.
 *
 * Invite path: org admin mints a pending invite for an email; the invitee must
 * present a live Better Auth user whose verified email matches and who has a
 * linked Google account. Domain allowlists are optional policy metadata only.
 */

export class OrgSsoDenied extends Error {
  readonly _tag = "OrgSsoDenied";
  declare readonly reason:
    | "email_mismatch"
    | "email_unverified"
    | "google_account_missing"
    | "invite_not_pending"
    | "invite_expired"
    | "domain_not_allowed";
  constructor(input: {
    readonly reason:
      | "email_mismatch"
      | "email_unverified"
      | "google_account_missing"
      | "invite_not_pending"
      | "invite_expired"
      | "domain_not_allowed";
    readonly message: string;
  }) {
    super(input.message);
    this.name = "OrgSsoDenied";
    Object.assign(this, input);
  }
}
export interface GoogleLinkedIdentity {
  userId: string;
  email: string;
  emailVerified: boolean;
  hasGoogleAccount: boolean;
}
export interface OrganizationInviteView {
  id: string;
  organizationId: string;
  email: string;
  role: CompanyRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: Date;
}
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
export function emailDomain(email: string): string | undefined {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return undefined;
  return normalized.slice(at + 1);
}

/** Optional Workspace hosted-domain gate (fail closed when allowlist is set). */
export function assertEmailDomainAllowed(
  email: string,
  allowedDomains: readonly string[] | undefined
): Promise<void> {
  if (allowedDomains === undefined || allowedDomains.length === 0) {
    return Promise.resolve();
  }
  const domain = emailDomain(email);
  const allowed = new Set(
    allowedDomains.map((value) => value.trim().toLowerCase()).filter(Boolean)
  );
  if (domain === undefined || !allowed.has(domain)) {
    throw new OrgSsoDenied({
      reason: "domain_not_allowed",
      message:
        "Invite email domain is not on the organization Google Workspace allowlist.",
    });
  }
  return Promise.resolve();
}

/**
 * Gate invite acceptance: verified email match + linked Google account.
 * Does not mint membership — callers persist after this operation succeeds.
 */
export async function assertCanAcceptOrgInvite(input: {
  invite: OrganizationInviteView;
  identity: GoogleLinkedIdentity;
  now?: Date;
  allowedDomains?: readonly string[];
}): Promise<void> {
  if (input.invite.status !== "pending") {
    await Promise.reject(
      new OrgSsoDenied({
        reason: "invite_not_pending",
        message: "Only pending organization invites can be accepted.",
      })
    );
  }
  const now = input.now ?? new Date();
  if (input.invite.expiresAt.getTime() <= now.getTime()) {
    await Promise.reject(
      new OrgSsoDenied({
        reason: "invite_expired",
        message: "This organization invite has expired.",
      })
    );
  }
  await assertEmailDomainAllowed(input.invite.email, input.allowedDomains);
  if (!input.identity.emailVerified) {
    await Promise.reject(
      new OrgSsoDenied({
        reason: "email_unverified",
        message:
          "Verify the Google-linked email before joining the organization.",
      })
    );
  }
  if (
    normalizeEmail(input.identity.email) !== normalizeEmail(input.invite.email)
  ) {
    await Promise.reject(
      new OrgSsoDenied({
        reason: "email_mismatch",
        message:
          "Signed-in Google email must match the organization invite email.",
      })
    );
  }
  if (!input.identity.hasGoogleAccount) {
    await Promise.reject(
      new OrgSsoDenied({
        reason: "google_account_missing",
        message:
          "Link a Google account (Workspace SSO) before accepting an organization invite.",
      })
    );
  }
}
export function orgSsoFailureMessage(error: OrgSsoDenied): string {
  return error.message;
}
