import type { AgentPanelData } from "@zoen/companion-ui";
import { personalMemorySnapshotSchema } from "../personal-memory/schema";
import { personalNoteText } from "../personal-memory/document";
import { remindersPageSchema } from "../schedules/reminders";

export function companionAgentData(rpc: {
  query: (path: string, input?: unknown) => Promise<unknown>;
  mutation: (path: string, input?: unknown) => Promise<unknown>;
}): AgentPanelData {
  return {
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
        items: page.reminders.map((item) => ({
          id: item.id,
          revision: item.revision,
          title: item.prompt,
          status: item.status,
          canManage: item.mayManage,
          conversationId: item.originalSessionId ?? undefined,
          nextRun: item.nextRunAt?.toLocaleString(),
          lastRun: item.latestRunStatus?.replaceAll("_", " "),
          delivery: item.latestReportStatus?.replaceAll("_", " "),
        })),
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
