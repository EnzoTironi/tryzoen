import { createHash } from "node:crypto";
import { readPayload } from "../payloads/publication";
import { PayloadError } from "../payloads/contract";

import {
  ArtifactError,
  ArtifactMetadataSchema,
  type ArtifactRow,
} from "./model";

export const artifactDigest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export const verifiedArtifact = async function (row: ArtifactRow) {
  if (row.deleted) throw new ArtifactError({ reason: "deleted" });
  const bytes = await readPayload(
    {
      workspaceId: row.workspaceId,
      ownerGeneration: row.artifactId,
      ownerUserId: row.ownerUserId,
      kind: "private-artifact",
    },
    row.payloadId
  ).catch((error: unknown) => {
    if (
      error instanceof PayloadError &&
      (error.reason === "missing" || error.reason === "corrupt")
    )
      throw new ArtifactError({ reason: "corrupt" });
    throw error;
  });
  if (
    bytes.byteLength !== row.byteLength ||
    artifactDigest(bytes) !== row.sha256
  )
    throw new ArtifactError({ reason: "corrupt" });
  if ((row.derivedText === null) !== (row.derivedKind === null))
    throw new ArtifactError({ reason: "corrupt" });
  const metadata = await ArtifactMetadataSchema.parseAsync(row);
  return {
    metadata,
    bytes,
    derived:
      row.derivedText !== null && row.derivedKind !== null
        ? { text: row.derivedText, kind: row.derivedKind }
        : null,
  };
};
