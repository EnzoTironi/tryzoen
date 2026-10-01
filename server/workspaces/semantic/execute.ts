import { createHash, randomUUID } from "node:crypto";
import type { z } from "zod";
import { env } from "../../../shared/environment/env";
import { operationSignal } from "../../operations/async";
import {
  SemanticSnapshotSchema,
  SemanticResultSchema,
  semanticLimits,
} from "./snapshot";

const occupied = new Set<string>();

/** Capture authorized published sources before calling; revalidate access after completion. */
export async function executeSemanticSnapshot(
  input: z.input<typeof SemanticSnapshotSchema>
) {
  const payload = JSON.stringify(SemanticSnapshotSchema.parse(input));
  if (Buffer.byteLength(payload) > semanticLimits.inputBytes)
    throw new Error("Semantic input exceeds its byte limit");
  const signal = operationSignal();
  signal.throwIfAborted();
  const endpoints = env.ZOEN_SEMANTIC_URLS;
  const token = env.ZOEN_SEMANTIC_TOKEN;
  if (!endpoints?.length || !token)
    throw new Error(
      "Semantic execution requires a configured memory-isolated executor"
    );
  const endpoint = endpoints.find((value) => !occupied.has(value));
  if (!endpoint || occupied.size >= semanticLimits.concurrent)
    throw new Error("Semantic execution is busy; retry later");
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  const deadline = AbortSignal.timeout(semanticLimits.deadlineMs);
  const combined = AbortSignal.any([signal, deadline]);
  const headers = {
    authorization: `Bearer ${token.reveal()}`,
    "x-execution-id": id,
    "content-type": "application/json",
  };
  const cancelled = new Error("Semantic execution cancelled");
  const timedOut = new Error("Semantic execution deadline reached");
  const failed = new Error("Semantic execution failed");
  const busy = new Error("Semantic execution is busy; retry later");
  const tooLarge = new Error("Semantic result exceeds its byte limit");
  occupied.add(endpoint);
  try {
    const response = await fetch(new URL("execute", endpoint), {
      method: "POST",
      headers,
      body: payload,
      signal: combined,
      redirect: "error",
    });
    if (response.status === 503) throw busy;
    if (!response.ok) throw failed;
    const body = response.body;
    if (!body) throw failed;
    const reader = body.getReader();
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > semanticLimits.resultBytes) throw tooLarge;
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    combined.throwIfAborted();
    const value = SemanticResultSchema.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf8"))
    );
    return {
      ...value,
      manifest: {
        engine: "malloy-0.0.434/pglite-snapshot",
        inputSha256: createHash("sha256").update(payload).digest("hex"),
        sqlSha256: createHash("sha256").update(value.sql).digest("hex"),
        startedAt,
        completedAt: new Date().toISOString(),
        limits: {
          rows: semanticLimits.rows,
          resultBytes: semanticLimits.resultBytes,
          deadlineMs: semanticLimits.deadlineMs,
          memoryBytes: semanticLimits.memoryBytes,
          memoryController: "cgroup-v2" as const,
        },
      },
    };
  } catch (error) {
    // Fix the execution's cause before its separately bounded cleanup. A deadline
    // reached while acknowledging cancellation must not relabel a prior failure.
    const cause = signal.aborted
      ? cancelled
      : deadline.aborted
        ? timedOut
        : error === busy
          ? busy
          : error === tooLarge
            ? tooLarge
            : failed;
    // Acknowledgement waits for the child to close before this endpoint is reusable.
    // A dead capsule remains unavailable until its supervisor restarts it.
    await fetch(new URL("cancel", endpoint), {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(2_000),
      redirect: "error",
    }).catch(() => undefined);
    // Untrusted transport/parser diagnostics may contain returned source text.
    throw cause;
  } finally {
    occupied.delete(endpoint);
  }
}
