import { z } from "zod";

/** Company control-plane roles (org + company workspace). */
const companyRoleSchema = z.enum(["admin", "member"]);
export type CompanyRole = z.output<typeof companyRoleSchema>;

/** Workspace membership roles including personal `owner`. */
const workspaceRoleSchema = z.enum(["owner", "admin", "member"]);
export type WorkspaceRole = z.output<typeof workspaceRoleSchema>;
export class RbacDenied extends Error {
  readonly _tag = "RbacDenied";
  declare readonly reason:
    | "not_admin"
    | "cannot_elevate"
    | "personal_owner_only"
    | "invalid_role"
    | "last_admin";
  constructor(input: {
    readonly reason:
      | "not_admin"
      | "cannot_elevate"
      | "personal_owner_only"
      | "invalid_role"
      | "last_admin";
    readonly message: string;
  }) {
    super(input.message);
    this.name = "RbacDenied";
    Object.assign(this, input);
  }
}

/** Personal sole controller or company admin may manage workspace members. */
export function canManageMembers(role: WorkspaceRole | CompanyRole): boolean {
  return role === "owner" || role === "admin";
}

/** Members (and anyone lacking manage rights) cannot grant/change admin. */
export function canAssignRole(
  actorRole: WorkspaceRole | CompanyRole,
  targetRole: WorkspaceRole | CompanyRole
): boolean {
  if (!canManageMembers(actorRole)) return false;
  if (targetRole === "owner") {
    // `owner` is reserved for personal workspaces; company actors never assign it.
    return actorRole === "owner";
  }
  if (targetRole === "admin") {
    return actorRole === "admin" || actorRole === "owner";
  }
  return true;
}
export function assertCanManageMembers(
  actorRole: WorkspaceRole | CompanyRole
): Promise<void> {
  return canManageMembers(actorRole)
    ? Promise.resolve()
    : Promise.reject(
        new RbacDenied({
          reason: "not_admin",
          message: "Only an admin (or personal owner) can manage members.",
        })
      );
}
export async function assertCanAssignRole(
  actorRole: WorkspaceRole | CompanyRole,
  targetRole: WorkspaceRole | CompanyRole
): Promise<void> {
  await assertCanManageMembers(actorRole);
  if (!canAssignRole(actorRole, targetRole)) {
    await Promise.reject(
      new RbacDenied({
        reason: "cannot_elevate",
        message: "Members cannot elevate roles; only admins may grant admin.",
      })
    );
  }
}

/**
 * Personal workspaces must keep a single `owner` membership role.
 * Company workspaces use `admin` | `member` only.
 */
export function assertWorkspaceRoleForKind(
  kind: "personal" | "company",
  role: WorkspaceRole
): Promise<void> {
  if (kind === "personal") {
    return role === "owner"
      ? Promise.resolve()
      : Promise.reject(
          new RbacDenied({
            reason: "personal_owner_only",
            message: "Personal workspaces use the owner role only.",
          })
        );
  }
  if (role === "owner") {
    throw new RbacDenied({
      reason: "invalid_role",
      message: "Company workspaces use admin or member roles, not owner.",
    });
  }
  return Promise.resolve();
}
export function rbacFailureMessage(error: RbacDenied): string {
  return error.message;
}
