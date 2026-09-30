import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import type { query } from "@db/queries";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, it, vi } from "vitest";
import { setMatrixRoomAvatar } from "./avatar";
import type { matrixRequest } from "./client";
import type { uploadMatrixMedia } from "./media/upload";
import { WorkspaceAccessDenied } from "../workspaces/access";

const mocks = vi.hoisted(() => ({
  query: vi.fn<typeof query>(),
  request: vi.fn<typeof matrixRequest>(),
  upload: vi.fn<typeof uploadMatrixMedia>(),
  sharp: vi.fn<() => unknown>(),
}));
vi.mock("@db/queries", () => ({
  query: mocks.query,
  transaction: async (run: () => Promise<unknown>) => {
    const outer = activeTrace;
    if (!outer) {
      activeTrace = [];
      traces.push(activeTrace);
    }
    try {
      return await run();
    } finally {
      activeTrace = outer;
    }
  },
}));
vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client")>()),
  matrixRequest: mocks.request,
  matrixConfiguration: async () => ({
    serverName: "synthetic.invalid",
    botId: "@_zoen_bot:synthetic.invalid",
  }),
}));
vi.mock("./media/upload", () => ({ uploadMatrixMedia: mocks.upload }));
vi.mock("sharp", () => ({ default: mocks.sharp }));

const dialect = new PgDialect();
const binding = "10000000-0000-4000-8000-000000000001";
const operation = "20000000-0000-4000-8000-000000000001";
const actor = {
  userId: "better-auth:avatar-owner",
  workspaceId: "avatar-workspace",
  authSessionId: "avatar-session",
};
const thumbnail = Buffer.from("synthetic-thumbnail");
const thumbnailUrl = `data:image/webp;base64,${thumbnail.toString("base64")}`;
const file = {
  type: "file" as const,
  mediaType: "image/png",
  filename: "original.png",
  url: "data:image/png;base64,YQ==",
};
const traces: string[][] = [];
let activeTrace: string[] | null = null;
let missingOrganization = false;
let revokedMembership = false;
let avatarRevision: string | null = null;
let avatarUri: string | null = null;
let nativeAvatar: Awaited<ReturnType<typeof matrixRequest>> = {};

beforeEach(() => {
  traces.length = 0;
  activeTrace = null;
  missingOrganization = false;
  revokedMembership = false;
  avatarRevision = null;
  avatarUri = null;
  nativeAvatar = {};
  const image = {
    metadata: async () => ({ format: "png" }),
    autoOrient: () => image,
    resize: () => image,
    webp: () => image,
    timeout: () => image,
    toBuffer: async () => thumbnail,
  };
  mocks.sharp.mockReset().mockReturnValue(image);
  mocks.upload.mockReset().mockImplementation(async () => {
    activeTrace?.push("upload");
    return {
      url: "mxc://synthetic.invalid/avatar",
      info: { mimetype: "image/webp", size: thumbnail.length },
    };
  });
  mocks.request.mockReset().mockImplementation(async (method, path, body) => {
    if (path !== "rooms/!avatar%3Asynthetic.invalid/state/m.room.avatar")
      throw new Error(`Unexpected avatar provider path: ${path}`);
    activeTrace?.push(`provider:${method}`);
    if (method === "GET") return nativeAvatar;
    if (method === "PUT" && body) {
      nativeAvatar = body;
      return {};
    }
    throw new Error(`Unexpected avatar provider method: ${method}`);
  });
  mocks.query.mockReset().mockImplementation(async (statement) => {
    if (!activeTrace) throw new Error("Avatar SQL escaped its transaction");
    const { sql, params } = dialect.sqlToQuery(statement);
    if (
      sql.includes(
        'SELECT w.id AS "workspaceId", w.organization_id AS "organizationId"'
      )
    ) {
      activeTrace.push("locator");
      assert.deepEqual(params, [actor.workspaceId, binding]);
      return [{ workspaceId: actor.workspaceId, organizationId: "avatar-org" }];
    }
    if (sql.includes("SELECT id FROM organizations")) {
      activeTrace.push("organization");
      assert.ok(sql.includes("FOR SHARE"));
      assert.deepEqual(params, ["avatar-org"]);
      return missingOrganization && traces.length === 2
        ? []
        : [{ id: "avatar-org" }];
    }
    if (sql.includes("pg_advisory_xact_lock")) {
      activeTrace.push("room");
      assert.ok(sql.includes("hashtextextended($1, 5)"));
      assert.deepEqual(params, [binding]);
      return [];
    }
    if (sql.includes("SELECT m.role, w.organization_id")) {
      activeTrace.push("workspace-membership");
      assert.deepEqual(params, [actor.userId, actor.workspaceId]);
      return revokedMembership
        ? []
        : [{ role: "owner", organization_id: "avatar-org" }];
    }
    if (sql.includes("SELECT user_id FROM organization_memberships")) {
      activeTrace.push("organization-membership");
      return [{ user_id: actor.userId }];
    }
    if (sql.includes("SELECT id FROM public.session")) {
      activeTrace.push("session");
      return [{ id: actor.authSessionId }];
    }
    if (sql.includes('avatar_uri AS "avatarUri"')) {
      activeTrace.push("metadata");
      return [
        {
          id: binding,
          workspaceId: actor.workspaceId,
          roomId: "!avatar:synthetic.invalid",
          label: "Avatar group",
          epoch: "epoch",
          kind: "group",
          avatarUri,
          avatarRevision,
        },
      ];
    }
    if (sql.includes("UPDATE workspace_group_bindings SET avatar_uri")) {
      activeTrace.push("projection");
      assert.deepEqual(params, [
        avatarUri,
        operation,
        binding,
        actor.workspaceId,
      ]);
      avatarRevision = operation;
      return [];
    }
    throw new Error(`Unexpected avatar SQL: ${sql}`);
  });
});

