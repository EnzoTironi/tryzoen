import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { onTestFinished } from "vitest";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { mapAsync } from "../../server/operations/async";
import { jsonString } from "@shared/validation";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import type { Identity } from "../../server/accounts";
import { Artifacts } from "../../server/artifacts";
import { artifactDigest } from "../../server/artifacts/content";
import { ArtifactId, artifactLimits } from "../../server/artifacts/model";
import { Messaging } from "../../server/messaging";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { linkedIdentity } from "./identity-fixture";
const fixture = async function (
  body: (context: {
    artifacts: typeof Artifacts;
    messaging: typeof Messaging;
    sql: typeof import("drizzle-orm").sql;
    owner: Identity;
    other: Identity;
    linked: string;
  }) => Promise<void>
) {
  const identities: Identity[] = [];
  onTestFinished(async () => {
    await mapAsync(
      identities,
      (identity) => {
        const scope = accessScopeForUser(`better-auth:${identity.userId}`);
        return Promise.try(async () =>
          query(sql`DELETE FROM workspaces WHERE id = ${scope.workspaceId}`)
        ).then(() =>
          query(sql`DELETE FROM "user" WHERE id = ${identity.userId}`)
        );
      },
      1
    );
  });
  for (let index = 0; index < 2; index++) {
    const identity = await linkedIdentity({
      channel: "telegram",
      installationId: "artifact-proof",
      senderId: randomUUID(),
    });
    identities.push(identity);
  }
  const [owner, other] = identities;
  if (!owner || !other) throw new Error("Fixture accounts were not created.");
  const linked = randomUUID();
  await query(sql`INSERT INTO channel_identity (id, channel, installation_id, sender_id, user_id)
    VALUES (${linked}, 'kapso', 'artifact-proof', ${linked}, ${owner.userId})`);
  await body({
    artifacts: Artifacts,
    messaging: Messaging,
    sql,
    owner,
    other,
    linked,
  });
};
const run = (body: Parameters<typeof fixture>[0]) => fixture(body);
const source = async function (
  messaging: typeof Messaging,
  identityId: string,
  name?: string,
  mediaType?: string
) {
  const mediaId = randomUUID();
  const eventId = randomUUID();
  const receipt = await messaging.accept({
    identityId,
    eventId,
    sourceMessageId: `message-${eventId}`,
    payload: {
      attachments: [
        {
          id: mediaId,
          name: name ?? "notes.txt",
          mediaType: mediaType ?? "text/plain",
        },
      ],
    },
  });
  const sourceInboxId = await ArtifactId.parseAsync(receipt.id);
  return {
    identityId,
    sourceInboxId,
    mediaId,
  };
};
test("persists immutable bytes and server-owned source metadata; exact replay returns one ID and same-name new events stay distinct", () =>
  run(async ({ artifacts, messaging, owner }) => {
    const input = await source(messaging, owner.id);
    const bytes = Buffer.from("private attachment");
    const first = await artifacts.put({
      ...input,
      bytes,
    });
    expect(first).toMatchObject({
      filename: "notes.txt",
      mediaType: "text/plain",
      byteLength: bytes.length,
      sha256: artifactDigest(bytes),
      sourceMediaId: input.mediaId,
    });
    const reread = await artifacts.read({
      identityId: owner.id,
      artifactId: first.artifactId,
    });
    expect(Buffer.from(reread.bytes)).toEqual(bytes);
    expect(reread.metadata).toEqual(first);
    expect(
      await artifacts.put({
        ...input,
        bytes,
      })
    ).toEqual(first);
    const second = await artifacts.put({
      ...(await source(messaging, owner.id)),
      bytes,
    });
    expect(second.filename).toBe(first.filename);
    expect(second.artifactId).not.toBe(first.artifactId);
    expect(
      await artifacts.list({
        identityId: owner.id,
        limit: 20,
      })
    ).toHaveLength(2);
    expect(
      await artifacts
        .put(
          Object.assign({}, input, {
            bytes,
            filename: "injected.txt",
          })
        )
        .then(
          () => {
            throw new Error("Expected operation to fail");
          },
          (error: unknown) => error
        )
    ).toMatchObject({
      _tag: "ArtifactError",
      reason: "invalid_input",
    });
    expect(
      await artifacts
        .put({
          ...input,
          bytes: Buffer.from("different attachment"),
        })
        .then(
          () => {
            throw new Error("Expected operation to fail");
          },
          (error: unknown) => error
        )
    ).toMatchObject({
      _tag: "ArtifactError",
      reason: "source_conflict",
    });
  }));
