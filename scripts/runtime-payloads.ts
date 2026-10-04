import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { z } from "zod";

/** Only the checked-in synthetic loopback installation can be prepared here. */
export async function prepareRuntimePayloads(
  journalBucket:
    | "synthetic-erasure-runtime"
    | "synthetic-erasure-cutover" = "synthetic-erasure-runtime"
) {
  const fixture = parseEnv(
    await readFile(
      new URL("../tests/runtime/.env.example", import.meta.url),
      "utf8"
    )
  );
  const endpoint = z
    .literal("http://127.0.0.1:19480")
    .parse(fixture.ZOEN_PAYLOAD_ENDPOINT);
  const bucket = z
    .literal("synthetic-storage-2a69cdcd")
    .parse(fixture.ZOEN_PAYLOAD_BUCKET);
  const credentials = {
    accessKeyId: z
      .literal("synthetic-payload-publication")
      .parse(fixture.ZOEN_PAYLOAD_ACCESS_KEY),
    secretAccessKey: z
      .literal("synthetic-payload-publication-owned-fixture")
      .parse(fixture.ZOEN_PAYLOAD_SECRET_KEY),
  };
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const response = await fetch(endpoint + "/health/ready", {
        signal: AbortSignal.timeout(2000),
      });
      if (
        response.ok &&
        z.object({ ready: z.literal(true) }).safeParse(await response.json())
          .success
      )
        break;
    } catch {
      // The owned container can be running before its HTTP listener is ready.
    }
    if (Date.now() >= deadline)
      throw new Error("Owned payload storage readiness deadline exceeded");
    await delay(250);
  }
  const client = new S3Client({
    endpoint,
    region: "auto",
    forcePathStyle: true,
    maxAttempts: 1,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials,
  });
  try {
    for (const Bucket of [bucket, journalBucket]) {
      try {
        await client.send(new HeadBucketCommand({ Bucket }), {
          abortSignal: AbortSignal.timeout(5000),
        });
      } catch (error) {
        if (
          !z
            .object({ $metadata: z.object({ httpStatusCode: z.literal(404) }) })
            .safeParse(error).success
        )
          throw error;
        await client.send(new CreateBucketCommand({ Bucket }), {
          abortSignal: AbortSignal.timeout(5000),
        });
      }
      await client.send(new HeadBucketCommand({ Bucket }), {
        abortSignal: AbortSignal.timeout(5000),
      });
    }
  } finally {
    client.destroy();
  }
}
