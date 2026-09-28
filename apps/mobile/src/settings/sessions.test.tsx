import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { SignedInSessions } from "./sessions";

const mocks = vi.hoisted(() => ({
  currentUser: "owner",
  currentSession: "current",
  selected: undefined as string | undefined,
  failed: false,
  error: null as Error | null,
  social: vi.fn<() => Promise<unknown>>(),
  signOut: vi.fn<() => Promise<unknown>>(),
  pending: false,
  list: vi.fn<() => Promise<unknown>>(),
  getSession: vi.fn<() => Promise<unknown>>(),
  revoke: vi.fn<(input: { token: string }) => Promise<unknown>>(),
  refetch: vi.fn<() => Promise<void>>(),
  query: undefined as
    | { queryKey: unknown[]; enabled: boolean; queryFn: () => Promise<unknown> }
    | undefined,
  mutation: undefined as
    | {
        mutationFn: (id: string) => Promise<void>;
        onSuccess: () => Promise<void>;
      }
    | undefined,
}));
const records = [
  {
    id: "current",
    token: "never-display-current-token",
    userAgent: "Current app",
    updatedAt: new Date(0),
  },
  {
    id: "other",
    token: "never-display-other-token",
    userAgent: "Other app",
    updatedAt: new Date(0),
  },
];
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: () => [mocks.selected, vi.fn<() => void>()],
}));
vi.mock("@zoen/companion-ui/sheet", () => ({
  CompanionSheet: ({
    title,
    children,
  }: {
    title: string;
    children: ReactNode;
  }) => <section aria-label={title}>{children}</section>,
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
      isPending: false,
      data: mocks.currentUser
        ? {
            user: { id: mocks.currentUser },
            session: { id: mocks.currentSession },
          }
        : null,
    }),
    signIn: { social: mocks.social },
    signOut: mocks.signOut,
    listSessions: mocks.list,
    getSession: mocks.getSession,
    revokeSession: mocks.revoke,
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: typeof mocks.query) => {
    mocks.query = options;
    return {
      data: records,
      isError: mocks.failed,
      error: mocks.error,
      isPending: mocks.pending,
      refetch: mocks.refetch,
    };
  },
  useMutation: (options: typeof mocks.mutation) => {
    mocks.mutation = options;
    return {
      isPending: false,
      isError: false,
      mutate: vi.fn<() => void>(),
      reset: vi.fn<() => void>(),
    };
  },
}));
function render() {
  return renderToStaticMarkup(
    <SignedInSessions onClose={vi.fn<() => void>()} />
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser = "owner";
  mocks.currentSession = "current";
  mocks.selected = undefined;
  mocks.failed = false;
  mocks.error = null;
  mocks.social.mockResolvedValue({ error: null });
  mocks.pending = false;
  mocks.list.mockResolvedValue({ data: records, error: null });
  mocks.getSession.mockResolvedValue({
    data: { user: { id: "owner" }, session: { id: "current" } },
    error: null,
  });
  mocks.revoke.mockResolvedValue({ data: { status: true }, error: null });
});
it("labels this device, exposes only other-session removal and never renders tokens", () => {
  const html = render();
  expect(html).toContain("This device");
  expect(html.match(/Sign out this session/g)).toHaveLength(1);
  expect(html).not.toContain("never-display");
  expect(mocks.query?.queryKey).toEqual([
    "settings",
    "sessions",
    "owner",
    "current",
  ]);
});
it("requires confirmation and refuses to revoke this device or an unknown session", async () => {
  mocks.selected = "other";
  expect(render()).toContain("Confirm sign out");
  await expect(mocks.mutation?.mutationFn("current")).rejects.toThrow(
    "Refresh"
  );
  await expect(mocks.mutation?.mutationFn("unknown")).rejects.toThrow(
    "Refresh"
  );
  expect(mocks.revoke).not.toHaveBeenCalled();
});
it("revokes the selected session through the owning API and refreshes after success", async () => {
  render();
  await mocks.mutation?.mutationFn("other");
  expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith({
    token: "never-display-other-token",
  });
  await mocks.mutation?.onSuccess();
  expect(mocks.refetch).toHaveBeenCalledOnce();
});
it("rejects an account or session change before removal", async () => {
  render();
  mocks.getSession.mockResolvedValue({
    data: { user: { id: "different" }, session: { id: "current" } },
  });
  await expect(mocks.mutation?.mutationFn("other")).rejects.toThrow("Refresh");
  mocks.getSession.mockResolvedValue({
    data: { user: { id: "owner" }, session: { id: "other" } },
  });
  await expect(mocks.mutation?.mutationFn("other")).rejects.toThrow("Refresh");
  expect(mocks.revoke).not.toHaveBeenCalled();
});
it("hides cached session information when loading, signed out or the list fails", () => {
  mocks.failed = true;
  expect(render()).toContain("Try again");
  expect(render()).not.toContain("Other app");
  mocks.failed = false;
  mocks.pending = true;
  expect(render()).toContain("Loading sessions");
  expect(render()).not.toContain("Other app");
  mocks.currentUser = "";
  expect(render()).toContain("Sign in to review");
  expect(mocks.query?.enabled).toBe(false);
  expect(render()).not.toContain("Other app");
});
it("propagates provider failures without displaying sensitive error payloads", async () => {
  render();
  mocks.list.mockResolvedValue({ error: { message: "private provider data" } });
  await expect(mocks.query?.queryFn()).rejects.toThrow("Could not load");
  mocks.revoke.mockResolvedValue({
    error: { message: "private provider data" },
  });
  await expect(mocks.mutation?.mutationFn("other")).rejects.toThrow(
    "Could not sign out"
  );
});

it("offers native reauthentication for an expired freshness window without signing out", async () => {
  render();
  mocks.list.mockResolvedValue({
    error: { code: "SESSION_NOT_FRESH", message: "private data" },
  });
  try {
    await mocks.query?.queryFn();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    mocks.error = error;
  }
  mocks.failed = true;
  const html = render();
  expect(html).toContain("Sign in again with Google");
  expect(html).not.toContain("Other app");
  expect(html).not.toContain("Check your connection");
  await mocks.mutation?.mutationFn("");
  expect(mocks.social).toHaveBeenCalledWith({
    provider: "google",
    callbackURL: "/",
    loginHint: undefined,
  });
  expect(mocks.signOut).not.toHaveBeenCalled();
  expect(mocks.refetch).toHaveBeenCalledOnce();
});
it("leaves the current login intact when reauthentication fails", async () => {
  mocks.error = new Error("Fresh session required", {
    cause: "SESSION_NOT_FRESH",
  });
  mocks.failed = true;
  mocks.social.mockResolvedValue({ error: { message: "Cancelled" } });
  render();
  await expect(mocks.mutation?.mutationFn("")).rejects.toThrow(
    "Sign-in could not be completed"
  );
  expect(mocks.signOut).not.toHaveBeenCalled();
  expect(mocks.refetch).not.toHaveBeenCalled();
});
