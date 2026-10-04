import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3ServiceException,
  type S3Client,
} from "@aws-sdk/client-s3";
import { z } from "zod";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { BodyTooLarge, readBody } from "../http/body";
import { operationSignal, withDeadline, withSignal } from "../operations/async";
import {
  PayloadError,
  PayloadInventoryScopeSchema,
  PayloadReferenceSchema,
  type PayloadReference,
} from "./contract";

const locationSchema = z.strictObject({
  bucket: z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/u),
  prefix: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/u),
});

export const payloadDigest = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

export function payloadObjectKey(prefix: string, raw: PayloadReference) {
  const reference = PayloadReferenceSchema.parse(raw);
  const domain =
    reference.ownerUserId === null
      ? `workspace/${payloadDigest(reference.workspaceId)}`
      : `private/${payloadDigest(reference.ownerUserId)}/${payloadDigest(reference.workspaceId)}`;
  return `${locationSchema.shape.prefix.parse(prefix)}/${domain}/${reference.ownerGeneration}/${reference.kind}/${reference.candidateId}`;
}

function payloadLocator(prefix: string, key: string) {
  const base = locationSchema.shape.prefix.parse(prefix) + "/";
  if (!key.startsWith(base)) throw new PayloadError("invalid");
  const parts = key.slice(base.length).split("/");
  const shape = PayloadReferenceSchema.options[0].shape;
  if (parts[0] === "workspace") {
    const parsed = z
      .tuple([
        z.literal("workspace"),
        shape.sha256,
        shape.ownerGeneration,
        z.union([
          PayloadReferenceSchema.options[0].shape.kind,
          PayloadReferenceSchema.options[1].shape.kind,
        ]),
        shape.candidateId,
      ])
      .parse(parts);
    if (parsed.join("/") !== parts.join("/")) throw new PayloadError("invalid");
    return {
      key,
      workspaceDigest: parsed[1],
      ownerUserDigest: null,
      ownerGeneration: parsed[2],
      kind: parsed[3],
      candidateId: parsed[4],
    };
  }
  const parsed = z
    .tuple([
      z.literal("private"),
      shape.sha256,
      shape.sha256,
      shape.ownerGeneration,
      z.union([
        PayloadReferenceSchema.options[2].shape.kind,
        PayloadReferenceSchema.options[3].shape.kind,
      ]),
      shape.candidateId,
    ])
    .parse(parts);
  if (parsed.join("/") !== parts.join("/")) throw new PayloadError("invalid");
  return {
    key,
    ownerUserDigest: parsed[1],
    workspaceDigest: parsed[2],
    ownerGeneration: parsed[3],
    kind: parsed[4],
    candidateId: parsed[5],
  };
}

/** The domain owner registers intent before I/O and publishes references only
 * after verification. This transport owns neither authority nor SQL state. */
export class S3PrivatePayloads {
  private readonly location: z.infer<typeof locationSchema>;

  constructor(
    private readonly client: S3Client,
    location: z.input<typeof locationSchema>
  ) {
    this.location = locationSchema.parse(location);
  }

  private key(reference: PayloadReference) {
    return payloadObjectKey(this.location.prefix, reference);
  }

  async inventoryPage(input: {
    continuationToken: string | null;
    signal: AbortSignal;
    deadlineMs: number;
    scope?: z.input<typeof PayloadInventoryScopeSchema>;
    limit?: 25 | 100;
  }) {
    const scope = PayloadInventoryScopeSchema.parse(
      input.scope ?? { kind: "all" }
    );
    const prefix =
      this.location.prefix +
      "/" +
      (scope.kind === "all"
        ? ""
        : scope.kind === "private-owner"
          ? `private/${payloadDigest(scope.ownerUserId)}/`
          : `workspace/${payloadDigest(accessScopeForUser(scope.ownerUserId).workspaceId)}/`);
    const limit = z
      .union([z.literal(25), z.literal(100)])
      .parse(input.limit ?? 100);
    const token = z
      .string()
      .min(1)
      .max(8192)
      .nullable()
      .parse(input.continuationToken);
    return withDeadline(
      () =>
        withSignal(input.signal, async () => {
          const response = await this.client.send(
            new ListObjectsV2Command({
              Bucket: this.location.bucket,
              Prefix: prefix,
              MaxKeys: limit,
              ContinuationToken: token ?? undefined,
            }),
            { abortSignal: operationSignal() }
          );
          const truncated = z.boolean().parse(response.IsTruncated);
          const next = truncated
            ? z.string().min(1).max(8192).parse(response.NextContinuationToken)
            : null;
          if (truncated && next === token)
            throw new PayloadError("unavailable");
          const objects = z
            .array(
              z.object({
                Key: z.string().min(1).max(512),
                LastModified: z.date(),
                Size: z
                  .number()
                  .int()
                  .nonnegative()
                  .max(Number.MAX_SAFE_INTEGER),
              })
            )
            .max(limit)
            .parse(response.Contents ?? [])
            .map((object) =>
              Object.assign(payloadLocator(this.location.prefix, object.Key), {
                lastModified: object.LastModified,
                byteLength: object.Size,
              })
            );
          if (objects.some((object) => !object.key.startsWith(prefix)))
            throw new PayloadError("invalid");
          return { objects, continuationToken: next };
        }),
      input.deadlineMs
    );
  }

