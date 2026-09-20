import { operationSignal, withTimeout } from "../operations/async";
import { TimeoutError } from "../operations/async";
import { jsonString } from "@shared/validation";
import { z } from "zod";
import { env } from "@shared/environment/env";

export const LearnedMemoryItemSchema = z.object({
  id: z.uuid(),
  memory: z.string().max(8000),
  createdAt: z.nullable(z.string()),
  updatedAt: z.nullable(z.string()),
});
const readResponse = z.object({
  results: z.array(LearnedMemoryItemSchema).max(200),
});
const writeResponse = z.object({
  ids: z.array(z.uuid()),
});

export class Mem0Error extends Error {
  readonly _tag = "Mem0Error";
  declare readonly reason:
    | "unconfigured"
    | "unavailable"
    | "conflict"
    | "not_found";
  constructor(input: {
    readonly reason: "unconfigured" | "unavailable" | "conflict" | "not_found";
  }) {
    super("Mem0Error");
    this.name = "Mem0Error";
    Object.assign(this, input);
  }
}

const request = async function (body: {
  readonly namespace: string;
  readonly action:
    | "list"
    | "search"
    | "remember"
    | "update"
    | "delete"
    | "clear";
  readonly operation_id?: string;
  readonly text?: string;
  readonly memory_id?: string;
  readonly infer?: boolean;
}) {
  try {
    return await withTimeout(async () => {
      const config = { url: env.ZOEN_MEM0_URL, key: env.ZOEN_MEM0_API_KEY };
      if (!config.url || !config.key)
        throw new Mem0Error({ reason: "unconfigured" });
      const authorization = `Bearer ${config.key.reveal()}`;
      const response = await Promise.try(async () => {
        return await ((signal) =>
          fetch(new URL("/v1/memory", config.url), {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization,
            },
            body: JSON.stringify(body),
            signal,
            redirect: "error",
            cache: "no-store",
          }))(operationSignal());
      }).catch(() => {
        throw new Mem0Error({ reason: "unavailable" });
      });
      if (!response.ok)
        throw new Mem0Error({
          reason:
            response.status === 409
              ? "conflict"
              : response.status === 404
                ? "not_found"
                : "unavailable",
        });
      try {
        return await response.text();
      } catch {
        throw new Mem0Error({ reason: "unavailable" });
      }
    }, 45000);
  } catch (error) {
    if (error instanceof TimeoutError) {
      throw new Mem0Error({ reason: "unavailable" });
    }
    throw error;
  }
};
export const Mem0 = {
  read: async function (namespace: string, query?: string) {
    const result = await request({
      namespace,
      action: query ? "search" : "list",
      text: query,
    });
    try {
      return await jsonString(readResponse).parseAsync(result);
    } catch {
      throw new Mem0Error({ reason: "unavailable" });
    }
  },
  mutate: async function (input: Parameters<typeof request>[0]) {
    const result = await request(input);
    try {
      return await jsonString(writeResponse).parseAsync(result);
    } catch {
      throw new Mem0Error({ reason: "unavailable" });
    }
  },
};
