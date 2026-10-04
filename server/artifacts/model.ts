import { z } from "zod";

import { IdentityId } from "../messaging/model";

export const artifactLimits = {
  bytes: 10 * 1024 * 1024,
  textBytes: 64 * 1024,
} as const;
const reference = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), "Expected trimmed text");
export const ArtifactId = IdentityId;
const ArtifactHash = z.string().regex(/^[0-9a-f]{64}$/u);
const ArtifactText = z
  .string()
  .refine(
    (text) =>
      text.isWellFormed() &&
      Buffer.byteLength(text, "utf8") <= artifactLimits.textBytes
  );
const ArtifactBytes = z
  .instanceof(Uint8Array)
  .refine(
    (bytes) => bytes.byteLength >= 1 && bytes.byteLength <= artifactLimits.bytes
  );
export const ArtifactReferenceSchema = z.object({
  artifactId: ArtifactId,
  sha256: ArtifactHash,
  filename: reference,
  mediaType: z.string().min(1).max(128),
  byteLength: z.number().int().min(1).max(artifactLimits.bytes),
});
export type ArtifactReference = z.output<typeof ArtifactReferenceSchema>;
export const ArtifactMetadataSchema = z.object({
  ...ArtifactReferenceSchema.shape,
  createdAt: z.string(),
  sourceEventId: reference,
  sourceMessageId: reference,
  sourceMediaId: reference,
});
const ArtifactDerivedSchema = z.object({
  text: ArtifactText,
  kind: z.enum(["text", "transcript"]),
});
const artifactOwnerShape = {
  ...ArtifactMetadataSchema.shape,
  ownerUserId: reference,
  workspaceId: reference,
  sourceIdentityId: IdentityId,
  sourceInboxId: IdentityId,
};
export const ArtifactRowSchema = z.discriminatedUnion("deleted", [
  z.object({
    ...artifactOwnerShape,
    deleted: z.literal(false),
    payloadId: z.uuid(),
    derivedText: z.nullable(ArtifactText),
    derivedKind: z.nullable(ArtifactDerivedSchema.shape.kind),
  }),
  z.object({
    ...artifactOwnerShape,
    deleted: z.literal(true),
    payloadId: z.null(),
    derivedText: z.null(),
    derivedKind: z.null(),
  }),
]);
export type ArtifactRow = z.output<typeof ArtifactRowSchema>;
export const ArtifactAccessSchema = z.object({
  identityId: IdentityId,
  artifactId: ArtifactId,
});
export const ArtifactSourceSchema = z.object({
  identityId: IdentityId,
  sourceInboxId: IdentityId,
  mediaId: reference,
});
export const ArtifactPutSchema = z.object({
  ...ArtifactSourceSchema.shape,
  bytes: ArtifactBytes,
});
export const ArtifactListSchema = z.object({
  identityId: IdentityId,
  limit: z.number().int().min(1).max(50),
});
export const ArtifactDeriveSchema = z.object({
  ...ArtifactAccessSchema.shape,
  sha256: ArtifactHash,
  ...ArtifactDerivedSchema.shape,
});
export class ArtifactError extends Error {
  readonly _tag = "ArtifactError";
  declare readonly reason:
    | "invalid_input"
    | "unavailable"
    | "not_found"
    | "source_invalid"
    | "source_conflict"
    | "deleted"
    | "corrupt";
  constructor(input: {
    readonly reason:
      | "invalid_input"
      | "unavailable"
      | "not_found"
      | "source_invalid"
      | "source_conflict"
      | "deleted"
      | "corrupt";
  }) {
    super("ArtifactError");
    this.name = "ArtifactError";
    Object.assign(this, input);
  }
}
export const decodeArtifactInput = async <S extends z.ZodRawShape>(
  schema: z.ZodObject<S>,
  input: z.output<z.ZodObject<S>>
) => {
  try {
    return await schema.strict().parseAsync(input);
  } catch {
    throw new ArtifactError({ reason: "invalid_input" });
  }
};
