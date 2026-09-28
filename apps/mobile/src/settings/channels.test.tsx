import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { LinkedChannels } from "./channels";
const mocks = vi.hoisted(() => ({
  userId: "owner",
  sessionId: "session",
  pending: false,
  error: false,
  fetching: false,
  listError: false,
  selected: undefined as string | undefined,
  revoked: false,
  lastAccess: false,
  unlinkError: false,
  signOutError: false,
  items: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      channel: "telegram",
      senderId: "synthetic-sender",
    },
  ],
  query: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  mutation: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  getSession: vi.fn<() => Promise<unknown>>(),
  signOut: vi.fn<() => Promise<unknown>>(),
  accountRefetch: vi.fn<() => Promise<void>>(),
  refetch: vi.fn<() => Promise<void>>(),
  clear: vi.fn<() => void>(),
  finish: vi.fn<() => void>(),
  setState: vi.fn<(value: unknown) => void>(),
  listener: undefined as ((value: string) => void) | undefined,
  cleanup: undefined as (() => void) | undefined,
  options: undefined as unknown,
  unlinkOptions: undefined as unknown,
  finishOptions: undefined as unknown,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => [
    typeof initial === "boolean" ? mocks.revoked : mocks.selected,
    mocks.setState,
  ],
  useEffect: (effect: () => () => void) => {
    mocks.cleanup = effect();
  },
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  AppState: {
    addEventListener: (_event: string, listener: (value: string) => void) => {
      mocks.listener = listener;
      return {
        remove: () => {
          mocks.listener = undefined;
        },
      };
    },
  },
}));
vi.mock("@zoen/companion-ui/sheet", () => ({
  CompanionSheet: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
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
vi.mock("../api", () => ({
  rpc: { query: mocks.query, mutation: mocks.mutation },
}));
vi.mock("../auth", () => ({
  auth: {
    useSession: () => ({
      isPending: mocks.pending,
      error: mocks.error ? new Error("private") : null,
      data: mocks.userId
        ? { user: { id: mocks.userId }, session: { id: mocks.sessionId } }
        : null,
      refetch: mocks.accountRefetch,
    }),
    getSession: mocks.getSession,
    signOut: mocks.signOut,
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ clear: mocks.clear }),
  useQuery: (options: unknown) => {
    mocks.options = options;
    return {
      data: mocks.items,
      isError: mocks.listError,
      isPending: false,
      isFetching: mocks.fetching,
      refetch: mocks.refetch,
    };
  },
  useMutation: (options: { onSuccess?: unknown }) => {
    if (options.onSuccess) {
      mocks.unlinkOptions = options;
      return {
        isError: mocks.unlinkError,
        isPending: false,
        data: mocks.lastAccess ? { status: "last_access" } : undefined,
        mutate: vi.fn<() => void>(),
        reset: vi.fn<() => void>(),
      };
    }
    mocks.finishOptions = options;
    return {
      isError: mocks.signOutError,
      isPending: false,
      mutate: mocks.finish,
    };
  },
}));
function render() {
  return renderToStaticMarkup(<LinkedChannels onClose={() => undefined} />);
}
function unlink() {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The mocked hook captures production mutation options.
  return mocks.unlinkOptions as {
    mutationFn: (id: string) => Promise<{ status: "revoked" | "last_access" }>;
    onSuccess: (result: { status: "revoked" | "last_access" }) => Promise<void>;
  };
}
function finish() {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The mocked hook captures production mutation options.
  return mocks.finishOptions as { mutationFn: () => Promise<void> };
}
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, {
    userId: "owner",
    sessionId: "session",
    pending: false,
    error: false,
    fetching: false,
    listError: false,
    selected: undefined,
    revoked: false,
    lastAccess: false,
    unlinkError: false,
    signOutError: false,
    items: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        channel: "telegram",
        senderId: "synthetic-sender",
      },
    ],
  });
  mocks.getSession.mockResolvedValue({
    data: { user: { id: "owner" }, session: { id: "session" } },
  });
  mocks.query.mockImplementation(async () => mocks.items);
  mocks.mutation.mockResolvedValue({ status: "revoked" });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.accountRefetch.mockResolvedValue(undefined);
  mocks.refetch.mockResolvedValue(undefined);
});
test("review requires explicit confirmation and explains global signout", () => {
  expect(render()).toContain("synthetic-sender");
  expect(render()).not.toContain("Unlink and sign out");
  expect(mocks.mutation).not.toHaveBeenCalled();
  mocks.selected = "00000000-0000-4000-8000-000000000001";
  expect(render()).toContain("Unlink and sign out");
  expect(render()).toContain("Keep linked");
  expect(render()).toContain("every Zoen session");
  expect(mocks.mutation).not.toHaveBeenCalled();
});
test("successful revoke clears private cache and starts local signout", async () => {
  render();
  const result = await unlink().mutationFn(
    "00000000-0000-4000-8000-000000000001"
  );
  await unlink().onSuccess(result);
  expect(mocks.mutation).toHaveBeenCalledExactlyOnceWith(
    "accountChannels.revoke",
    { identityId: "00000000-0000-4000-8000-000000000001" }
  );
  expect(mocks.clear).toHaveBeenCalledOnce();
  expect(mocks.finish).toHaveBeenCalledOnce();
  await finish().mutationFn();
  expect(mocks.signOut).toHaveBeenCalledOnce();
  expect(mocks.accountRefetch).toHaveBeenCalledOnce();
});
test("last_access preserves channel, cache and current session", async () => {
  render();
  mocks.mutation.mockResolvedValue({ status: "last_access" });
  const result = await unlink().mutationFn(
    "00000000-0000-4000-8000-000000000001"
  );
  await unlink().onSuccess(result);
  expect(mocks.clear).not.toHaveBeenCalled();
  expect(mocks.finish).not.toHaveBeenCalled();
  expect(mocks.signOut).not.toHaveBeenCalled();
  expect(mocks.refetch).toHaveBeenCalledOnce();
  mocks.lastAccess = true;
  expect(render()).toContain("kept to protect access");
  expect(render()).toContain("synthetic-sender");
});
test.each(["account", "session", "inactive"])(
  "fresh authorization rejects %s changes",
  async (reason) => {
    render();
    const id = "00000000-0000-4000-8000-000000000001";
    if (reason === "account")
      mocks.getSession.mockResolvedValue({
        data: { user: { id: "other" }, session: { id: "session" } },
      });
    if (reason === "session")
      mocks.getSession.mockResolvedValue({
        data: { user: { id: "owner" }, session: { id: "other" } },
      });
    if (reason === "inactive") mocks.query.mockResolvedValue([]);
    await expect(unlink().mutationFn(id)).rejects.toThrow(
      /session changed|no longer linked/u
    );
    expect(mocks.mutation).not.toHaveBeenCalled();
  }
);
test.each(["pending", "error", "fetching", "listError", "unlinkError"])(
  "hides cached identity during %s",
  (field) => {
    Object.assign(mocks, { [field]: true });
    expect(render()).not.toContain("synthetic-sender");
    expect(render()).not.toContain("private");
  }
);
test("signed-out and empty accounts are distinct", () => {
  mocks.items = [];
  expect(render()).toContain("No messaging channels linked");
  mocks.userId = "";
  expect(render()).toContain("Sign in to review");
});
test("local signout failure preserves revoked screen with recovery", async () => {
  render();
  mocks.signOut.mockResolvedValue({
    error: { message: "private provider error" },
  });
  await expect(finish().mutationFn()).rejects.toThrow(
    "Local sign-out could not finish"
  );
  mocks.revoked = true;
  mocks.signOutError = true;
  expect(render()).toContain("Finish signing out");
  expect(render()).not.toContain("synthetic-sender");
  expect(render()).not.toContain("private provider error");
});
test("foreground revalidates and subscriptions are cleaned up", () => {
  render();
  expect(mocks.options).toMatchObject({
    queryKey: ["settings", "linked-channels", "owner", "session"],
    staleTime: 0,
    refetchOnMount: "always",
  });
  mocks.listener?.("background");
  expect(mocks.refetch).not.toHaveBeenCalled();
  mocks.listener?.("active");
  expect(mocks.refetch).toHaveBeenCalledOnce();
  mocks.cleanup?.();
  expect(mocks.listener).toBeUndefined();
});

test("late unlink cleanup never signs out a replacement account or session", async () => {
  render();
  for (const [userId, sessionId] of [
    ["other", "new"],
    ["owner", "new"],
  ]) {
    mocks.getSession.mockResolvedValue({
      data: { user: { id: userId }, session: { id: sessionId } },
    });
    await finish().mutationFn();
  }
  expect(mocks.signOut).not.toHaveBeenCalled();
});
