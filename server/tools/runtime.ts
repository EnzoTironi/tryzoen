import { withTimeout, withSignal, operationSignal } from "../operations/async";
import { TimeoutError } from "../operations/async";
import { ZodError as SchemaError } from "zod";
import { z } from "zod";

import { createRequire } from "node:module";
import { resolve } from "node:path";
import type * as QuickJSPackage from "quickjs-emscripten";
import {
  makeQuickJsExecutor,
  setQuickJSModule,
} from "../../vendor/executor/sandbox";
import type { SandboxToolInvoker } from "../../vendor/executor/core";

const kernel = makeQuickJsExecutor({
  timeoutMs: 250,
  maxWallTimeMs: 25_000,
  memoryLimitBytes: 16 * 1024 * 1024,
  maxStackSizeBytes: 512 * 1024,
});
const active = new Set<Promise<void>>();
const ExecutorCodeSchema = z.string().min(1).max(20_000);
class ExecutorError extends Error {
  readonly _tag = "ExecutorError";
  declare readonly reason:
    | "invalid_code"
    | "limit_exceeded"
    | "execution_failed";
  constructor(input: {
    readonly reason: "invalid_code" | "limit_exceeded" | "execution_failed";
  }) {
    super("ExecutorError");
    this.name = "ExecutorError";
    Object.assign(this, input);
  }
}

/** No process, network, filesystem or credentials enter the JS isolate. */
const executeSandbox = async function (
  code: string,
  invoker: SandboxToolInvoker
) {
  try {
    try {
      return await withTimeout(async () => {
        const input = await ExecutorCodeSchema.parseAsync(code);
        // Keep Emscripten beside its WASM asset even when Eve bundles the host.
        const quickJs = await Promise.try(async () => {
          // Node's require is untyped; this literal resolves the pinned package and its declared exports.
          // oxlint-disable-next-line typescript/no-unsafe-assignment
          const nativeQuickJS: typeof QuickJSPackage = createRequire(
            resolve(process.cwd(), "package.json")
          )("quickjs-emscripten");
          return nativeQuickJS.getQuickJS();
        }).catch(() => {
          throw new ExecutorError({ reason: "execution_failed" });
        });
        setQuickJSModule(quickJs);
        let calls = 0;
        const bounded: SandboxToolInvoker = {
          invoke: async function (call, signal) {
            if (
              ++calls > 12 ||
              Buffer.byteLength(JSON.stringify({ args: call.args })) > 16_384
            )
              throw new ExecutorError({ reason: "limit_exceeded" });
            return withSignal(signal, () => invoker.invoke(call, signal));
          },
        };
        const result = await kernel.execute(input, bounded, operationSignal());
        if (result.error)
          return {
            ok: false,
            text:
              result.error.split("\n\n")[0]?.slice(0, 2000) ??
              "Code execution failed.",
            logs: result.logs ?? [],
          };
        if (result.result === undefined && !result.output?.length)
          return {
            ok: false,
            text: "No result was returned. Use an explicit return, for example: return await tools.workspace_files_list({}); A missing return does not mean the workspace is empty.",
            logs: result.logs ?? [],
          };
        const text = JSON.stringify({
          result: result.result ?? null,
          output: result.output ?? [],
        });
        if (Buffer.byteLength(text) > 131_072)
          throw new ExecutorError({ reason: "limit_exceeded" });
        return { ok: true, text, logs: result.logs ?? [] };
      }, 30000);
    } catch (error) {
      if (error instanceof SchemaError) {
        throw new ExecutorError({ reason: "invalid_code" });
      }
      throw error;
    }
  } catch (error) {
    if (
      error instanceof TimeoutError ||
      (error instanceof Error && error.name === "QuickJsExecutionError")
    ) {
      throw new ExecutorError({ reason: "execution_failed" });
    }
    throw error;
  }
};

export async function runCustomerCode(
  ...args: Parameters<typeof executeSandbox>
) {
  while (active.size >= 4) await Promise.race(active);
  const slot = Promise.withResolvers<void>();
  active.add(slot.promise);
  try {
    return await executeSandbox(...args);
  } finally {
    active.delete(slot.promise);
    slot.resolve();
  }
}
