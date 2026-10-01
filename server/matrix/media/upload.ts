import { z } from "zod";
import { inlineAttachmentSchema } from "@zoen/companion-ui/messages";
import { matrixConfiguration, MatrixError } from "../client";
import { operationSignal, withTimeout } from "../../operations/async";
import { readBody } from "../../http/body";

const maxUploadResponseBytes = 4 * 1024;
const uploadResponseSchema = z.object({
  content_uri: z
    .string()
    .regex(
      /^mxc:\/\/(?:[A-Za-z0-9.-]+(?::[0-9]+)?|\[[A-Fa-f0-9:.]+\](?::[0-9]+)?)\/[A-Za-z0-9_-]+$/u
    )
    .refine((value) => {
      try {
        return (
          value === value.trim() &&
          new URL(value.replace(/^mxc:/u, "https:")).hostname.length > 0
        );
      } catch {
        return false;
      }
    }),
});

export async function uploadMatrixMedia(
  file: z.infer<typeof inlineAttachmentSchema>,
  userId: string
) {
  operationSignal().throwIfAborted();
  const parsed = inlineAttachmentSchema.parse(file);
  const bytes = Buffer.from(
    parsed.url.slice(parsed.url.indexOf(",") + 1),
    "base64"
  );
  return await withTimeout(async () => {
    const signal = operationSignal();
    const config = await matrixConfiguration();
    signal.throwIfAborted();
    const url = new URL("/_matrix/media/v3/upload", config.url);
    url.searchParams.set("user_id", userId);
    url.searchParams.set("filename", parsed.filename ?? "attachment");
    try {
      const response = await fetch(url, {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          authorization: `Bearer ${config.token.reveal()}`,
          "content-type": parsed.mediaType,
        },
        body: bytes,
      });
      try {
        signal.throwIfAborted();
        if (!response.ok) throw new MatrixError({ reason: "unavailable" });
        const declared = response.headers.get("content-length");
        if (
          declared !== null &&
          (!/^[0-9]+$/u.test(declared) ||
            Number(declared) > maxUploadResponseBytes)
        ) {
          throw new MatrixError({ reason: "unavailable" });
        }
        const body = await readBody(response.body, maxUploadResponseBytes);
        const payload: unknown = JSON.parse(body.toString("utf8"));
        const result = uploadResponseSchema.parse(payload);
        signal.throwIfAborted();
        return {
          url: result.content_uri,
          info: { mimetype: parsed.mediaType, size: bytes.length },
        };
      } finally {
        await response.body?.cancel().catch(() => {
          // readBody cancels and unlocks failed reads; completed bodies need no recovery.
        });
      }
    } catch (error) {
      signal.throwIfAborted();
      throw error instanceof MatrixError
        ? error
        : new MatrixError({ reason: "unavailable" });
    }
  }, 20_000);
}
