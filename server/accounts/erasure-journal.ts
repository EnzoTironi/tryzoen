import { readBody } from "../http/body";
import { operationSignal, withTimeout } from "../operations/async";
import { jsonString } from "@shared/validation";
import { z } from "zod";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "@shared/environment/env";
const recordSchema = z.object({
  userId: z.string().regex(/^better-auth:[a-zA-Z0-9_-]{1,160}$/),
});
class ErasureJournalError extends Error {
  readonly _tag = "ErasureJournalError";
  declare readonly reason: "unconfigured" | "unavailable";
  constructor(input: { readonly reason: "unconfigured" | "unavailable" }) {
    super("ErasureJournalError");
    this.name = "ErasureJournalError";
    Object.assign(this, input);
  }
}
async function withJournal<T>(
  run: (s3: S3Client, bucket: string) => Promise<T>,
  timeout: number
) {
  const bucket = env.ZOEN_ERASURE_JOURNAL_BUCKET;
  const accessKey = env.ZOEN_ERASURE_JOURNAL_ACCESS_KEY;
  const secretKey = env.ZOEN_ERASURE_JOURNAL_SECRET_KEY;
  if (!bucket || !accessKey || !secretKey)
    throw new ErasureJournalError({
      reason: "unconfigured",
    });
  const s3 = new S3Client({
    endpoint: env.ZOEN_ERASURE_JOURNAL_ENDPOINT,
    region: "auto",
    forcePathStyle: true,
    maxAttempts: 2,
    credentials: {
      accessKeyId: accessKey.reveal(),
      secretAccessKey: secretKey.reveal(),
    },
  });
  try {
    return await withTimeout(() => run(s3, bucket), timeout);
  } catch {
    throw new ErasureJournalError({
      reason: "unavailable",
    });
  } finally {
    s3.destroy();
  }
}

/** Append-only deletion intent; its bucket is never restored with the application database. */

export const ErasureJournal = {
  append(userId: string) {
    return withJournal(async (s3, bucket) => {
      const record = recordSchema.parse({
        userId,
      });
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: `erasures/${Buffer.from(record.userId).toString("base64url")}.json`,
            Body: JSON.stringify(record),
            ContentType: "application/json",
            IfNoneMatch: "*",
          }),
          {
            abortSignal: operationSignal(),
          }
        );
      } catch (error) {
        if (
          !z
            .object({
              $metadata: z.object({
                httpStatusCode: z.literal(412),
              }),
            })
            .safeParse(error).success
        )
          throw error;
      }
    }, 15_000);
  },
  read() {
    return withJournal(async (s3, bucket) => {
      const records: z.output<typeof recordSchema>[] = [];
      let token: string | undefined;
      do {
        const page = await s3.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: "erasures/",
            ContinuationToken: token,
          }),
          {
            abortSignal: operationSignal(),
          }
        );
        for (const object of page.Contents ?? []) {
          const response = await s3.send(
            new GetObjectCommand({
              Bucket: bucket,
              Key: object.Key,
            }),
            {
              abortSignal: operationSignal(),
            }
          );
          if (!response.Body || (response.ContentLength ?? 0) > 1024)
            throw new ErasureJournalError({
              reason: "unavailable",
            });
          const bytes = await readBody(
            response.Body.transformToWebStream(),
            1024
          );
          records.push(jsonString(recordSchema).parse(bytes.toString("utf8")));
        }
        token = page.NextContinuationToken;
        if (page.IsTruncated && !token)
          throw new ErasureJournalError({
            reason: "unavailable",
          });
      } while (token);
      return records;
    }, 300_000);
  },
};
