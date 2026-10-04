import { z } from "zod";
import { SqlError } from "@db/queries";
import { AuthUnavailable } from "@db/services/auth/index";
import {
  privateMemoryArchiveDownloads,
  privateMemoryArchiveLimits,
} from "../../packages/companion-ui/src/learned/archive";
import { encodePrivateMemoryArchive } from "./archive-codec";
import {
  PrivateMemoryArchiveError,
  type PrivateMemoryArchiveSchema,
} from "./archive";
import { PrivateMemoryError } from "./errors";
import { WorkspaceAccessDenied } from "../workspaces/access";
import { MemoryNamespaceError } from "./namespace";
import { SessionArchiveUnavailable } from "./session-export";
import { operationSignal, TimeoutError } from "../operations/async";

class MemoryArchiveUploadTooLarge extends Error {
  constructor() {
    super("Memory archive exceeds its transfer limit");
    this.name = "MemoryArchiveUploadTooLarge";
  }
}

export function privateMemoryArchiveResponse(
  archive: z.infer<typeof PrivateMemoryArchiveSchema>
) {
  const metadata =
    privateMemoryArchiveDownloads[
      archive.version === 2 ? "claims" : "complete-journal"
    ];
  return new Response(encodePrivateMemoryArchive(archive), {
    headers: {
      "content-type": metadata.contentType,
      "content-disposition": `attachment; filename="${metadata.filename}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/** Bound actual streamed bytes and the chunk inventory before the final copy. */
export async function readPrivateMemoryArchiveRequest(request: Request) {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== privateMemoryArchiveDownloads.claims.contentType)
    throw new PrivateMemoryArchiveError("invalid_input");
  const lengthHeader = request.headers.get("content-length");
  let declared: number | undefined;
  if (lengthHeader !== null) {
    if (!/^[0-9]+$/u.test(lengthHeader))
      throw new PrivateMemoryArchiveError("invalid_input");
    declared = Number(lengthHeader);
    if (
      !Number.isSafeInteger(declared) ||
      declared > privateMemoryArchiveLimits.wireBytes
    )
      throw new MemoryArchiveUploadTooLarge();
  }
  if (!request.body) throw new PrivateMemoryArchiveError("invalid_input");
  const reader = request.body.getReader();
  const signal = operationSignal();
  let cancellation: Promise<void> | undefined;
  const abort = () => {
    cancellation = reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Buffer[] = [];
  let length = 0;
  let current: Buffer | undefined;
  let filled = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      if (length + next.value.byteLength > privateMemoryArchiveLimits.wireBytes)
        throw new MemoryArchiveUploadTooLarge();
      length += next.value.byteLength;
      let offset = 0;
      while (offset < next.value.byteLength) {
        if (!current) {
          current = Buffer.allocUnsafe(65_536);
          chunks.push(current);
          filled = 0;
        }
        const count = Math.min(
          current.byteLength - filled,
          next.value.byteLength - offset
        );
        current.set(next.value.subarray(offset, offset + count), filled);
        filled += count;
        offset += count;
        if (filled === current.byteLength) current = undefined;
      }
    }
    if (declared !== undefined && length !== declared)
      throw new PrivateMemoryArchiveError("invalid_input");
    if (current) chunks[chunks.length - 1] = current.subarray(0, filled);
    return Buffer.concat(chunks, length);
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    if (cancellation) await cancellation;
    reader.releaseLock();
  }
}

export function memoryArchiveFailureResponse(error: unknown): Response {
  let status: number;
  if (error instanceof WorkspaceAccessDenied) status = 403;
  else if (error instanceof MemoryArchiveUploadTooLarge) status = 413;
  else if (error instanceof z.ZodError) status = 400;
  else if (error instanceof PrivateMemoryArchiveError)
    status = error.reason === "invalid_input" ? 400 : 503;
  else if (error instanceof MemoryNamespaceError)
    status = error.reason === "erased" ? 409 : 400;
  else if (error instanceof PrivateMemoryError)
    status =
      error.reason === "invalid_input"
        ? 400
        : error.reason === "unavailable"
          ? 503
          : 409;
  else if (
    error instanceof SessionArchiveUnavailable ||
    error instanceof AuthUnavailable ||
    error instanceof SqlError
  )
    status = 503;
  else if (error instanceof TimeoutError) status = 504;
  else throw error;
  return new Response(null, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}
