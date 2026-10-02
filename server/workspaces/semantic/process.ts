import { spawn } from "node:child_process";
import { SemanticResultSchema, semanticLimits } from "./snapshot";

/** Called only by the dedicated, memory-qualified execution service. */
export async function executeSemanticProcess(
  payload: string,
  signal: AbortSignal,
  workerFile: string
) {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--max-old-space-size=256", workerFile],
      { env: { NODE_ENV: "production" }, stdio: "pipe" }
    );
    let failure: Error | undefined;
    let bytes = 0;
    const chunks: Buffer[] = [];
    const stop = (error: Error) => {
      failure ??= error;
      child.kill("SIGKILL");
    };
    const abort = () => {
      stop(new Error("Semantic execution cancelled"));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const deadline = setTimeout(() => {
      stop(new Error("Semantic execution deadline reached"));
    }, semanticLimits.deadlineMs);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > semanticLimits.resultBytes)
        stop(new Error("Semantic result exceeds its byte limit"));
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.on("error", () => {
      failure ??= new Error("Semantic execution failed");
    });
    child.stdin.on("error", () => {
      // Premature process exit is reported by close, with no source diagnostics.
    });
    child.on("close", (code) => {
      clearTimeout(deadline);
      signal.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error("Semantic execution failed"));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.end(payload);
  });
  return SemanticResultSchema.parse(JSON.parse(output));
}
