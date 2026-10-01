import { createHash } from "node:crypto";
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
import { MatrixErasureDepartureSchema } from "../matrix/erasure";

const recordSchema = z.strictObject({
  version: z.literal(1),
  userId: z.string().regex(/^better-auth:[a-zA-Z0-9_-]{1,160}$/),
  matrixIds: z.array(MatrixErasureDepartureSchema.shape.matrixId).max(1024),
  departures: z.array(MatrixErasureDepartureSchema).max(1024),
});
const inputSchema = recordSchema.omit({ version: true });
const recordBytes = 4 * 1024 * 1024;
class ErasureJournalError extends Error {
  readonly _tag = "ErasureJournalError";
  declare readonly reason: "unconfigured" | "unavailable";
  constructor(input: { readonly reason: "unconfigured" | "unavailable" }) {
    super("ErasureJournalError");
    this.name = "ErasureJournalError";
    Object.assign(this, input);
  }
}

function openJournal() {
  const bucket = env.ZOEN_ERASURE_JOURNAL_BUCKET;
  const accessKey = env.ZOEN_ERASURE_JOURNAL_ACCESS_KEY;
  const secretKey = env.ZOEN_ERASURE_JOURNAL_SECRET_KEY;
  if (!bucket || !accessKey || !secretKey)
    throw new ErasureJournalError({ reason: "unconfigured" });
  return {
    bucket,
    s3: new S3Client({
      endpoint: env.ZOEN_ERASURE_JOURNAL_ENDPOINT,
      region: "auto",
      forcePathStyle: true,
      maxAttempts: 2,
      credentials: {
        accessKeyId: accessKey.reveal(),
        secretAccessKey: secretKey.reveal(),
      },
    }),
  };
}

function canonical(input: z.input<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  const departures = new Map<
    string,
    z.output<typeof MatrixErasureDepartureSchema>
  >();
  for (const reference of parsed.departures) {
    const key = JSON.stringify([reference.bindingId, reference.matrixId]);
    const prior = departures.get(key);
    if (prior && JSON.stringify(prior) !== JSON.stringify(reference))
      throw new ErasureJournalError({ reason: "unavailable" });
    departures.set(key, reference);
  }
  return recordSchema.parse({
    version: 1,
    userId: parsed.userId,
    matrixIds: [
      ...new Set([
        ...parsed.matrixIds,
        ...parsed.departures.map((reference) => reference.matrixId),
      ]),
    ].toSorted(),
    departures: [...departures.entries()]
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, reference]) => reference),
  });
}
function objectKey(record: z.output<typeof recordSchema>) {
  return `erasures/${Buffer.from(record.userId).toString("base64url")}/${createHash("sha256").update(JSON.stringify(record)).digest("hex")}.json`;
}

/** Immutable exact handles live outside application database restoration.
 * New captures append distinct records; retries never overwrite an older intent.
 * Old incomplete/malformed records fail closed rather than guessing native IDs.
 */
export const ErasureJournal = {
  async append(input: z.input<typeof inputSchema>) {
    const { s3, bucket } = openJournal();
    try {
      const record = canonical(input);
      const body = JSON.stringify(record);
      if (Buffer.byteLength(body) > recordBytes)
        throw new Error("Erasure record exceeds byte limit");
      await withTimeout(async () => {
        try {
          await s3.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: objectKey(record),
              Body: body,
              ContentType: "application/json",
              IfNoneMatch: "*",
            }),
            { abortSignal: operationSignal() }
          );
        } catch (error) {
          if (
            !z
              .object({
                $metadata: z.object({ httpStatusCode: z.literal(412) }),
              })
              .safeParse(error).success
          )
            throw error;
        }
      }, 15_000);
    } catch {
      throw new ErasureJournalError({ reason: "unavailable" });
    } finally {
      s3.destroy();
    }
  },
  async *read(userId?: string) {
    const prefix =
      userId === undefined
        ? "erasures/"
        : `erasures/${Buffer.from(recordSchema.shape.userId.parse(userId)).toString("base64url")}/`;
    const { s3, bucket } = openJournal();
    try {
      let token: string | undefined;
      // Brent's cycle guard retains one opaque cursor, not the whole history.
      let cycleAnchor: string | undefined;
      let cycleSpan = 1;
      let cycleDistance = 0;
      do {
        operationSignal().throwIfAborted();
        const page = await withTimeout(
          () =>
            s3.send(
              new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: prefix,
                ContinuationToken: token,
                MaxKeys: 100,
              }),
              { abortSignal: operationSignal() }
            ),
          15_000
        );
        if ((page.Contents?.length ?? 0) > 100)
          throw new Error("Erasure listing exceeds page limit");
        for (const object of page.Contents ?? []) {
          const key = object.Key;
          if (!key || !key.startsWith(prefix))
            throw new Error("Invalid erasure object locator");
          const record = await withTimeout(async () => {
            const response = await s3.send(
              new GetObjectCommand({ Bucket: bucket, Key: key }),
              { abortSignal: operationSignal() }
            );
            if (!response.Body || (response.ContentLength ?? 0) > recordBytes)
              throw new Error("Erasure record exceeds byte limit");
            const bytes = await readBody(
              response.Body.transformToWebStream(),
              recordBytes
            );
            const parsed = jsonString(recordSchema).parse(
              bytes.toString("utf8")
            );
            const normalized = canonical(
              inputSchema.parse({
                userId: parsed.userId,
                matrixIds: parsed.matrixIds,
                departures: parsed.departures,
              })
            );
            if (key !== objectKey(normalized))
              throw new Error("Erasure record digest mismatch");
            return normalized;
          }, 15_000);
          // The generator retains the client while the caller awaits each SQL replay.
          // History is streamed; content-addressed key order is not chronology.
          yield record;
        }
        const next = page.NextContinuationToken;
        if (page.IsTruncated) {
          if (!next || next === token || next === cycleAnchor)
            throw new Error("Invalid erasure continuation");
          cycleDistance += 1;
          if (cycleDistance === cycleSpan) {
            cycleAnchor = next;
            cycleDistance = 0;
            cycleSpan *= 2;
          }
        }
        token = page.IsTruncated ? next : undefined;
      } while (token);
    } catch {
      throw new ErasureJournalError({ reason: "unavailable" });
    } finally {
      s3.destroy();
    }
  },
};
