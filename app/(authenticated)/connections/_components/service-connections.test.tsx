import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "@tests/helpers/i18n";
import { ServiceConnections } from "./service-connections";

const searchParams = new URLSearchParams("space=team-audit");

vi.mock("@web/trpc/client", () => ({
  api: {
    workspaces: {
      tools: {
        connections: {
          list: {
            useQuery: () => ({
              data: [{ id: "audit", name: "Audit service" }],
            }),
          },
        },
      },
    },
  },
}));

test("connected services and their management open the selected workspace", () => {
  const html = renderToStaticMarkup(
    <SearchParamsContext.Provider value={searchParams}>
      <ServiceConnections />
    </SearchParamsContext.Provider>
  );
  expect(
    [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1])
  ).toEqual(["/space?space=team-audit", "/space?space=team-audit"]);
});
