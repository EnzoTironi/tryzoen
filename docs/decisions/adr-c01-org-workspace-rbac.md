# ADR: Company workspace authorization (C01)

- **Status:** Accepted; implemented by the workspace and account owners below.
- **Decision:** Keep organization and workspace membership in PostgreSQL.
  Better Auth supplies identity; product membership determines company access.
  Personal workspaces retain their separate owner boundary.

## Membership model and owners

| Responsibility                                            | Current owner                    |
| --------------------------------------------------------- | -------------------------------- |
| Organizations and organization membership                 | `db/schema/organizations.ts`     |
| Workspace parent and membership roles                     | `db/schema/workspaces.ts`        |
| Personal workspace provisioning                           | `db/services/scope.ts`           |
| Company workspace creation and listing                    | `server/workspaces/directory.ts` |
| Current membership, management and delegated-access gates | `server/workspaces/access.ts`    |
| Invitations and member removal                            | `server/workspaces/team.ts`      |
| Admin transfer and account-deletion safeguards            | `server/accounts/deletion.ts`    |

Organizations have `admin` and `member` roles. A workspace with no organization
is personal; its canonical user has the `owner` membership. Company workspace
creation grants the creator `admin` in both the organization and workspace.
Accepted invitations grant the recipient `member` in both scopes.

Company access requires both current workspace and organization membership.
`requireWorkspaceAccess` denies management actions to members and returns
`WorkspaceAccessDenied` when authority is missing. A copied workspace ID, group
binding or delegated task cannot create membership or elevate a role. Personal
access also requires the canonical personal workspace and its owner membership.

## Invitations and removal

`server/workspaces/team.ts` invites an existing user by exact username through
`workspace_invites`. Creation requires current management access and an app
session. Acceptance requires the intended authenticated recipient, a pending
unexpired invitation and current access. Accepted or revoked invitations cannot
be accepted again.

Member removal requires management access and targets another workspace member;
it cannot remove the caller or an administrator through the member-removal path.
Before deleting membership, it cancels queued reports, revokes affected agent
grants, cancels their open protocol tasks and revokes the member's vault and
WhatsApp delegations. Membership removal cascades sessions, scheduled jobs, runs
and report outputs, and retires the member's private memory namespace.

The `member_removed` receipt records the affected session, job, outbox, grant and
task counts. Use-time checks deny subsequent access. Shared Google connections
remain in workspace custody; a removed member cannot use them or move them into
a personal workspace. Group access requires a current binding and membership.

## Account lifecycle

`server/accounts/deletion.ts` blocks personal deletion by a sole company admin
while the organization still has members or workspaces. The authenticated admin
can transfer the role to an existing member. Closing company workspaces requires
that no other organization member remains. These operations do not provide a
full organization erasure or backup purge.

## Design constraints and verification

Keep product membership independent of an authentication plugin. A future SSO
integration must use the same membership authority rather than introducing a
second source of access. See [company invitations and SSO requirements](adr-c02-sso-audit-erasure.md).

`tests/runtime/workspace-boundaries.integration.ts` covers cross-workspace denial,
revoked authority and group isolation. `tests/runtime/workspace-team.integration.ts`
covers invitation recipients, expiry, revocation and replay.
`tests/runtime/account-deletion.integration.ts` covers the admin transfer and
closure boundaries. Database constraints and these behavior tests must remain
part of any authorization change.
