import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "@tests/helpers/i18n";
import { ReminderList } from "./reminder-list";

const searchParams = new URLSearchParams("space=team-audit");

vi.mock("@web/trpc/client", () => ({
  api: {
    workspaces: {
      schedules: {
        setStatus: { useMutation: () => ({ isPending: false }) },
      },
    },
  },
}));

test("creating a team reminder or exploring recipes retains its workspace", () => {
  const html = renderToStaticMarkup(
    <SearchParamsContext.Provider value={searchParams}>
      <ReminderList reminders={[]} hasMore={false} />
    </SearchParamsContext.Provider>
  );
  expect(html).toContain('href="/chat?starter=reminder&amp;space=team-audit"');
  expect(html).toContain('href="/recipes?space=team-audit"');
});

test("opening an existing reminder conversation retains its workspace", () => {
  const html = renderToStaticMarkup(
    <SearchParamsContext.Provider value={searchParams}>
      <ReminderList
        hasMore={false}
        reminders={[
          {
            id: "reminder-audit",
            revision: 0,
            mayManage: true,
            prompt: "Review synthetic notes",
            status: "active",
            nextRunAt: new Date("2030-01-01T12:00:00Z"),
            conversationChannel: "eve",
            originalSessionId: "audit-session",
            latestRunStatus: null,
            latestReportStatus: null,
            latestScheduledFor: null,
          },
        ]}
      />
    </SearchParamsContext.Provider>
  );
  expect(html).toContain('href="/chat/audit-session?space=team-audit"');
});
