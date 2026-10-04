import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { query } from "@db/queries";
import { env } from "@shared/environment/env";
import { PayloadReferenceSchema } from "../../server/payloads/contract";
import { payloadObjectKey } from "../../server/payloads/s3";
import { requireRuntimeDatabase } from "./database";

/** Mutate only an exact synthetic object, retaining its original integrity
 * metadata. Native readers must detect the changed bytes before returning any. */
export async function corruptPayload(id: string, bytes: Uint8Array) {
  await requireRuntimeDatabase();
  if (
    env.ZOEN_PAYLOAD_ENDPOINT !== "http://127.0.0.1:19480" ||
    !env.ZOEN_PAYLOAD_BUCKET?.startsWith("synthetic-") ||
    !env.ZOEN_PAYLOAD_ACCESS_KEY ||
    !env.ZOEN_PAYLOAD_SECRET_KEY
  )
    throw new Error(
      "Payload faults require the owned loopback storage fixture"
    );
  const [row] =
    await query(sql`SELECT id AS "candidateId",workspace_id AS "workspaceId",
    owner_generation AS "ownerGeneration",owner_user_id AS "ownerUserId",kind,sha256,byte_length AS "byteLength"
    FROM payload_object WHERE id=${z.uuid().parse(id)} AND state='adopted'`);
  const reference = PayloadReferenceSchema.parse(row);
  const client = new S3Client({
    endpoint: env.ZOEN_PAYLOAD_ENDPOINT,
    region: "auto",
    forcePathStyle: true,
    maxAttempts: 1,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: env.ZOEN_PAYLOAD_ACCESS_KEY.reveal(),
      secretAccessKey: env.ZOEN_PAYLOAD_SECRET_KEY.reveal(),
    },
  });
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: env.ZOEN_PAYLOAD_BUCKET,
        Key: payloadObjectKey(env.ZOEN_PAYLOAD_PREFIX, reference),
        Body: bytes,
        ContentLength: bytes.byteLength,
        Metadata: {
          "payload-id": reference.candidateId,
          sha256: reference.sha256,
        },
      }),
      { abortSignal: AbortSignal.timeout(5_000) }
    );
  } finally {
    client.destroy();
  }
}
