import { renderToSourceMarkup as renderToStaticMarkup } from "../../../../tests/helpers/companion-i18n";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { MobileSettings } from "./index";

const state = vi.hoisted(() => ({
  page: undefined as string | undefined,
  session: "session-a",
  select: vi.fn<(page?: string) => void>(),
  buttons: new Map<string, () => void>(),
  panel: undefined as
    | undefined
    | ComponentProps<typeof import("@zoen/companion-ui").SettingsPanel>,
  pending: false,
  failed: false,
  mutate: vi.fn<() => void>(),
  mutation: undefined as undefined | (() => Promise<void>),
  memoryPrompt: undefined as undefined | ((text: string) => void),
}));
vi.mock("../i18n", () => ({ MobileLanguagePicker: () => null }));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: () => [state.page, state.select],
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("@tanstack/react-query", () => ({
  useMutation: ({ mutationFn }: { mutationFn: () => Promise<void> }) => {
    state.mutation = mutationFn;
    return {
      mutate: state.mutate,
      isPending: state.pending,
      isError: state.failed,
    };
  },
}));
vi.mock("../auth", () => ({
  auth: {
    useSession: () => ({
      data: {
        session: { id: state.session },
        user: { id: "owner", name: "Owner", email: "owner@example.invalid" },
      },
    }),
  },
}));
vi.mock("@zoen/companion-ui", () => ({
  MessageGestureSettings: () => <div>Message gestures</div>,
  SettingsPanel: (
    props: ComponentProps<typeof import("@zoen/companion-ui").SettingsPanel>
  ) => {
    state.panel = props;
    return <dialog>{props.children}</dialog>;
  },
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
  CreatorStudio: () => <button>Creator studio</button>,
}));
vi.mock("./vault", () => ({
  MobileVault: ({ kind }: { kind: string }) => <p>Saved vault {kind}</p>,
}));
vi.mock("./channels", () => ({
  LinkedChannels: () => <p>Real linked channel controls</p>,
}));
vi.mock("./permissions", () => ({
  CredentialPermissions: () => <p>Real credential grant controls</p>,
}));
vi.mock("./sessions", () => ({
  SignedInSessions: () => <p>Real signed-in session controls</p>,
}));
vi.mock("../agent-panel", () => ({
  MobileMemory: ({ onPrompt }: { onPrompt: (text: string) => void }) => {
    state.memoryPrompt = onPrompt;
    return <p>Personal memory controls</p>;
  },
}));
const onClose = vi.fn<() => void>();
const onPrompt = vi.fn<(text: string) => void>();
const onSignOut = vi.fn<() => Promise<void>>(async () => undefined);
const unusedCreatorOperation = async () => {
  throw new Error("Navigation must not call creator operations.");
};
const props = {
  onClose,
  onPrompt,
  onSignOut,
  creators: {
    pilotFeedback: unusedCreatorOperation,
    savePilotFeedback: unusedCreatorOperation,
    exportPilotFeedback: unusedCreatorOperation,
    pilots: unusedCreatorOperation,
    pilot: unusedCreatorOperation,
    invitePilot: unusedCreatorOperation,
    actOnPilot: unusedCreatorOperation,
    releaseCandidate: unusedCreatorOperation,
    approveRelease: unusedCreatorOperation,
    releases: unusedCreatorOperation,
    release: unusedCreatorOperation,
    exportRelease: unusedCreatorOperation,
    saveEvaluation: unusedCreatorOperation,
    list: unusedCreatorOperation,
    read: unusedCreatorOperation,
    save: unusedCreatorOperation,
    archive: unusedCreatorOperation,
    exportDraft: unusedCreatorOperation,
    exportPreview: unusedCreatorOperation,
    reviewPreview: unusedCreatorOperation,
    preview: unusedCreatorOperation,
    previews: unusedCreatorOperation,
    newId: () => "test-id",
  },
};
function render(page?: string) {
  state.page = page;
  return renderToStaticMarkup(<MobileSettings {...props} />);
}
beforeEach(() => {
  vi.clearAllMocks();
  state.buttons.clear();
  state.session = "session-a";
  state.pending = false;
  state.failed = false;
  state.memoryPrompt = undefined;
});
it("routes existing controls inline inside one settings surface", () => {
  for (const [page, content] of [
    ["channels", "Real linked channel controls"],
    ["permissions", "Real credential grant controls"],
    ["devices", "Real signed-in session controls"],
  ]) {
    const html = render(page);
    expect(html).toContain(content);
    expect(html.match(/<dialog>/gu)).toHaveLength(1);
  }
});
it("preserves shared selection, back and close navigation", () => {
  render("channels");
  state.panel?.onSelect("devices");
  expect(state.select).toHaveBeenCalledWith("devices");
  state.panel?.onBack();
  expect(state.select).toHaveBeenCalledWith(undefined);
  state.panel?.onClose();
  expect(onClose).toHaveBeenCalledOnce();
});
it("keeps creator studio access and starts bot creation as a conversation", () => {
  expect(render("general")).toContain("Creator studio");
  state.buttons.get("Create my bot")?.();
  expect(onClose).toHaveBeenCalledOnce();
  expect(onPrompt).toHaveBeenCalledWith(
    expect.stringContaining("Interview me")
  );
});
it("keeps personal memory and closes settings before its conversation prompt", () => {
  expect(render("data")).toContain("Personal memory controls");
  state.memoryPrompt?.("Review my memory");
  expect(onPrompt).toHaveBeenCalledWith("Review my memory");
  expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(
    onPrompt.mock.invocationCallOrder[0] ?? 0
  );
});
it("scopes navigation and mounted confirmations to the actual session", () => {
  const first = MobileSettings(props);
  state.session = "session-b";
  const next = MobileSettings(props);
  expect(first.key).toBe("session-a");
  expect(next.key).toBe("session-b");
});
it("preserves sign-out pending and failure behavior", async () => {
  state.pending = true;
  state.failed = true;
  render();
  expect(state.panel?.signingOut).toBe(true);
  expect(state.panel?.error).toBe("Could not sign out. Try again.");
  state.panel?.onSignOut();
  expect(state.mutate).toHaveBeenCalledOnce();
  await state.mutation?.();
  expect(onSignOut).toHaveBeenCalledOnce();
});
it("does not present unimplemented providers or payments as functional", () => {
  for (const page of ["connectors"]) {
    expect(render(page)).toContain("not available in this app yet");
    expect(state.buttons.size).toBe(0);
  }
});

it("routes saved login and card management without claiming a payment provider", () => {
  expect(render("vault")).toContain("Saved vault login");
  expect(render("wallet")).toContain("Saved vault payment");
});
