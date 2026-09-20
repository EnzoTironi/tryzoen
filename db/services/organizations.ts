import { and, eq, sql } from "drizzle-orm";
import {
  db,
  organizationMemberships,
  organizations,
  workspaceMemberships,
  workspaces,
} from "@db";
import {
  assertCanAssignRole,
  assertCanManageMembers,
  assertWorkspaceRoleForKind,
  type CompanyRole,
  type WorkspaceRole,
  RbacDenied,
} from "@shared/identity/org-rbac";

export class OrganizationMembershipMissing extends Error {
  readonly _tag = "OrganizationMembershipMissing";
  declare readonly organizationId: string;
  declare readonly userId: string;
  constructor(input: {
    readonly organizationId: string;
    readonly userId: string;
  }) {
    super("OrganizationMembershipMissing");
    this.name = "OrganizationMembershipMissing";
    Object.assign(this, input);
  }
}

class WorkspaceMembershipMissing extends Error {
  readonly _tag = "WorkspaceMembershipMissing";
  declare readonly workspaceId: string;
  declare readonly userId: string;
  constructor(input: {
    readonly workspaceId: string;
    readonly userId: string;
  }) {
    super("WorkspaceMembershipMissing");
    this.name = "WorkspaceMembershipMissing";
    Object.assign(this, input);
  }
}

async function loadOrgMembership(organizationId: string, userId: string) {
  const rows = await db
    .select({
      role: organizationMemberships.role,
    })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId)
      )
    )
    .limit(1);
  return rows[0];
}

async function loadWorkspaceMembership(workspaceId: string, userId: string) {
  const rows = await db
    .select({
      role: workspaceMemberships.role,
      organizationId: workspaces.organizationId,
    })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
    .where(
      and(
        eq(workspaceMemberships.workspaceId, workspaceId),
        eq(workspaceMemberships.userId, userId)
      )
    )
    .limit(1);
  return rows[0];
}

/** Create a company org with the acting user as the first admin. */
export async function createOrganization(input: {
  organizationId: string;
  name: string;
  adminUserId: string;
}) {
  const createdAt = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(organizations).values({
      id: input.organizationId,
      name: input.name.trim(),
      createdAt,
    });
    await tx.insert(organizationMemberships).values({
      organizationId: input.organizationId,
      userId: input.adminUserId,
      role: "admin",
      createdAt,
    });
  });
}

/**
 * Attach a new company workspace under an org. Caller must be org admin.
 * Seeds the caller as workspace admin.
 */
export async function createCompanyWorkspace(input: {
  organizationId: string;
  workspaceId: string;
  actorUserId: string;
}): Promise<void> {
  const membership = await Promise.try(async () =>
    loadOrgMembership(input.organizationId, input.actorUserId)
  ).catch(() => {
    throw new OrganizationMembershipMissing({
      organizationId: input.organizationId,
      userId: input.actorUserId,
    });
  });
  if (membership === undefined) {
    await Promise.reject(
      new OrganizationMembershipMissing({
        organizationId: input.organizationId,
        userId: input.actorUserId,
      })
    );
    return;
  }

  await assertCanManageMembers(membership.role);
  await assertWorkspaceRoleForKind("company", "admin");

  const createdAt = new Date();
  await Promise.try(async () =>
    db.transaction(async (tx) => {
      await tx.insert(workspaces).values({
        id: input.workspaceId,
        createdAt,
        organizationId: input.organizationId,
      });
      await tx.insert(workspaceMemberships).values({
        workspaceId: input.workspaceId,
        userId: input.actorUserId,
        role: "admin",
        createdAt,
      });
    })
  ).catch(() => {
    throw new RbacDenied({
      reason: "invalid_role",
      message: "Failed to create company workspace.",
    });
  });
}

/** Org admin adds/updates an org member role (member cannot elevate). */
export async function setOrganizationMemberRole(input: {
  organizationId: string;
  actorUserId: string;
  targetUserId: string;
  role: CompanyRole;
}): Promise<void> {
  const actor = await loadOrgMembership(
    input.organizationId,
    input.actorUserId
  );
  if (actor === undefined) {
    await Promise.reject(
      new OrganizationMembershipMissing({
        organizationId: input.organizationId,
        userId: input.actorUserId,
      })
    );
    return;
  }

  await assertCanAssignRole(actor.role, input.role);

  const createdAt = new Date();
  await (async () => {
    await db
      .insert(organizationMemberships)
      .values({
        organizationId: input.organizationId,
        userId: input.targetUserId,
        role: input.role,
        createdAt,
      })
      .onConflictDoUpdate({
        target: [
          organizationMemberships.organizationId,
          organizationMemberships.userId,
        ],
        set: { role: input.role },
      });
  })();
}

/** Workspace admin/owner manages workspace membership (member cannot elevate). */
export async function setWorkspaceMemberRole(input: {
  workspaceId: string;
  actorUserId: string;
  targetUserId: string;
  role: WorkspaceRole;
}): Promise<void> {
  const actor = await loadWorkspaceMembership(
    input.workspaceId,
    input.actorUserId
  );
  if (actor === undefined) {
    await Promise.reject(
      new WorkspaceMembershipMissing({
        workspaceId: input.workspaceId,
        userId: input.actorUserId,
      })
    );
    return;
  }

  const kind = actor.organizationId ? "company" : "personal";
  await assertWorkspaceRoleForKind(kind, input.role);
  await assertCanAssignRole(actor.role, input.role);

  const createdAt = new Date();
  await (async () => {
    await db
      .insert(workspaceMemberships)
      .values({
        workspaceId: input.workspaceId,
        userId: input.targetUserId,
        role: input.role,
        createdAt,
      })
      .onConflictDoUpdate({
        target: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
        set: { role: input.role },
      });
  })();
}

/** Count org admins (used by tests / future last-admin guards). */
export async function countOrganizationAdmins(organizationId: string) {
  const rows = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.role, "admin")
      )
    );
  return rows[0]?.count ?? 0;
}
