import type { Instrumentation } from "next";

export async function onRequestError(
  failure: Parameters<Instrumentation.onRequestError>[0],
  _request: Parameters<Instrumentation.onRequestError>[1],
  context: Parameters<Instrumentation.onRequestError>[2]
) {
  // Next statically removes Node-only imports from its separate Edge instrumentation bundle.
  // eslint-disable-next-line no-restricted-properties, turbo/no-undeclared-env-vars
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ withTimeout }, { recordTelemetry }] = await Promise.all([
    import("./server/operations/async"),
    import("./server/observability/events"),
  ]);
  const digest =
    failure !== null &&
    typeof failure === "object" &&
    "digest" in failure &&
    typeof failure.digest === "string"
      ? failure.digest
      : null;
  try {
    await withTimeout(
      () =>
        recordTelemetry({
          id: crypto.randomUUID(),
          sessionId: `server:${crypto.randomUUID()}`,
          kind: "server.error",
          status: "failed",
          name: context.routePath,
          metadata: {
            digest,
            errorType: failure instanceof Error ? failure.name : "Error",
            routeType: context.routeType,
            routerKind: context.routerKind,
          },
          payload: {
            message:
              failure instanceof Error ? failure.message : "Server error",
            stack: failure instanceof Error ? (failure.stack ?? null) : null,
          },
        }),
      2_000
    );
  } catch {
    console.error("telemetry.server_error_write_failed");
  }
}