it.each([null, file])(
  "takes organization then room admission before avatar authority and provider I/O (%j)",
  async (inputFile) => {
    avatarUri = inputFile ? thumbnailUrl : null;
    const result = await setMatrixRoomAvatar(actor, {
      id: binding,
      operationId: operation,
      expectedRevision: null,
      file: inputFile,
    });

    expect(result).toMatchObject({
      status: "saved",
      room: { id: binding, avatarRevision: operation, avatarUri },
    });
    expect(traces).toHaveLength(2);
    const write = traces[1];
    expect(write?.slice(0, 4)).toEqual([
      "locator",
      "organization",
      "room",
      "locator",
    ]);
    for (const authority of [
      "workspace-membership",
      "organization-membership",
      "session",
      "metadata",
      "provider:GET",
    ])
      expect(write?.indexOf(authority)).toBeGreaterThan(
        write?.indexOf("room") ?? -1
      );
    const digest = createHash("sha256")
      .update(avatarUri ?? "")
      .digest("hex");
    expect(mocks.request).toHaveBeenCalledWith(
      "PUT",
      "rooms/!avatar%3Asynthetic.invalid/state/m.room.avatar",
      {
        ...(inputFile && {
          url: "mxc://synthetic.invalid/avatar",
          info: {
            mimetype: "image/webp",
            size: thumbnail.length,
            w: 192,
            h: 192,
          },
        }),
        "org.zoen.avatar.operation": operation,
        "org.zoen.avatar.digest": digest,
      }
    );
    expect(mocks.upload.mock.calls).toEqual(
      inputFile
        ? [
            [
              {
                ...file,
                mediaType: "image/webp",
                filename: "group.webp",
                url: thumbnailUrl,
              },
              "@_zoen_bot:synthetic.invalid",
            ],
          ]
        : []
    );
    expect(mocks.sharp).toHaveBeenCalledTimes(inputFile ? 1 : 0);
    expect(
      write?.filter(
        (event) =>
          event.startsWith("provider:") ||
          event === "upload" ||
          event === "projection"
      )
    ).toEqual(
      inputFile
        ? [
            "provider:GET",
            "upload",
            "provider:PUT",
            "provider:GET",
            "projection",
          ]
        : ["provider:GET", "provider:PUT", "provider:GET", "projection"]
    );
    expect(write?.indexOf("projection")).toBeGreaterThan(
      write?.lastIndexOf("provider:GET") ?? -1
    );
  }
);

it("denies a missing organization at write admission before room locks or provider I/O", async () => {
  missingOrganization = true;
  await expect(
    setMatrixRoomAvatar(actor, {
      id: binding,
      operationId: operation,
      expectedRevision: null,
      file,
    })
  ).rejects.toThrow(WorkspaceAccessDenied);
  expect(traces).toHaveLength(2);
  expect(traces[1]).toEqual(["locator", "organization"]);
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
});

it("rechecks membership before the native avatar write", async () => {
  mocks.request.mockImplementationOnce(async () => {
    activeTrace?.push("provider:GET");
    revokedMembership = true;
    return {};
  });
  await expect(
    setMatrixRoomAvatar(actor, {
      id: binding,
      operationId: operation,
      expectedRevision: null,
      file: null,
    })
  ).rejects.toThrow(WorkspaceAccessDenied);
  expect(mocks.request).toHaveBeenCalledExactlyOnceWith(
    "GET",
    "rooms/!avatar%3Asynthetic.invalid/state/m.room.avatar",
    undefined,
    undefined,
    { maxResponseBytes: 8192 }
  );
  expect(traces[1]).not.toContain("projection");
  expect(mocks.upload).not.toHaveBeenCalled();
});