  async removeLocator(input: {
    key: string;
    signal: AbortSignal;
    deadlineMs: number;
  }) {
    const locator = payloadLocator(this.location.prefix, input.key);
    await this.removeKey({ ...input, key: locator.key });
  }

  async putVerified(input: {
    candidate: PayloadReference;
    bytes: Uint8Array;
    signal: AbortSignal;
    deadlineMs: number;
  }): Promise<PayloadReference> {
    const reference = PayloadReferenceSchema.parse(input.candidate);
    if (input.bytes.byteLength !== reference.byteLength)
      throw new PayloadError("invalid");
    const bytes = Buffer.from(input.bytes);
    if (payloadDigest(bytes) !== reference.sha256)
      throw new PayloadError("invalid");
    return withDeadline(
      () =>
        withSignal(input.signal, async () => {
          const signal = operationSignal();
          signal.throwIfAborted();
          try {
            await this.client.send(
              new PutObjectCommand({
                Bucket: this.location.bucket,
                Key: this.key(reference),
                Body: bytes,
                ContentLength: bytes.byteLength,
                IfNoneMatch: "*",
                Metadata: {
                  "payload-id": reference.candidateId,
                  sha256: reference.sha256,
                },
              }),
              { abortSignal: signal }
            );
          } catch (error) {
            if (
              !(error instanceof S3ServiceException) ||
              error.$metadata.httpStatusCode !== 412
            )
              throw error;
          }
          await this.readVerified({
            reference,
            signal,
            deadlineMs: input.deadlineMs,
          });
          return reference;
        }),
      input.deadlineMs
    );
  }

  async readVerified(input: {
    reference: PayloadReference;
    signal: AbortSignal;
    deadlineMs: number;
  }): Promise<Uint8Array> {
    const reference = PayloadReferenceSchema.parse(input.reference);
    return withDeadline(
      () =>
        withSignal(input.signal, async () => {
          const signal = operationSignal();
          signal.throwIfAborted();
          const response = await this.client
            .send(
              new GetObjectCommand({
                Bucket: this.location.bucket,
                Key: this.key(reference),
              }),
              { abortSignal: signal }
            )
            .catch((error: unknown) => {
              if (
                error instanceof S3ServiceException &&
                error.$metadata.httpStatusCode === 404
              )
                throw new PayloadError("missing");
              throw error;
            });
          const body = response.Body;
          if (!(body instanceof Readable)) throw new PayloadError("corrupt");
          try {
            if (
              (response.ContentLength !== undefined &&
                response.ContentLength !== reference.byteLength) ||
              response.Metadata?.["payload-id"] !== reference.candidateId ||
              response.Metadata.sha256 !== reference.sha256
            )
              throw new PayloadError("corrupt");
            const bytes = await readBody(
              body.transformToWebStream(),
              reference.byteLength
            ).catch((error: unknown) => {
              if (error instanceof BodyTooLarge)
                throw new PayloadError("corrupt");
              throw error;
            });
            if (
              bytes.byteLength !== reference.byteLength ||
              payloadDigest(bytes) !== reference.sha256
            )
              throw new PayloadError("corrupt");
            return bytes;
          } finally {
            body.destroy();
          }
        }),
      input.deadlineMs
    );
  }

  async removeExact(input: {
    reference: PayloadReference;
    signal: AbortSignal;
    deadlineMs: number;
  }): Promise<void> {
    const reference = PayloadReferenceSchema.parse(input.reference);
    await this.removeKey({ ...input, key: this.key(reference) });
  }

  private async removeKey(input: {
    key: string;
    signal: AbortSignal;
    deadlineMs: number;
  }) {
    await withDeadline(
      () =>
        withSignal(input.signal, async () => {
          const signal = operationSignal();
          signal.throwIfAborted();
          await this.client.send(
            new DeleteObjectCommand({
              Bucket: this.location.bucket,
              Key: input.key,
            }),
            { abortSignal: signal }
          );
          try {
            const observed = await this.client.send(
              new GetObjectCommand({
                Bucket: this.location.bucket,
                Key: input.key,
              }),
              { abortSignal: signal }
            );
            if (observed.Body instanceof Readable) observed.Body.destroy();
          } catch (error) {
            if (
              error instanceof S3ServiceException &&
              error.$metadata.httpStatusCode === 404
            )
              return;
            throw error;
          }
          throw new PayloadError("unavailable");
        }),
      input.deadlineMs
    );
  }
}
