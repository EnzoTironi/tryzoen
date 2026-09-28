import type { z } from "zod";
import { inlineAttachmentSchema } from "@zoen/companion-ui/messages";
import { matrixConfiguration, MatrixError } from "../client";
import { operationSignal, withTimeout } from "../../operations/async";

export async function uploadMatrixMedia(
  file: z.infer<typeof inlineAttachmentSchema>,
  userId: string
) {
  const parsed = inlineAttachmentSchema.parse(file);
  const bytes = Buffer.from(
    parsed.url.slice(parsed.url.indexOf(",") + 1),
    "base64"
  );
  const config = await matrixConfiguration();
  const url = new URL("/_matrix/media/v3/upload", config.url);
  url.searchParams.set("user_id", userId);
  url.searchParams.set("filename", parsed.filename ?? "attachment");
  return await withTimeout(async () => {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: operationSignal(),
      headers: {
        authorization: `Bearer ${config.token.reveal()}`,
        "content-type": parsed.mediaType,
      },
      body: bytes,
    });
    if (!response.ok) throw new MatrixError({ reason: "unavailable" });
    const result: unknown = await response.json();
    if (
      !result ||
      typeof result !== "object" ||
      !("content_uri" in result) ||
      typeof result.content_uri !== "string" ||
      !result.content_uri.startsWith("mxc://")
    )
      throw new MatrixError({ reason: "unavailable" });
    return {
      url: result.content_uri,
      info: { mimetype: parsed.mediaType, size: bytes.length },
    };
  }, 20_000);
}
