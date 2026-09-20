import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { renderToStaticMarkup } from "@tests/helpers/i18n";
import { expect, it, vi } from "vitest";
import type { listChats } from "@db/services/chats";

const mocks = vi.hoisted(() => ({ chats: vi.fn<typeof listChats>() }));

vi.mock("@db/services/chats", () => ({ listChats: mocks.chats }));
vi.mock("@web/auth/request-scope", () => ({
  requireRequestScope: async () => ({ userId: "user", workspaceId: "team" }),
}));
vi.mock("@web/i18n/server", () => ({
  getI18n: async () => ({ t: (key: string) => key, locale: "en" }),
}));

import AllChatsPage from "./page";

const searchParams = new URLSearchParams("space=team");

it("keeps new and existing conversations in the selected workspace", async () => {
  mocks.chats.mockResolvedValue([
    {
      channel: null,
      createdAt: "2026-09-19T12:00:00.000Z",
      updatedAt: "2026-09-19T12:00:00.000Z",
      sessionId: "session/one",
      title: "Team conversation",
      usage: { costUsd: null, inputTokens: 1, outputTokens: 1 },
    },
  ]);
  const page = await AllChatsPage();
  const html = renderToStaticMarkup(
    <SearchParamsContext.Provider value={searchParams}>
      {page}
    </SearchParamsContext.Provider>
  );
  expect(mocks.chats).toHaveBeenCalledWith({
    userId: "user",
    workspaceId: "team",
  });
  expect(html).toContain('href="/chat?space=team"');
  expect(html).toContain('href="/chat/session%2Fone?space=team"');
});
