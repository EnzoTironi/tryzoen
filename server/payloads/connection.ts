import { S3Client } from "@aws-sdk/client-s3";
import { privatePayloadEnvironment } from "@shared/environment/env/private-payloads";
import { PayloadError } from "./contract";
import { S3PrivatePayloads } from "./s3";

export function openPayloads() {
  const env = privatePayloadEnvironment();
  const endpoint = env.ZOEN_PAYLOAD_ENDPOINT;
  const bucket = env.ZOEN_PAYLOAD_BUCKET;
  const accessKey = env.ZOEN_PAYLOAD_ACCESS_KEY;
  const secretKey = env.ZOEN_PAYLOAD_SECRET_KEY;
  if (!endpoint || !bucket || !accessKey || !secretKey)
    throw new PayloadError("unavailable");
  if (endpoint.startsWith("http:")) {
    const databaseUrl = env.DATABASE_URL ?? env.DATABASE_URL_UNPOOLED;
    const database = databaseUrl ? new URL(databaseUrl) : null;
    if (
      !bucket.startsWith("synthetic-") ||
      !accessKey.reveal().startsWith("synthetic-") ||
      database?.hostname !== "127.0.0.1" ||
      database.pathname !== "/companion_runtime_test" ||
      !["zoen_app", "zoen_migrator"].includes(database.username)
    )
      throw new PayloadError("invalid");
  }
  const client = new S3Client({
    endpoint,
    region: "auto",
    forcePathStyle: true,
    maxAttempts: 1,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: accessKey.reveal(),
      secretAccessKey: secretKey.reveal(),
    },
  });
  try {
    const payloads = new S3PrivatePayloads(client, {
      bucket,
      prefix: env.ZOEN_PAYLOAD_PREFIX,
    });
    return {
      payloads,
      close: () => {
        client.destroy();
      },
    };
  } catch (error) {
    client.destroy();
    throw error;
  }
}
