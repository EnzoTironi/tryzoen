import type { MockModelRequest, MockModelResponse } from "eve/evals";

export function messagingReply({
  lastUserMessage,
  tools,
  toolResults,
}: MockModelRequest): MockModelResponse | string | undefined {
  if (lastUserMessage !== "message-and-react") return undefined;
  for (const name of ["react_to_message", "send_message"]) {
    if (!tools.some((tool) => tool.name === name))
      throw new Error(`Production messaging tool ${name} did not resolve.`);
  }
  if (toolResults.length > 0) return "DELIVERY_COMPLETE";
  return {
    toolCalls: [
      { name: "react_to_message", input: { type: "heart" } },
      {
        name: "send_message",
        input: { kind: "message", text: "A real native message." },
      },
    ],
  };
}
