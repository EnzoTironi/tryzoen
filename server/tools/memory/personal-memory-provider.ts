import {
  defineMemoryProvider,
  type MemoryOperationContext,
  type MemoryToolsContext,
  type MemoryToolSet,
} from "eve/memory";
import { fileMemory } from "eve/memory/file";
import { createMemoryDocumentBackend } from "@agent/lib/memory-document-backend";
import { authorizePersonalMemoryContext } from "@agent/lib/personal-memory-access";
import { preserveProfileMemoryCancellation } from "@agent/lib/profile-memory";

const fileFor = (context: MemoryOperationContext | MemoryToolsContext) =>
  fileMemory({
    backend: createMemoryDocumentBackend(() =>
      authorizePersonalMemoryContext(context)
    ),
  });

export const personalMemoryProvider = preserveProfileMemoryCancellation(
  defineMemoryProvider({
    recall: {
      "turn.started": (context) =>
        fileFor(context).recall["turn.started"](context),
      "compaction.completed": (context) =>
        fileFor(context).recall["compaction.completed"]?.(context),
    },
    async tools(context) {
      await authorizePersonalMemoryContext(context);
      const tools = await fileFor(context).tools?.(context);
      if (!tools) return null;
      return Object.fromEntries(
        Object.entries(tools).map(([name, tool]) => [
          name,
          {
            ...tool,
            async execute(input, executionContext) {
              const current = {
                ...context,
                session: executionContext.session,
                abortSignal: executionContext.abortSignal,
              };
              const provider = fileFor(current);
              const target = (await provider.tools?.(current))?.[name];
              if (!target)
                throw new Error("Native memory tool is unavailable.");
              await target.execute(input, executionContext);
              // Eve recalls at turn/compaction boundaries. Return current notes
              // in the tool result so the very next model step sees the update.
              const recalled = await provider.recall["turn.started"]({
                ...current,
                getSandbox: () => executionContext.getSandbox(),
                getSkill: (identifier) => executionContext.getSkill(identifier),
                operationId: `${executionContext.session.id}:${executionContext.callId}:recall`,
              });
              return {
                updated: true,
                instruction:
                  "These are the current profile notes. They replace earlier recalled notes; do not reconstruct removed facts from history.",
                notes: recalled?.messages ?? [],
              };
            },
          } satisfies MemoryToolSet[string],
        ])
      );
    },
  })
);
