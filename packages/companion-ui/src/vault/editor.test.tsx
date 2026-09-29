import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VaultItemEditor } from "./editor";
import type { VaultData } from "./data";

const state = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  cleanup: [] as (() => void)[],
  background: undefined as ((value: string) => void) | undefined,
  value: vi.fn<(value: unknown) => void>(),
  failed: vi.fn<(value: unknown) => void>(),
  remove: vi.fn<() => void>(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => [
    initial,
    initial === false ? state.failed : state.value,
  ],
  useEffect: (effect: () => void | (() => void)) => {
    state.effects.push(effect);
  },
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AppState: {
    addEventListener: (_: string, listener: (value: string) => void) => {
      state.background = listener;
      return { remove: state.remove };
    },
  },
}));
vi.mock("../page", () => ({ pageStyles: {} }));
vi.mock("../button", () => ({
  ActionButton: ({ children }: { children: string }) => (
    <button>{children}</button>
  ),
}));
vi.mock("./form", () => ({ VaultItemForm: () => null }));
const data = {
  list: vi.fn<VaultData["list"]>(),
  create: vi.fn<VaultData["create"]>(),
  read: vi.fn<VaultData["read"]>(),
  update: vi.fn<VaultData["update"]>(),
  remove: vi.fn<VaultData["remove"]>(),
};
const done = vi.fn<() => void>();
const item = {
  id: "saved",
  kind: "login" as const,
  label: "Saved login",
  account: "masked",
  hasSecret: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
function openEditor() {
  const html = renderToStaticMarkup(
    <VaultItemEditor item={item} data={data} onDone={done} />
  );
  for (const effect of state.effects) {
    const cleanup = effect();
    if (cleanup) state.cleanup.push(cleanup);
  }
  return html;
}
beforeEach(() => {
  vi.clearAllMocks();
  state.effects = [];
  state.cleanup = [];
});
afterEach(() => {
  for (const cleanup of state.cleanup) cleanup();
  vi.useRealTimers();
});
it("cancels an unfinished secret read on background and discards its late result", async () => {
  let resolve:
    | ((value: Awaited<ReturnType<VaultData["read"]>>) => void)
    | undefined;
  data.read.mockImplementation(
    () =>
      new Promise((finish) => {
        resolve = finish;
      })
  );
  expect(openEditor()).toContain("Opening saved item");
  expect(data.read).toHaveBeenCalledWith(
    { id: item.id, updatedAt: item.updatedAt },
    expect.any(AbortSignal)
  );
  state.background?.("background");
  expect(data.read.mock.calls[0]?.[1]?.aborted).toBe(true);
  expect(done).toHaveBeenCalledOnce();
  resolve?.({
    kind: "login",
    label: "Late",
    account: "",
    secret: "late-secret",
  });
  await Promise.resolve();
  expect(state.value).not.toHaveBeenCalled();
  expect(data.update).not.toHaveBeenCalled();
});
it("aborts on unmount and does not show a rejected late response", async () => {
  let reject: ((error: Error) => void) | undefined;
  data.read.mockImplementation(
    () =>
      new Promise((_finish, fail) => {
        reject = fail;
      })
  );
  openEditor();
  for (const cleanup of state.cleanup.splice(0)) cleanup();
  reject?.(new Error("Network closed"));
  await Promise.resolve();
  expect(state.failed).not.toHaveBeenCalled();
  expect(state.remove).toHaveBeenCalledOnce();
  expect(done).not.toHaveBeenCalled();
});
it("expires the editor after five minutes without saving", async () => {
  vi.useFakeTimers();
  data.read.mockResolvedValue(null);
  openEditor();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(done).toHaveBeenCalledOnce();
  expect(data.read.mock.calls[0]?.[1]?.aborted).toBe(true);
  expect(data.update).not.toHaveBeenCalled();
});
