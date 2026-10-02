import type { useI18n } from "@zoen/companion-ui/i18n";
import { activityPageSchema } from "@zoen/companion-ui/activity";
import type { z } from "zod";
import {
  LearnedClaimReadSchema,
  LearnedClaimSearchSchema,
  LearnedClaimHistorySchema,
  LearnedClaimChangeResultSchema,
  LearnedClaimSetEnabledResultSchema,
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

const profileLabels: Readonly<Record<string, string>> = {
  addressLine1: "Address line 1",
  addressLine2: "Address line 2",
  city: "City",
  countryCode: "Country",
  dateOfBirth: "Date of birth",
  email: "Email",
  firstName: "First name",
  lastName: "Last name",
  phone: "Phone",
  postalCode: "Postal code",
  region: "Region",
};

export function companionAgentData(
  rpc: {
    query: (
      path: string,
      input?: unknown,
      options?: { signal?: AbortSignal }
    ) => Promise<unknown>;
    mutation: (path: string, input?: unknown) => Promise<unknown>;
  },
  newOperationId: () => string,
  memoryArchives: AgentPanelData["learned"]["archives"],
  { locale, t }: Pick<ReturnType<typeof useI18n>, "locale" | "t">
): AgentPanelData {
  return {
    async activity(input, signal) {
      return activityPageSchema.parse(
        await rpc.query("companion.activity", input, { signal })
      );
    },
    learned: {
      archives: memoryArchives,
      newOperationId,
      async history(input) {
        return LearnedClaimHistorySchema.parse(
          await rpc.query("workspaces.memory.history", input)
        );
      },
      async read(input = {}) {
        return LearnedClaimReadSchema.parse(
          await rpc.query("workspaces.memory.read", input)
        );
      },
      async search(input) {
        return LearnedClaimSearchSchema.parse(
          await rpc.query("workspaces.memory.search", input)
        );
      },
      async change(input) {
        return LearnedClaimChangeResultSchema.parse(
          await rpc.mutation("workspaces.memory.change", input)
        );
      },
      async setEnabled(input) {
        return LearnedClaimSetEnabledResultSchema.parse(
          await rpc.mutation("workspaces.memory.setEnabled", input)
        );
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
          value ? [{ label: t(profileLabels[label] ?? label), value }] : []
        ),
        documents: memory.notes.documents.map((note, index) => ({
          id: note.version,
          title: index
            ? t("Personal notes {number}", { number: index + 1 })
            : t("Personal notes"),
          text: personalNoteText(note.content),
          updated: new Date(note.updatedAt).toLocaleString(locale),
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
          const cadence = scheduleCadence(item.timing, { locale, t });
          return {
            id: item.id,
            revision: item.revision,
            title: item.prompt,
            group: t(cadence.group),
            cadence: cadence.cadence,
            status: item.status,
            canManage: item.mayManage,
            conversationId: item.originalSessionId ?? undefined,
            nextRun: item.nextRunAt?.toLocaleString(locale),
            lastRun: item.latestRunStatus ? t(item.latestRunStatus) : undefined,
            delivery: item.latestReportStatus
              ? t(item.latestReportStatus)
              : undefined,
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
          date: run.scheduledFor.toLocaleString(locale),
          status: t(run.status),
          delivery: t(run.reportStatus),
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

function scheduleCadence(
  timing: z.output<typeof scheduleTimingSchema>,
  { locale, t }: Pick<ReturnType<typeof useI18n>, "locale" | "t">
) {
  if (timing.kind === "once")
    return {
      group: "Once",
      cadence: t("Once · {date}", {
        date: new Date(timing.at).toLocaleString(locale),
      }),
    };
  if (timing.kind === "interval")
    return {
      group: "Repeating",
      cadence: t("Every {count} minutes", { count: timing.everyMinutes }),
    };
  const weekday = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, 0, 4 + (timing.weekday ?? 0))));
  const frequency =
    timing.frequency === "weekly"
      ? weekday
      : timing.frequency === "weekdays"
        ? "Weekdays"
        : "Daily";
  return {
    group: timing.frequency === "weekly" ? "Weekly" : "Daily",
    cadence: t("{frequency} at {time} · {timezone}", {
      frequency: t(frequency),
      time: timing.localTime,
      timezone: timing.timezone,
    }),
  };
}
