import { operationSignal, withTimeout } from "../../operations/async";
import { BodyTooLarge, readBody } from "../../http/body";
import { ChannelMediaError } from "./policy";

export async function downloadMediaBytes(
  url: string,
  maxBytes: number,
  init: RequestInit = {}
) {
  try {
    return await withTimeout(async () => {
      const response = await fetch(url, {
        ...init,
        redirect: "error",
        signal: operationSignal(),
      });
      try {
        if (response.status !== 200)
          throw new ChannelMediaError({ reason: "download_failed" });
        const declared = response.headers.get("content-length");
        if (declared !== null) {
          if (!/^[0-9]+$/u.test(declared))
            throw new ChannelMediaError({ reason: "download_failed" });
          if (Number(declared) > maxBytes) throw new BodyTooLarge();
        }
        return await readBody(response.body, maxBytes);
      } finally {
        void response.body?.cancel().catch(() => {
          /* Closing an already cancelled stream needs no recovery. */
        });
      }
    }, 15_000);
  } catch (error) {
    operationSignal().throwIfAborted();
    if (error instanceof ChannelMediaError) throw error;
    throw new ChannelMediaError({
      reason: error instanceof BodyTooLarge ? "too_large" : "download_failed",
    });
  }
}
