import type { HookEvent } from "eve/hooks";
import { z } from "zod";

const agentTaskReceiptSchema = z.strictObject({
  agentId: z.string().min(1),
  status: z.literal("working"),
  taskId: z.string().min(1),
});

export function readAgentTaskReceipt(event: HookEvent<"action.result">) {
  const { result, status } = event.data;
  if (
    status !== "completed" ||
    result.kind !== "tool-result" ||
    result.isError ||
    (result.toolName !== "agent" && result.toolName !== "browser-agent")
  )
    return undefined;

  const receipt = agentTaskReceiptSchema.safeParse(result.output);
  return receipt.success ? receipt.data : undefined;
}
