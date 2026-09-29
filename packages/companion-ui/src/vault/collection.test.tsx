import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { VaultCollection } from "./collection";
import type { VaultData } from "./data";
const state = vi.hoisted(() => ({
  readOnly: false,
  failed: false,
  pending: false,
  next: vi.fn<() => Promise<void>>(),
  remove: vi.fn<(id: string) => Promise<boolean>>(),
  buttons: new Map<string, () => void>(),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: () => ({
    isError: state.failed,
    isPending: state.pending,
    isFetching: false,
    data: {
      pages: [
        {
          mayManage: !state.readOnly,
          items: [
            {
              id: "saved",
              label: "Saved login",
              account: "owner@example.invalid",
            },
          ],
        },
      ],
    },
    hasNextPage: true,
    fetchNextPage: state.next,
  }),
  useMutation: () => ({ isError: false, mutate: state.remove }),
}));
vi.mock("../page", () => ({ pageStyles: {} }));
vi.mock("./form", () => ({ VaultCreationForm: () => null }));
vi.mock("../button", () => ({
  ActionButton: ({
    children,
    onPress,
  }: {
    children: string;
    onPress: () => void;
  }) => {
    state.buttons.set(children, onPress);
    return <button>{children}</button>;
  },
}));
const data = {
  list: vi.fn<VaultData["list"]>(),
  create: vi.fn<VaultData["create"]>(),
  remove: state.remove,
};
function render() {
  return renderToStaticMarkup(
    <VaultCollection kind="login" data={data} cacheScope="account:session" />
  );
}
beforeEach(() => {
  state.readOnly = false;
  state.failed = false;
  state.pending = false;
  state.buttons.clear();
  vi.clearAllMocks();
});
it("offers metadata and explicit create to an authorized manager", () => {
  expect(render()).toContain("Saved login");
  expect(state.buttons.has("Add login")).toBe(true);
  expect(state.remove).not.toHaveBeenCalled();
});
it("shows read-only workspace metadata without creation controls", () => {
  state.readOnly = true;
  expect(render()).toContain("Only workspace owners and administrators");
  expect(state.buttons.has("Add login")).toBe(false);
});
it("hides cached metadata when authorization refresh fails", () => {
  state.failed = true;
  expect(render()).not.toContain("Saved login");
  expect(state.buttons.has("Try again")).toBe(true);
});
it("hides cached metadata until fresh authorization resolves", () => {
  state.pending = true;
  expect(render()).toContain("Loading saved items");
  expect(state.buttons.size).toBe(0);
});
it("requests the next bounded page only through its pagination action", () => {
  render();
  expect(state.next).not.toHaveBeenCalled();
  state.buttons.get("Show more saved items")?.();
  expect(state.next).toHaveBeenCalledOnce();
});
