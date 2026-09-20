import { describe, expect, it } from "vitest";
import {
  assertCanAssignRole,
  assertCanManageMembers,
  assertWorkspaceRoleForKind,
  canAssignRole,
  canManageMembers,
  RbacDenied,
  rbacFailureMessage,
} from "./org-rbac";

describe("C01 org/workspace RBAC", () => {
  it("lets admin and personal owner manage members; member cannot", () => {
    expect(canManageMembers("admin")).toBe(true);
    expect(canManageMembers("owner")).toBe(true);
    expect(canManageMembers("member")).toBe(false);
  });

  it("blocks member elevation to admin", async () => {
    expect(canAssignRole("member", "admin")).toBe(false);
    expect(canAssignRole("admin", "admin")).toBe(true);
    expect(canAssignRole("admin", "member")).toBe(true);
    expect(canAssignRole("member", "member")).toBe(false);

    const denied = await Promise.try(async () =>
      assertCanAssignRole("member", "admin")
    ).then(
      () => {
        throw new Error("Expected rejection");
      },
      (error: unknown) => {
        if (error instanceof RbacDenied) return error;
        throw error;
      }
    );
    expect(denied).toEqual(
      new RbacDenied({
        reason: "not_admin",
        message: "Only an admin (or personal owner) can manage members.",
      })
    );
    expect(rbacFailureMessage(denied)).toContain("admin");
  });

  it("fails closed when a non-admin tries to manage members", async () => {
    const denied = await Promise.try(async () =>
      assertCanManageMembers("member")
    ).then(
      () => {
        throw new Error("Expected rejection");
      },
      (error: unknown) => {
        if (error instanceof RbacDenied) return error;
        throw error;
      }
    );
    expect(denied.reason).toBe("not_admin");
  });

  it("keeps personal workspaces on owner; company on admin|member", async () => {
    await expect(
      assertWorkspaceRoleForKind("personal", "owner")
    ).resolves.toBeUndefined();
    await expect(
      Promise.try(async () =>
        assertWorkspaceRoleForKind("personal", "admin")
      ).then(
        () => {
          throw new Error("Expected rejection");
        },
        (error: unknown) => {
          if (error instanceof RbacDenied) return error;
          throw error;
        }
      )
    ).resolves.toMatchObject({ reason: "personal_owner_only" });
    await expect(
      assertWorkspaceRoleForKind("company", "admin")
    ).resolves.toBeUndefined();
    await expect(
      Promise.try(async () =>
        assertWorkspaceRoleForKind("company", "owner")
      ).then(
        () => {
          throw new Error("Expected rejection");
        },
        (error: unknown) => {
          if (error instanceof RbacDenied) return error;
          throw error;
        }
      )
    ).resolves.toMatchObject({ reason: "invalid_role" });
  });

  it("never lets company actors assign personal owner", () => {
    expect(canAssignRole("admin", "owner")).toBe(false);
    expect(canAssignRole("member", "owner")).toBe(false);
  });
});
