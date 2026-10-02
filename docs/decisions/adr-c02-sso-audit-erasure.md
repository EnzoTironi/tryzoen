# ADR: Company invitations, audit and SSO requirements (C02)

- **Status:** Workspace invitations and audit receipts are implemented.
  Domain-based SSO enrollment and full organization erasure remain pending.
- **Decision:** Keep Better Auth Google as an identity provider and PostgreSQL
  organization/workspace membership as the access authority. Integration OAuth
  cannot grant company membership.

## Current behavior

`db/services/auth/index.ts` permits canonical user creation through verified
Google identity, subject to the registration policy. It does not install an
organization SSO plugin. Connecting Gmail, Calendar or Contacts grants access to
those APIs; it does not enroll the person into a company.

`server/workspaces/team.ts` implements invitations to existing users by exact
username using `workspace_invites`. An administrator needs current management
access and an app session to invite a user. Only the intended authenticated
recipient may accept a pending, unexpired invitation. Acceptance adds organization
and workspace membership; revocation and prior acceptance prevent replay.
Authorization remains in `server/workspaces/access.ts`, as described in
[company workspace authorization](adr-c01-org-workspace-rbac.md).

Hosted-domain enrollment, invite-email delivery, SCIM provisioning and SAML
authentication remain pending.

## Audit receipts

`server/workspaces/team.ts` inserts `organization_audit_receipts` for invitation
creation, acceptance, revocation and member removal. The member-removal receipt
also records the sessions, jobs, reports, grants and tasks affected by revocation.
The table is owned by `db/schema/organization-audit.ts`.

Receipts are append-only: application mutations insert receipts and must not
update or delete prior ones. The organization foreign key restricts deletion
while receipts remain. Additional sensitive admin actions, including any future
SSO enrollment or organization erasure, require their own audited production
path; an allowed schema action name does not establish that path.

## Account deletion and organization erasure

`server/accounts/privacy.ts` owns partial personal-memory export and online wipe.
`server/accounts/deletion.ts` owns durable personal-account deletion, retained
tombstones and provider/file erasure obligations. It preserves company property
and blocks a sole admin from leaving an organization with remaining members or
workspaces. Admin transfer and closure of company workspaces with no other
members are explicit operations under the same owner.

There is no full organization cascade-erasure endpoint. Future organization
erasure must check current admin authority and retention obligations, record its
request and outcome, and reconcile every affected data surface and backup.
Until that complete path is qualified, do not advertise full company deletion.
Personal account deletion and workspace closure do not establish backup erasure.
See [account deletion](adr-account-deletion.md) for the active contract.

## Pending SSO requirements

An email/domain invitation flow must bind acceptance to a verified email matching
the invitation and the intended linked identity provider. A configured domain
allowlist must reject mismatches. A domain or Google Workspace OAuth grant alone
cannot establish membership or an admin role.

Any implementation must preserve current recipient, expiry, replay, revocation
and management checks and append audit receipts at its real mutation boundary.
Invite delivery, enrollment UI, SCIM and SAML require complete product paths and
runtime qualification. Reconsider an identity-provider plugin only if it can
preserve the existing organization/workspace authority and personal isolation.
