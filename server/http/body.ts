import { operationSignal } from "../operations/async";

export class BodyTooLarge extends Error {
  constructor() {
    super("Response body exceeds the allowed size");
  }
}

/** Bound memory use while reading, and release the reader on errors and cancellation. */
export async function readBody(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number
) {
  const signal = operationSignal();
  signal.throwIfAborted();
  if (!stream) return Buffer.alloc(0);
  const reader = stream.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {
      /* Closing an already cancelled stream needs no recovery. */
    });
  };
  signal.addEventListener("abort", cancel, { once: true });
  let completed = false;
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) {
        completed = true;
        break;
      }
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new BodyTooLarge();
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!completed) cancel();
    reader.releaseLock();
  }
}
