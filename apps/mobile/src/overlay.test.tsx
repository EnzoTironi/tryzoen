import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { MobileOverlayProvider } from "./overlay.web";
import { MobileOverlayProvider as NativeProvider } from "./overlay";
import type { CompanionOverlayProps } from "@zoen/companion-ui";
import type { Dialog } from "@base-ui/react/dialog";

const state = vi.hoisted(() => ({
  props: undefined as CompanionOverlayProps | undefined,
  root: undefined as ComponentProps<typeof Dialog.Root> | undefined,
  popup: undefined as ComponentProps<typeof Dialog.Popup> | undefined,
}));
vi.mock("@base-ui/react/dialog", () => ({
  Dialog: {
    Root: (props: ComponentProps<typeof Dialog.Root>) => {
      state.root = props;
      return props.children;
    },
    Portal: ({ children }: { children: ReactNode }) => children,
    Backdrop: () => null,
    Popup: (props: ComponentProps<typeof Dialog.Popup>) => {
      state.popup = props;
      return <dialog aria-label={props["aria-label"]}>{props.children}</dialog>;
    },
  },
}));
vi.mock("@zoen/companion-ui", () => ({
  CompanionOverlayProvider: ({
    renderOverlay,
  }: {
    renderOverlay: (props: CompanionOverlayProps) => ReactNode;
  }) => (state.props ? renderOverlay(state.props) : null),
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.props = {
    title: "Settings",
    onClose: vi.fn<() => void>(),
    children: <button>Close settings</button>,
  };
});
function render() {
  return renderToStaticMarkup(
    <MobileOverlayProvider>
      <span />
    </MobileOverlayProvider>
  );
}
it("delegates trapping, Escape and focus restoration to the existing modal owner with an accessible name", () => {
  expect(render()).toContain('aria-label="Settings"');
  expect(state.root?.open).toBe(true);
  expect(state.root?.modal).not.toBe(false);
  expect(state.popup?.initialFocus).toBeUndefined();
  expect(state.popup?.finalFocus).toBeUndefined();
});
it("uses updated titles for family navigation", () => {
  render();
  state.props = {
    title: "Messaging channels",
    onClose: vi.fn<() => void>(),
    children: <button>Back</button>,
  };
  expect(render()).toContain('aria-label="Messaging channels"');
});
it("preserves explicit editor focus callbacks without applying a second focus target", () => {
  const focus = vi.fn<() => void>();
  state.props = {
    title: "Editor",
    onClose: vi.fn<() => void>(),
    children: <input />,
    focusOnOpen: focus,
  };
  render();
  const initialFocus = state.popup?.initialFocus;
  if (typeof initialFocus !== "function")
    throw new Error("Expected explicit focus handler");
  expect(initialFocus("keyboard")).toBe(false);
  expect(focus).toHaveBeenCalledOnce();
});
it("leaves iOS and Android on the existing shared native overlay", () => {
  const children = <button>Native content</button>;
  expect(NativeProvider({ children })).toBe(children);
});
