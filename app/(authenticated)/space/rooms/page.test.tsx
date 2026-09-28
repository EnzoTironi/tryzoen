import { renderToStaticMarkup } from "@tests/helpers/i18n";
import { expect, it, vi } from "vitest";
import RoomsPage from "./page";

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) =>
      react.useState(initial === undefined ? "binding" : initial),
  };
});
vi.mock("@web/auth/client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "viewer" } } }) },
}));
vi.mock("@web/trpc/client", () => ({
  api: {
    workspaces: {
      rooms: {
        list: { useQuery: () => ({ data: { mayManage: false } }) },
        create: { useMutation: () => ({}) },
        close: { useMutation: () => ({}) },
      },
    },
  },
}));
vi.mock("@app/companion/inbox", () => ({
  ConnectedRoom: ({
    roomId,
    cacheScope,
  }: {
    roomId: string;
    cacheScope: string;
  }) => <output>{JSON.stringify({ roomId, cacheScope })}</output>,
}));
it("uses the shared conversation with account and workspace isolated caches", () => {
  const html = renderToStaticMarkup(<RoomsPage />);
  expect(html).toContain("binding");
  expect(html).toContain("viewer");
  expect(html).toContain("personal");
  expect(html).not.toContain("Encerrar para todos");
});