test("concurrent exact source replay has one durable ID", () =>
  run(async ({ artifacts, messaging, owner }) => {
    const input = {
      ...(await source(messaging, owner.id)),
      bytes: Buffer.from("one source"),
    };
    const results = await Promise.all(
      Array.from(
        {
          length: 8,
        },
        () => artifacts.put(input)
      )
    );
    expect(new Set(results.map((result) => result.artifactId)).size).toBe(1);
    expect(
      await artifacts.list({
        identityId: owner.id,
        limit: 20,
      })
    ).toHaveLength(1);
  }));
test("source lookup rejects changed source metadata and missing or foreign inbox bindings", () =>
  run(async ({ artifacts, messaging, owner, other }) => {
    const input = await source(messaging, owner.id);
    await artifacts.put({
      ...input,
      bytes: Buffer.from("original"),
    });
    expect(
      await artifacts
        .readForSource({
          ...input,
          identityId: other.id,
        })
        .then(
          () => {
            throw new Error("Expected operation to fail");
          },
          (error: unknown) => error
        )
    ).toMatchObject({
      _tag: "ArtifactError",
      reason: "source_invalid",
    });
    expect(
      await artifacts
        .readForSource({
          ...input,
          mediaId: randomUUID(),
        })
        .then(
          () => {
            throw new Error("Expected operation to fail");
          },
          (error: unknown) => error
        )
    ).toMatchObject({
      _tag: "ArtifactError",
      reason: "source_invalid",
    });
    await query(
      sql`UPDATE channel_inbox SET payload = jsonb_set(payload, '{attachments,0,name}', '"changed.txt"') WHERE id = ${input.sourceInboxId}`
    );
    expect(
      await artifacts.readForSource(input).then(
        () => {
          throw new Error("Expected operation to fail");
        },
        (error: unknown) => error
      )
    ).toMatchObject({
      _tag: "ArtifactError",
      reason: "source_conflict",
    });
  }));
test("scopes every operation to the current account and membership, and source revocation blocks linked readers", () =>
  run(async ({ artifacts, messaging, owner, other, linked }) => {
    const file = await artifacts.put({
      ...(await source(messaging, owner.id)),
      bytes: Buffer.from("account private"),
    });
    const stranger = {
      identityId: other.id,
      artifactId: file.artifactId,
    };
    expect(
      await artifacts.read(stranger).then(
        () => {
          throw new Error("Expected operation to fail");
        },
        (error: unknown) => error
      )
    ).toMatchObject({
      _tag: "ArtifactError",
      reason: "not_found",
    });
    expect(
      await artifacts.delete(stranger).then(
        () => {
          throw new Error("Expected operation to fail");
        },
        (error: unknown) => error
      )
    ).toMatchObject({
      _tag: "ArtifactError",
      reason: "not_found",
    });
    expect(
      await artifacts.list({
        identityId: other.id,
        limit: 20,
      })
    ).toEqual([]);
    expect(
      (
        await artifacts.read({
          identityId: linked,
          artifactId: file.artifactId,
        })
      ).metadata.artifactId
    ).toBe(file.artifactId);
    await query(
      sql`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${owner.id}`
    );
    expect(
      await artifacts
        .read({
          identityId: owner.id,
          artifactId: file.artifactId,
        })
        .then(
          () => {
            throw new Error("Expected operation to fail");
          },
          (error: unknown) => error
        )
    ).toMatchObject({
      _tag: "ArtifactError",
      reason: "not_found",
    });
    expect(
      await artifacts
        .read({
          identityId: linked,
          artifactId: file.artifactId,
        })
        .then(
          () => {
            throw new Error("Expected operation to fail");
          },
          (error: unknown) => error
        )
    ).toMatchObject({
      _tag: "ArtifactError",
      reason: "not_found",
    });
    expect(
      await artifacts
        .setDerived({
          identityId: linked,
          artifactId: file.artifactId,
          sha256: file.sha256,
          kind: "text",
          text: "private",
        })
        .then(
          () => {
            throw new Error("Expected operation to fail");
          },
          (error: unknown) => error
        )
    ).toMatchObject({
      _tag: "ArtifactError",
      reason: "not_found",
    });
    expect(
      await artifacts.list({
        identityId: linked,
        limit: 20,
      })
    ).toEqual([]);
    // A still-active owner may erase bytes even after disconnecting the source.
    expect(
      (
        await artifacts.delete({
          identityId: linked,
          artifactId: file.artifactId,
        })
      ).status
    ).toBe("deleted");
    const scope = accessScopeForUser(`better-auth:${owner.userId}`);
    await query(
      sql`DELETE FROM workspace_memberships WHERE workspace_id = ${scope.workspaceId} AND user_id = ${scope.userId}`
    );
    expect(
      await artifacts
        .list({
          identityId: linked,
          limit: 20,
        })
        .then(
          () => {
            throw new Error("Expected operation to fail");
          },
          (error: unknown) => error
        )
    ).toMatchObject({
      _tag: "ArtifactError",
      reason: "not_found",
    });
  }));
