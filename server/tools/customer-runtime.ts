import { ZodError as SchemaError } from "zod";
import { jsonString } from "@shared/validation";
import { z } from "zod";
import type { SandboxToolInvoker } from "../../vendor/executor/core";
import { runCustomerCode } from "./runtime";
import {
  CustomerToolError,
  type CustomerToolSchema,
  decodeCustomerValue,
} from "../workspaces/tool-document";

export const executeCustomerCode = async function (
  tool: z.output<typeof CustomerToolSchema>,
  input: Parameters<typeof decodeCustomerValue>[1],
  invoker: SandboxToolInvoker
) {
  try {
    const implementation = tool.implementation;
    if (implementation.kind !== "code")
      throw new CustomerToolError({ reason: "invalid_definition" });
    const decoded = await decodeCustomerValue(tool.inputSchema, input);
    const result = await runCustomerCode(
      `const input = ${JSON.stringify(decoded)};\nreturn await (async () => {\n${implementation.code}\n})();`,
      {
        invoke: (call) =>
          implementation.requires.includes(call.path)
            ? invoker.invoke(call)
            : Promise.reject(
                new CustomerToolError({ reason: "dependency_unavailable" })
              ),
      }
    );
    if (!result.ok) throw new CustomerToolError({ reason: "execution_failed" });
    const envelope = await jsonString(
      z.object({ result: z.record(z.string(), z.unknown()) })
    ).parseAsync(result.text);
    return await decodeCustomerValue(tool.outputSchema, envelope.result, true);
  } catch (error) {
    if (error instanceof SchemaError) {
      throw new CustomerToolError({ reason: "invalid_output" });
    }
    throw error;
  }
};
