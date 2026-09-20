import { messagingReply } from "./lib/messaging-model";
import { defineAgent, defineDynamic } from "eve";
import { mockModel } from "eve/evals";
import { z } from "zod";

export default defineAgent({
  experimental: { workflow: { world: "@workflow/world-postgres" } },
  model: defineDynamic({
    events: {
      "step.started": () => ({
        modelContextWindowTokens: 128_000,
        model: mockModel((request) => {
          const {
            lastUserMessage,
            userMessageCount,
            toolResults,
            tools,
            messages,
          } = request;
          const messaging = messagingReply(request);
          if (messaging !== undefined) return messaging;
          // Native empty-response retries append a framework nudge. Keep the
          // authored scenario stable across that retry as a real provider would.
          const command = request.userMessages
            .map((message) => message.split("\n\nCurrent message:\n").at(-1))
            .findLast((message) => message?.startsWith("@Zoen group-"));
          if (command === "@Zoen group-save") {
            const listing = toolResults.find(
              (result) => result.name === "workspace_files_list"
            );
            if (!listing)
              return {
                toolCalls: [{ name: "workspace_files_list", input: {} }],
              };
            if (!toolResults.some((result) => result.name === "workspace-save"))
              return {
                toolCalls: [
                  {
                    name: "workspace-save",
                    input: {
                      path: "knowledge/group-decision.md",
                      content: "The shared release decision is Friday.",
                      expectedRevision: z
                        .object({ revision: z.nullable(z.string()) })
                        .parse(listing.output).revision,
                    },
                  },
                ],
              };
            return `Saved shared decision. Results: ${JSON.stringify(toolResults)}`;
          }
          if (command === "@Zoen group-recall") {
            if (!toolResults.length)
              return {
                toolCalls: [
                  {
                    name: "workspace_files_read",
                    input: { path: "knowledge/group-decision.md" },
                  },
                ],
              };
            return JSON.stringify({
              tools: tools.map((tool) => tool.name),
              messages,
              toolResults,
            });
          }
          if (command === "@Zoen group-approve" && !toolResults.length)
            return {
              text: "Group approval preamble.",
              toolCalls: [
                {
                  name: "group-action",
                  input: { text: "Approved group action" },
                },
              ],
            };
          if (command === "@Zoen group-message") {
            if (!toolResults.some((result) => result.name === "send_message"))
              return {
                text: "Native message preamble.",
                toolCalls: [
                  {
                    name: "send_message",
                    input: {
                      kind: "message",
                      text: "Native group message.",
                      replyTo: { kind: "current" },
                    },
                  },
                ],
              };
            if (
              !toolResults.some((result) => result.name === "react_to_message")
            )
              return {
                toolCalls: [
                  {
                    name: "react_to_message",
                    input: { type: "heart", operation: "add" },
                  },
                ],
              };
            return "Native message follow-up.";
          }
          if (command === "@Zoen group-react-only") {
            if (
              !toolResults.some((result) => result.name === "react_to_message")
            )
              return {
                text: "Native reaction preamble.",
                toolCalls: [
                  { name: "react_to_message", input: { type: "heart" } },
                ],
              };
            return "❤️";
          }
          if (
            command === "@Zoen group-react-empty" ||
            command === "@Zoen group-react-error"
          ) {
            if (!toolResults.length)
              return {
                toolCalls: [
                  { name: "react_to_message", input: { type: "heart" } },
                ],
              };
            if (command === "@Zoen group-react-error")
              throw new Error("Synthetic model failure after reaction");
            return "";
          }
          if (command === "@Zoen group-empty") return "";
          if (command === "@Zoen group-progress-failed-tool") {
            if (!toolResults.length)
              return {
                toolCalls: [
                  {
                    name: "send_message",
                    input: { kind: "message", text: "Synthetic progress." },
                  },
                ],
              };
            if (
              !toolResults.some(
                (result) => result.name === "workspace_files_read"
              )
            )
              return {
                toolCalls: [
                  {
                    name: "workspace_files_read",
                    input: {
                      path: "knowledge/reaction-test.md",
                      revision: "0000000000000000000000000000000000000000",
                    },
                  },
                ],
              };
            return "";
          }
          if (command === "@Zoen group-question" && !toolResults.length)
            return {
              text: "Group question preamble.",
              toolCalls: [
                {
                  name: "ask_question",
                  input: {
                    prompt: "Which release day?",
                    options: [{ id: "friday", label: "Friday" }],
                    allowFreeform: false,
                  },
                },
              ],
            };
          const memoryTool =
            lastUserMessage === "remember"
              ? "profile__save_memory"
              : "profile__remove_memory";
          if (
            (lastUserMessage === "remember" || lastUserMessage === "forget") &&
            !toolResults.some((result) => result.name === memoryTool)
          )
            return {
              toolCalls: [
                {
                  name: memoryTool,
                  input:
                    lastUserMessage === "remember"
                      ? { text: "Synthetic favorite color: orange" }
                      : { index: 0 },
                },
              ],
            };
          if (lastUserMessage === "recall")
            return JSON.stringify(
              messages.filter((message) => message.role === "user")
            );
          if (lastUserMessage === "write" && toolResults.length === 0)
            return {
              toolCalls: [
                {
                  name: "workspace-save",
                  input: {
                    path: "knowledge/native.md",
                    content: "Written by native Eve",
                    expectedRevision: null,
                  },
                },
              ],
            };
          if (lastUserMessage === "approve" && toolResults.length === 0)
            return {
              toolCalls: [
                { name: "approval", input: { text: "Approved content" } },
              ],
            };
          return `Turns: ${String(userMessageCount)}; tools: ${tools.map((tool) => tool.name).join(",")}; results: ${JSON.stringify(toolResults)}`;
        }),
      }),
    },
  }),
});
