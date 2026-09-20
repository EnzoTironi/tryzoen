import type { ExecuteErrorKind } from "./error-kind";

/** Invoke a tool by path from inside a sandbox */
export interface SandboxToolInvoker {
  invoke(
    input: {
      path: string;
      args: unknown;
    },
    signal?: AbortSignal
  ): Promise<unknown>;
}

/** User-visible output accumulated by sandbox helpers. */
export type ExecuteOutputItem =
  | {
      readonly type: "file";
      readonly file: unknown;
    }
  | {
      readonly type: "content";
      readonly content: unknown;
    };

/** Result of executing code in a sandbox */
export type ExecuteResult = {
  result: unknown;
  output?: ExecuteOutputItem[];
  error?: string;
  /** Enumerable failure class for telemetry; never carries message content. */
  errorKind?: ExecuteErrorKind;
  logs?: string[];
};

/** Executes an isolated, bounded customer computation. */
export interface CodeExecutor {
  execute(
    code: string,
    toolInvoker: SandboxToolInvoker,
    signal?: AbortSignal
  ): Promise<ExecuteResult>;
  /**
   * The effective in-sandbox execution timeout, in milliseconds, that this
   * runtime enforces on the code it runs. Exposed so a host can derive its own
   * outer backstop (e.g. this bound plus a grace margin) for the case where the
   * in-sandbox timer itself is defeated by a wedged isolate. Optional: runtimes
   * that do not bound execution leave it undefined and hosts skip the backstop.
   */
  readonly timeoutMs?: number;
}
