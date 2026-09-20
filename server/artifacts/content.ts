import { createHash } from "node:crypto";

import {
  ArtifactError,
  ArtifactMetadataSchema,
  type ArtifactRow,
} from "./model";

export const artifactDigest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export const verifiedArtifact = async function (row: ArtifactRow) {
  if (row.deleted) throw new ArtifactError({ reason: "deleted" });
  if (
    !row.content ||
    row.content.byteLength !== row.byteLength ||
    artifactDigest(row.content) !== row.sha256
  )
    throw new ArtifactError({ reason: "corrupt" });
  if ((row.derivedText === null) !== (row.derivedKind === null))
    throw new ArtifactError({ reason: "corrupt" });
  const metadata = await ArtifactMetadataSchema.parseAsync(row);
  return {
    metadata,
    bytes: row.content,
    derived:
      row.derivedText !== null && row.derivedKind !== null
        ? { text: row.derivedText, kind: row.derivedKind }
        : null,
  };
};
