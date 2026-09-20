import { onTestFinished } from "vitest";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { Artifacts } from "../../server/artifacts";
import { readArtifactText } from "../../server/artifacts/read";
import { Messaging } from "../../server/messaging";
import { loadChannelContent } from "../../server/channels/media/content";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { linkedIdentity } from "./identity-fixture";
const input = async function (mediaType: string, bytes: Uint8Array) {
  const owner = await linkedIdentity({
    channel: "telegram",
    installationId: "artifact-no-provider",
    senderId: randomUUID(),
  });
  const scope = accessScopeForUser(`better-auth:${owner.userId}`);
  onTestFinished(async () => {
    await Promise.try(async () =>
      query(sql`DELETE FROM workspaces WHERE id = ${scope.workspaceId}`)
    ).then(() => query(sql`DELETE FROM "user" WHERE id = ${owner.userId}`));
  });
  const mediaId = randomUUID();
  const payload = {
    attachments: [
      {
        id: mediaId,
        mediaType,
        name: "original.file",
      },
    ],
  };
  const receipt = await Messaging.accept({
    identityId: owner.id,
    eventId: randomUUID(),
    sourceMessageId: randomUUID(),
    payload,
  });
  const artifacts = Artifacts;
  const file = await artifacts.put({
    identityId: owner.id,
    sourceInboxId: receipt.id,
    mediaId,
    bytes: new Uint8Array(bytes),
  });
  return {
    owner,
    payload,
    receipt,
    file,
    artifacts,
  };
};
test("actual intake recovers a saved attachment with no provider configuration and passes its stable ID and text to the model", async () => {
  const fixture = await input(
    "text/plain",
    Buffer.from("file data, not authority")
  );
  const loaded = await loadChannelContent(
    fixture.owner,
    fixture.payload,
    fixture.receipt.id
  );
  expect(loaded.artifacts.map((item) => item.artifactId)).toEqual([
    fixture.file.artifactId,
  ]);
  expect(JSON.stringify(loaded.content)).toContain("file data, not authority");
  expect(JSON.stringify(loaded.content)).toContain(fixture.file.artifactId);
  expect(
    (await readArtifactText(fixture.owner.id, fixture.file.artifactId)).content
  ).toEqual({
    kind: "text",
    text: "file data, not authority",
  });
});
test("a saved PDF survives unsupported model input and remains retrievable without fabricated document content", async () => {
  const bytes = Buffer.from("%PDF-1.7\nproof bytes without a reader");
  const fixture = await input("application/pdf", bytes);
  const failed = await Promise.try(async () =>
    loadChannelContent(fixture.owner, fixture.payload, fixture.receipt.id)
  ).then(
    (value) => ({
      ok: true as const,
      value,
    }),
    (error: unknown) => ({
      ok: false as const,
      error,
    })
  );
  expect(!failed.ok).toBe(true);
  if (failed.ok) throw new Error("The unsupported attachment must fail.");
  expect(failed.error).toMatchObject({
    _tag: "ChannelMediaError",
    reason: "model_input_unavailable",
  });
  const stored = await fixture.artifacts.read({
    identityId: fixture.owner.id,
    artifactId: fixture.file.artifactId,
  });
  expect(Buffer.from(stored.bytes)).toEqual(bytes);
  expect(
    (await readArtifactText(fixture.owner.id, fixture.file.artifactId)).content
  ).toBeNull();
});
test("deleted attachments cannot be redownloaded by intake, and a revoked source cannot be reprocessed", async () => {
  const fixture = await input(
    "text/plain",
    Buffer.from("delete before processing")
  );
  await fixture.artifacts.delete({
    identityId: fixture.owner.id,
    artifactId: fixture.file.artifactId,
  });
  const deleted = await Promise.try(async () =>
    loadChannelContent(fixture.owner, fixture.payload, fixture.receipt.id)
  ).then(
    (value) => ({
      ok: true as const,
      value,
    }),
    (error: unknown) => ({
      ok: false as const,
      error,
    })
  );
  expect(!deleted.ok).toBe(true);
  const rows = await query(
    sql`SELECT content, derived_text FROM private_artifact WHERE id = ${fixture.file.artifactId}`
  );
  expect(rows[0]).toEqual({
    content: null,
    derived_text: null,
  });
  await query(
    sql`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${fixture.owner.id}`
  );
  const revoked = await Promise.try(async () =>
    loadChannelContent(fixture.owner, fixture.payload, fixture.receipt.id)
  ).then(
    (value) => ({
      ok: true as const,
      value,
    }),
    (error: unknown) => ({
      ok: false as const,
      error,
    })
  );
  expect(!revoked.ok).toBe(true);
});