test("detects persisted byte corruption before content or derivation can be returned", () =>
  run(async ({ artifacts, messaging, owner }) => {
    const file = await artifacts.put({
      ...(await source(messaging, owner.id)),
      bytes: Buffer.from("good"),
    });
    await query(
      sql`UPDATE private_artifact SET content = ${Buffer.from("evil")} WHERE id = ${file.artifactId}`
    );
    expect(
      await artifacts
        .read({
          identityId: owner.id,
          artifactId: file.artifactId,
        })
        .then(
          () => {
            throw new Error("Expected operation to fail");
          },
          (error: unknown) => error
        )
    ).toMatchObject({
      _tag: "ArtifactError",
      reason: "corrupt",
    });
    expect(
      await artifacts
        .setDerived({
          identityId: owner.id,
          artifactId: file.artifactId,
          sha256: file.sha256,
          kind: "text",
          text: "good",
        })
        .then(
          () => {
            throw new Error("Expected operation to fail");
          },
          (error: unknown) => error
        )
    ).toMatchObject({
      _tag: "ArtifactError",
      reason: "corrupt",
    });
  }));
test("derived text is hash-bound and UTF-8 bounded; deletion wipes bytes and derivatives without resurrection", () =>
  run(async ({ artifacts, messaging, owner }) => {
    const input = await source(messaging, owner.id);
    const bytes = Buffer.from("source text");
    const file = await artifacts.put({
      ...input,
      bytes,
    });
    const access = {
      identityId: owner.id,
      artifactId: file.artifactId,
    };
    expect(
      await artifacts
        .setDerived({
          ...access,
          sha256: "0".repeat(64),
          kind: "text",
          text: "wrong revision",
        })
        .then(
          () => {
            throw new Error("Expected operation to fail");
          },
          (error: unknown) => error
        )
    ).toMatchObject({
      _tag: "ArtifactError",
      reason: "source_conflict",
    });
    expect(
      await artifacts
        .setDerived({
          ...access,
          sha256: file.sha256,
          kind: "text",
          text: "é".repeat(32769),
        })
        .then(
          () => {
            throw new Error("Expected operation to fail");
          },
          (error: unknown) => error
        )
    ).toMatchObject({
      _tag: "ArtifactError",
      reason: "invalid_input",
    });
    await artifacts.setDerived({
      ...access,
      sha256: file.sha256,
      kind: "text",
      text: "é".repeat(32768),
    });
    expect((await artifacts.read(access)).derived?.text.length).toBe(32768);
    expect(await artifacts.delete(access)).toEqual(
      await artifacts.delete(access)
    );
    expect(
      await artifacts.read(access).then(
        () => {
          throw new Error("Expected operation to fail");
        },
        (error: unknown) => error
      )
    ).toMatchObject({
      _tag: "ArtifactError",
      reason: "deleted",
    });
    expect(
      await artifacts.readForSource(input).then(
        () => {
          throw new Error("Expected operation to fail");
        },
        (error: unknown) => error
      )
    ).toMatchObject({
      _tag: "ArtifactError",
      reason: "deleted",
    });
    expect(
      await artifacts
        .put({
          ...input,
          bytes,
        })
        .then(
          () => {
            throw new Error("Expected operation to fail");
          },
          (error: unknown) => error
        )
    ).toMatchObject({
      _tag: "ArtifactError",
      reason: "deleted",
    });
    expect(
      await artifacts
        .setDerived({
          ...access,
          sha256: file.sha256,
          kind: "text",
          text: "revive",
        })
        .then(
          () => {
            throw new Error("Expected operation to fail");
          },
          (error: unknown) => error
        )
    ).toMatchObject({
      _tag: "ArtifactError",
      reason: "deleted",
    });
    const rows = await query(
      sql`SELECT content, derived_text, derived_kind, deleted_at IS NOT NULL AS deleted FROM private_artifact WHERE id = ${file.artifactId}`
    );
    expect(rows[0]).toEqual({
      content: null,
      derived_text: null,
      derived_kind: null,
      deleted: true,
    });
  }));
