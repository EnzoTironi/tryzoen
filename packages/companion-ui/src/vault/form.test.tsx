import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { VaultCreationForm } from "./form";
const state = vi.hoisted(() => ({
  buttons: new Map<string, () => void>(),
  effects: [] as (() => void | (() => void))[],
  cleanup: [] as (() => void)[],
  background: undefined as undefined | ((status: string) => void),
  remove: vi.fn<() => void>(),
  setDraft: vi.fn<(value: unknown) => void>(),
  setError: vi.fn<(value: unknown) => void>(),
  draft: {
    nickname: "Mail",
    origin: "https://example.invalid",
    identifierType: "email",
    identifier: "owner@example.invalid",
    password: "synthetic-secret",
    cardholderName: "",
    cardNumber: "",
    expiration: "",
    cvc: "",
    billingPostalCode: "",
  },
  fields: new Map<string, { secureTextEntry?: boolean }>(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => void | (() => void)) => {
    state.effects.push(effect);
  },
  useState: (initial: unknown) => [
    typeof initial === "object" ? state.draft : initial,
    typeof initial === "object"
      ? state.setDraft
      : initial === undefined
        ? state.setError
        : vi.fn<(value: unknown) => void>(),
  ],
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  TextInput: (props: {
    accessibilityLabel: string;
    secureTextEntry?: boolean;
  }) => {
    state.fields.set(props.accessibilityLabel, props);
    return (
      <input
        aria-label={props.accessibilityLabel}
        type={props.secureTextEntry ? "password" : "text"}
      />
    );
  },
  AppState: {
    addEventListener: (_name: string, listener: (status: string) => void) => {
      state.background = listener;
      return { remove: state.remove };
    },
  },
}));
vi.mock("../page", () => ({ pageStyles: { copy: {} } }));
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
const create = vi.fn<() => Promise<void>>();
const done = vi.fn<() => void>();
function render(kind: "login" | "payment" = "login") {
  renderToStaticMarkup(
    <VaultCreationForm kind={kind} data={{ create }} onDone={done} />
  );
  for (const effect of state.effects) {
    const cleanup = effect();
    if (cleanup) state.cleanup.push(cleanup);
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  state.buttons.clear();
  state.effects = [];
  state.cleanup = [];
  state.fields.clear();
  create.mockResolvedValue(undefined);
});
it("cancels without creating and masks the password input", () => {
  render();
  expect(state.fields.get("Password")?.secureTextEntry).toBe(true);
  state.buttons.get("Cancel")?.();
  expect(create).not.toHaveBeenCalled();
  expect(done).toHaveBeenCalledOnce();
});
it("submits explicitly once even when pressed twice while pending", async () => {
  let finish: (() => void) | undefined;
  create.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  render();
  state.buttons.get("Save login")?.();
  state.buttons.get("Save login")?.();
  expect(create).toHaveBeenCalledOnce();
  finish?.();
  await vi.waitFor(() => {
    expect(done).toHaveBeenCalledOnce();
  });
});
it("discards on background and removes lifecycle listeners", () => {
  render();
  state.background?.("background");
  expect(done).toHaveBeenCalledOnce();
  expect(create).not.toHaveBeenCalled();
  for (const cleanup of state.cleanup) cleanup();
  expect(state.remove).toHaveBeenCalledOnce();
});
it("does not invoke a stale save callback after unmount", async () => {
  let finish: (() => void) | undefined;
  create.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  render();
  state.buttons.get("Save login")?.();
  for (const cleanup of state.cleanup) cleanup();
  finish?.();
  await Promise.resolve();
  await Promise.resolve();
  expect(done).not.toHaveBeenCalled();
});

it("preserves a login draft rejected by the final payload size limit", () => {
  const previous = state.draft.password;
  state.draft.password = "x".repeat(20_000);
  render();
  state.buttons.get("Save login")?.();
  expect(create).not.toHaveBeenCalled();
  expect(state.setDraft).not.toHaveBeenCalled();
  expect(state.setError).toHaveBeenCalledWith(expect.any(String));
  expect(done).not.toHaveBeenCalled();
  state.draft.password = previous;
});
it("preserves card secrets when canonical cardholder limits reject the form", () => {
  Object.assign(state.draft, {
    cardholderName: "x".repeat(201),
    cardNumber: "4242424242424242",
    expiration: "12/99",
    cvc: "123",
    billingPostalCode: "00000",
  });
  render("payment");
  state.buttons.get("Save card")?.();
  expect(create).not.toHaveBeenCalled();
  expect(state.setDraft).not.toHaveBeenCalled();
  expect(state.setError).toHaveBeenCalledWith(expect.any(String));
  expect(done).not.toHaveBeenCalled();
});
