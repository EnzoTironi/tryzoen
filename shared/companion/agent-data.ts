import { activityPageSchema } from "@zoen/companion-ui/activity";
import type { z } from "zod";
import {
  learnedMemorySnapshotSchema,
  learnedMemoryHistorySchema,
} from "@zoen/companion-ui/memory";
import type { scheduleTimingSchema } from "../schedules/timing";
import type { AgentPanelData } from "@zoen/companion-ui";
import { personalMemorySnapshotSchema } from "../personal-memory/schema";
import { personalNoteText } from "../personal-memory/document";
import {
  remindersPageSchema,
  reminderHistoryInputSchema,
  reminderHistorySchema,
} from "../schedules/reminders";
import { companionIdentitySchema } from "./schema";
import { agentFiles } from "../workspaces/agent-files";
import { companionDocumentHistory } from "./files";

export function companionAgentData(
  rpc: {
    query: (
      path: string,
      input?: unknown,
      options?: { signal?: AbortSignal }
    ) => Promise<unknown>;
    mutation: (path: string, input?: unknown) => Promise<unknown>;
  },
  newOperationId: () => string
): AgentPanelData {
  return {
    async activity(input, signal) {
      return activityPageSchema.parse(
        await rpc.query("companion.activity", input, { signal })
      );
    },
    learned: {
      newOperationId,
      async history(input) {
        return learnedMemoryHistorySchema.parse(
          await rpc.query("workspaces.memory.history", input)
        );
      },
      async read() {
        const snapshot = learnedMemorySnapshotSchema.parse(
          await rpc.query("workspaces.memory.list")
        );
        return {
          enabled: snapshot.enabled,
          workspaceEnabled: snapshot.workspaceEnabled,
          needsAttention: snapshot.needsAttention,
          documents: snapshot.results.map((item) => ({
            id: item.id,
            title: "Learned memory",
            text: item.memory,
            relations: item.relations,
            updated: item.updatedAt
              ? new Date(item.updatedAt).toLocaleString()
              : "",
          })),
        };
      },
      async save(id, text, operationId) {
        await rpc.mutation("workspaces.memory.write", {
          action: id ? "update" : "remember",
          memoryId: id,
          text,
          operationId,
        });
      },
      async relate(input, operationId) {
        await rpc.mutation("workspaces.memory.write", {
          ...input,
          action: "relate",
          operationId,
        });
      },
      async remove(id, operationId) {
        await rpc.mutation("workspaces.memory.write", {
          action: "delete",
          memoryId: id,
          operationId,
        });
      },
      async clear(operationId) {
        await rpc.mutation("workspaces.memory.write", {
          action: "clear",
          operationId,
        });
      },
      async setEnabled(enabled) {
        await rpc.mutation("workspaces.memory.setEnabled", { enabled });
      },
      async recover() {
        await rpc.mutation("workspaces.memory.recover");
      },
    },
    documentHistory: (path, cacheScope) =>
      companionDocumentHistory(rpc, path, cacheScope),
    newOperationId,
    async identity() {
      const snapshot = companionIdentitySchema.parse(
        await rpc.query("companion.identity")
      );
      const identity = snapshot.documents.find(
        (document) => document.path === "agent/IDENTITY.md"
      );
      return {
        revision: snapshot.revision,
        canEdit: snapshot.canEdit,
        name:
          /^Name:[ \t]*(\S[^\r\n]*)$/im
            .exec(identity?.content ?? "")?.[1]
            ?.trim()
            .slice(0, 80) ?? "Zoen",
        documents: ["IDENTITY", "SOUL", "MEMORY"].map((name) => {
          const path = `agent/${name}.md`;
          const saved = snapshot.documents.find(
            (document) => document.path === path
          );
          return {
            path,
            title:
              name === "IDENTITY"
                ? "Identity"
                : name === "SOUL"
                  ? "Soul"
                  : "Memory",
            text:
              saved?.content ??
              agentFiles.find((file) => file.path === path)?.content ??
              "",
            saved: Boolean(saved),
          };
        }),
      };
    },
    async saveIdentity(input) {
      await rpc.mutation("workspaces.write", input);
    },
    async memory() {
      const memory = personalMemorySnapshotSchema.parse(
        await rpc.query("personalMemory.read")
      );
      return {
        profile: Object.entries(memory.profile).flatMap(([label, value]) =>
          value ? [{ label: label.replaceAll(/([A-Z])/g, " $1"), value }] : []
        ),
        documents: memory.notes.documents.map((note, index) => ({
          id: note.version,
          title: `Personal notes${index ? ` ${index + 1}` : ""}`,
          text: personalNoteText(note.content),
          updated: new Date(note.updatedAt).toLocaleString(),
        })),
        unresolved: memory.notes.status === "unresolved",
      };
    },
    async saveNote(expectedVersion, content) {
      await rpc.mutation("personalMemory.updateNote", {
        expectedVersion,
        content,
      });
    },
    async schedules() {
      const page = remindersPageSchema.parse(
        await rpc.query("workspaces.schedules.list")
      );
      return {
        hasMore: page.hasMore,
        items: page.reminders.map((item) => {
          const cadence = scheduleCadence(item.timing);
          return {
            id: item.id,
            revision: item.revision,
            title: item.prompt,
            group: cadence.group,
            cadence: cadence.cadence,
            status: item.status,
            canManage: item.mayManage,
            conversationId: item.originalSessionId ?? undefined,
            nextRun: item.nextRunAt?.toLocaleString(),
            lastRun: item.latestRunStatus?.replaceAll("_", " "),
            delivery: item.latestReportStatus?.replaceAll("_", " "),
          };
        }),
      };
    },
    async scheduleHistory(id, cursor) {
      const input = reminderHistoryInputSchema.parse({
        id,
        cursor: cursor
          ? reminderHistoryInputSchema.shape.cursor.parse(JSON.parse(cursor))
          : undefined,
      });
      const page = reminderHistorySchema.parse(
        await rpc.query("workspaces.schedules.history", input)
      );
      return {
        items: page.items.map((run) => ({
          id: run.id,
          date: run.scheduledFor.toLocaleString(),
          status: run.status.replaceAll("_", " "),
          delivery: run.reportStatus.replaceAll("_", " "),
          summary:
            run.outcome?.kind === "nothing_to_report"
              ? run.outcome.reason
              : (run.outcome?.summary ?? ""),
        })),
        nextCursor: page.nextCursor ? JSON.stringify(page.nextCursor) : null,
      };
    },
    async setScheduleActive(id, revision, active) {
      await rpc.mutation("workspaces.schedules.setStatus", {
        id,
        revision,
        status: active ? "active" : "paused",
      });
    },
  };
}

function scheduleCadence(timing: z.output<typeof scheduleTimingSchema>) {
  if (timing.kind === "once")
    return {
      group: "Once",
      cadence: `Once · ${new Date(timing.at).toLocaleString()}`,
    };
  if (timing.kind === "interval")
    return {
      group: "Repeating",
      cadence: `Every ${timing.everyMinutes} minutes`,
    };
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const frequency =
    timing.frequency === "weekly"
      ? (days[timing.weekday ?? 0] ?? "Weekly")
      : timing.frequency === "weekdays"
        ? "Weekdays"
        : "Daily";
  return {
    group: timing.frequency === "weekly" ? "Weekly" : "Daily",
    cadence: `${frequency} at ${timing.localTime} · ${timing.timezone}`,
  };
}