test("database rejects orphan derived text and invalid byte lengths, and source deletion cascades", () =>
  run(async ({ artifacts, messaging, owner }) => {
    const input = await source(messaging, owner.id);
    const file = await artifacts.put({
      ...input,
      bytes: Buffer.from("constraint"),
    });
    for (const statement of [
      sql`UPDATE private_artifact SET derived_text = 'orphan', derived_kind = NULL WHERE id = ${file.artifactId}`,
      sql`UPDATE private_artifact SET derived_text = ${"é".repeat(32769)}, derived_kind = 'text' WHERE id = ${file.artifactId}`,
      sql`UPDATE private_artifact SET byte_length = 0, content = ${Buffer.alloc(0)} WHERE id = ${file.artifactId}`,
    ]) {
      await expect(query(statement)).rejects.toMatchObject({
        _tag: "SqlError",
      });
    }
    expect(
      await artifacts
        .put({
          ...input,
          bytes: Buffer.alloc(artifactLimits.bytes + 1),
        })
        .then(
          () => {
            throw new Error("Expected operation to fail");
          },
          (error: unknown) => error
        )
    ).toMatchObject({
      _tag: "ArtifactError",
      reason: "invalid_input",
    });
    await query(
      sql`DELETE FROM channel_inbox WHERE id = ${input.sourceInboxId}`
    );
    expect(
      await artifacts
        .read({
          identityId: owner.id,
          artifactId: file.artifactId,
        })
        .then(
          () => {
            throw new Error("Expected operation to fail");
          },
          (error: unknown) => error
        )
    ).toMatchObject({
      _tag: "ArtifactError",
      reason: "not_found",
    });
  }));
test("a fresh process reads exact persisted bytes after the writing process and its database pool have exited", () =>
  run(async ({ messaging, owner }) => {
    const input = await source(messaging, owner.id);
    const resultSchema = jsonString(
      z.object({
        artifactId: z.string(),
        sha256: z.string(),
        text: z.string(),
      })
    );
    const childPath = fileURLToPath(
      new URL("./artifacts-process.ts", import.meta.url)
    );
    const written = (
      await promisify(execFile)(
        process.execPath,
        ["--import", "tsx", childPath, "put", JSON.stringify(input)],
        {
          timeout: 15_000,
        }
      )
    ).stdout;
    const metadata = await resultSchema.parseAsync(written);
    const read = (
      await promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          childPath,
          "read",
          JSON.stringify({
            identityId: owner.id,
            artifactId: metadata.artifactId,
          }),
        ],
        {
          timeout: 15_000,
        }
      )
    ).stdout;
    const restored = await resultSchema.parseAsync(read);
    expect(restored).toEqual({
      ...metadata,
      text: "stored before writer process exited",
    });
  }));
