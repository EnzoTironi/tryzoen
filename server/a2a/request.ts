import { readBody, BodyTooLarge } from "../http/body";
import { withTimeout } from "../operations/async";
import { jsonString } from "@shared/validation";
import { z } from "zod";

import { A2AError } from "./tasks";

const RpcRequest = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.optional(z.unknown()),
});
export const TaskQuery = z.object({
  id: z.uuid(),
  historyLength: z.optional(z.number().int().min(0).max(50)),
});

export const readRpcRequest = async function (request: Request) {
  if (!request.body)
    throw new A2AError({
      code: -32600,
      message: "Request body is required",
    });
  const version = request.headers.get("A2A-Version");
  if (version && version !== "1.0")
    throw new A2AError({
      code: -32009,
      message: "Supported A2A version: 1.0",
    });
  const source = request.body;
  let body: string;
  try {
    body = (
      await withTimeout(() => readBody(source, 40 * 1024), 5_000)
    ).toString("utf8");
  } catch (error) {
    throw new A2AError({
      code: error instanceof BodyTooLarge ? -32600 : -32700,
      message:
        error instanceof BodyTooLarge
          ? "Request exceeds 40 KiB"
          : "Cannot read request",
    });
  }
  const json = await Promise.try(async () =>
    jsonString(z.unknown()).parseAsync(body)
  ).catch(() => {
    throw new A2AError({ code: -32700, message: "Invalid JSON" });
  });
  try {
    return await RpcRequest.strict().parseAsync(json);
  } catch {
    throw new A2AError({ code: -32600, message: "Invalid JSON-RPC request" });
  }
};
