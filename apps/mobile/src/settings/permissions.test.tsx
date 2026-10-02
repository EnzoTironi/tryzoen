import { renderToSourceMarkup as renderToStaticMarkup } from "../../../../tests/helpers/companion-i18n";
import type { ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { CredentialPermissions } from "./permissions";

const mocks = vi.hoisted(() => ({
  userId: "owner",
  sessionId: "session",
  accountPending: false,
  accountError: null as Error | null,
  selected: undefined as string | undefined,
  listError: false,
  listPending: false,
  listFetching: false,
  mutationError: false,
  mayManage: true,
  items: [
    {
      id: "grant",
      itemId: "item",
      label: "Test credential",
      expiresAt: "2030-01-01T00:00:00Z",
    },
  ],
  query: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  mutation: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  getSession: vi.fn<() => Promise<unknown>>(),
  refetch: vi.fn<() => Promise<void>>(),
  setQueryData: vi.fn<(...args: unknown[]) => void>(),
  listener: undefined as ((state: string) => void) | undefined,
  cleanup: undefined as (() => void) | undefined,
  options: undefined as unknown,
  revoke: undefined as unknown,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: () => [mocks.selected, vi.fn<() => void>()],
  useEffect: (effect: () => () => void) => {
    mocks.cleanup = effect();
  },
}));
vi.mock("react-native", () => ({
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mocks.listener = listener;
      return {
        remove: () => {
          mocks.listener = undefined;
        },
      };
    },
  },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
}));
vi.mock("@zoen/companion-ui", () => ({
  ActionButton: ({
    children,
    disabled,
  }: {
    children: ReactNode;
    disabled?: boolean;
  }) => <button disabled={disabled}>{children}</button>,
}));
vi.mock("../auth", () => ({
  auth: {
    useSession: () => ({
      isPending: mocks.accountPending,
      error: mocks.accountError,
      data: mocks.userId
        ? { user: { id: mocks.userId }, session: { id: mocks.sessionId } }
        : null,
    }),
    getSession: mocks.getSession,
  },
}));
vi.mock("../api", () => ({
  rpc: { query: mocks.query, mutation: mocks.mutation },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: mocks.setQueryData }),
  useQuery: (options: unknown) => {
    mocks.options = options;
    return {
      data: { mayManage: mocks.mayManage, items: mocks.items },
      isPending: mocks.listPending,
      isError: mocks.listError,
      isFetching: mocks.listFetching,
      refetch: mocks.refetch,
    };
  },
  useMutation: (options: unknown) => {
    mocks.revoke = options;
    return {
      isPending: false,
      isError: mocks.mutationError,
      reset: vi.fn<() => void>(),
      mutate: vi.fn<() => void>(),
    };
  },
}));
function render() {
  return renderToStaticMarkup(<CredentialPermissions />);
}
function mutation() {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The mocked useMutation captures these exact production callback options.
  return mocks.revoke as {
    mutationFn: (id: string) => Promise<{
      id: string;
      permissions: { mayManage: boolean; items: typeof mocks.items };
    }>;
    onSuccess: (result: {
      id: string;
      permissions: { mayManage: boolean; items: typeof mocks.items };
    }) => Promise<void>;
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, {
    userId: "owner",
    sessionId: "session",
    accountPending: false,
    accountError: null,
    selected: undefined,
    listError: false,
    listPending: false,
    listFetching: false,
    mutationError: false,
    mayManage: true,
    items: [
      {
        id: "grant",
        itemId: "item",
        label: "Test credential",
        expiresAt: "2030-01-01T00:00:00Z",
      },
    ],
  });
  mocks.getSession.mockResolvedValue({
    data: { user: { id: "owner" }, session: { id: "session" } },
  });
  mocks.query.mockImplementation(async () => ({
    mayManage: mocks.mayManage,
    items: mocks.items,
  }));
  mocks.mutation.mockResolvedValue({ revoked: true });
  mocks.refetch.mockResolvedValue(undefined);
});
test("renders metadata without revoking, requires a separate confirmation", () => {
  expect(render()).toContain("Test credential");
  expect(render()).not.toContain("Confirm revocation");
  expect(mocks.mutation).not.toHaveBeenCalled();
  mocks.selected = "grant";
  expect(render()).toContain("Confirm revocation");
  expect(render()).toContain("Keep access");
  expect(mocks.mutation).not.toHaveBeenCalled();
});
test("revokes only the selected fresh grant and removes it from cache before refetch", async () => {
  render();
  const result = await mutation().mutationFn("grant");
  expect(mocks.mutation).toHaveBeenCalledExactlyOnceWith(
    "workspaces.vault.revoke",
    { id: "grant" }
  );
  await mutation().onSuccess(result);
  expect(mocks.setQueryData).toHaveBeenCalledWith(
    ["settings", "credential-permissions", "owner", "session"],
    { mayManage: true, items: [] }
  );
  expect(mocks.refetch).toHaveBeenCalledOnce();
});
test.each(["other-user", "other-session", "read-only", "revoked"])(
  "refuses stale authority: %s",
  async (reason) => {
    render();
    if (reason === "other-user")
      mocks.getSession.mockResolvedValue({
        data: { user: { id: "other" }, session: { id: "session" } },
      });
    if (reason === "other-session")
      mocks.getSession.mockResolvedValue({
        data: { user: { id: "owner" }, session: { id: "other" } },
      });
    if (reason === "read-only") mocks.mayManage = false;
    if (reason === "revoked") mocks.items = [];
    await expect(mutation().mutationFn("grant")).rejects.toThrow(
      /Sign in again|permission has changed/u
    );
    expect(mocks.mutation).not.toHaveBeenCalled();
  }
);
test.each([
  "signed-out",
  "account-pending",
  "account-error",
  "list-error",
  "mutation-error",
])("hides stale metadata when %s", (reason) => {
  if (reason === "signed-out") mocks.userId = "";
  if (reason === "account-pending") mocks.accountPending = true;
  if (reason === "account-error")
    mocks.accountError = new Error("private provider error");
  if (reason === "list-error") mocks.listError = true;
  if (reason === "mutation-error") mocks.mutationError = true;
  const html = render();
  expect(html).not.toContain("Test credential");
  expect(html).not.toContain("private provider error");
});
test("shows empty/loading states and read-only controls", () => {
  mocks.items = [];
  expect(render()).toContain("No active credential permissions.");
  mocks.listPending = true;
  expect(render()).toContain("Loading permissions");
  mocks.listPending = false;
  mocks.mayManage = false;
  mocks.items = [
    {
      id: "grant",
      itemId: "item",
      label: "Test credential",
      expiresAt: "2030-01-01T00:00:00Z",
    },
  ];
  expect(render()).toContain("Only a workspace owner or administrator");
  expect(render()).toContain('<button disabled="">Revoke');
});
test("query is account scoped, cancellation forwarded and unknown credential payload omitted", async () => {
  render();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The mocked useQuery captures these exact production callback options.
  const options = mocks.options as {
    queryKey: unknown[];
    enabled: boolean;
    queryFn: (input: { signal: AbortSignal }) => Promise<unknown>;
  };
  expect(options.queryKey).toEqual([
    "settings",
    "credential-permissions",
    "owner",
    "session",
  ]);
  const signal = new AbortController().signal;
  mocks.query.mockResolvedValue({
    mayManage: true,
    items: mocks.items,
    secret: "must-not-enter-cache",
  });
  const result = await options.queryFn({ signal });
  expect(mocks.query).toHaveBeenCalledWith(
    "workspaces.vault.delegations",
    undefined,
    { signal }
  );
  expect(result).not.toHaveProperty("secret");
});

test("role loss removes an already selected confirmation", () => {
  mocks.selected = "grant";
  mocks.mayManage = false;
  expect(render()).not.toContain("Confirm revocation");
});

test("failed revocation never removes a grant from cache", async () => {
  render();
  mocks.mutation.mockRejectedValue(new Error("Access revoked by server"));
  await expect(mutation().mutationFn("grant")).rejects.toThrow(
    "Access revoked by server"
  );
  expect(mocks.setQueryData).not.toHaveBeenCalled();
});

test("foreground revalidates permissions and stale metadata stays hidden while checking", () => {
  render();
  mocks.listener?.("background");
  expect(mocks.refetch).not.toHaveBeenCalled();
  mocks.listener?.("active");
  expect(mocks.refetch).toHaveBeenCalledOnce();
  mocks.listFetching = true;
  expect(render()).not.toContain("Test credential");
  expect(render()).toContain("Loading permissions");
  mocks.cleanup?.();
  expect(mocks.listener).toBeUndefined();
  const options = mocks.options;
  expect(options).toMatchObject({ staleTime: 0, refetchOnMount: "always" });
});
