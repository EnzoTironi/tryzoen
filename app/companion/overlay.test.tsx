import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWebCompanionOverlay } from "./overlay";

type RootProps = ComponentProps<
  typeof import("@web/components/ui/dialog").Dialog
>;
type PopupProps = ComponentProps<
  typeof import("@web/components/ui/dialog").DialogContent
>;
const state = vi.hoisted(() => ({
  root: undefined as RootProps | undefined,
  popup: undefined as PopupProps | undefined,
}));
// These test the adapter contract. Real Base UI focus/isolation is checked in browser QA.
vi.mock("@web/components/ui/dialog", () => ({
  Dialog: (props: RootProps) => {
    state.root = props;
    return typeof props.children === "function"
      ? props.children({ payload: undefined })
      : props.children;
  },
  DialogContent: (props: PopupProps) => {
    state.popup = props;
    return (
      <dialog
        open
        aria-modal={props["aria-modal"]}
        aria-labelledby="overlay-title"
      >
        {props.children}
      </dialog>
    );
  },
  DialogTitle: (
    props: ComponentProps<
      typeof import("@web/components/ui/dialog").DialogTitle
    >
  ) => <h2 id="overlay-title">{props.children}</h2>,
}));
beforeEach(() => {
  state.root = undefined;
  state.popup = undefined;
});
function render(
  props: Partial<Parameters<typeof renderWebCompanionOverlay>[0]> = {}
) {
  return renderToStaticMarkup(
    renderWebCompanionOverlay({
      title: "Análise da conversa",
      onClose: vi.fn<() => void>(),
      children: (
        <textarea
          aria-label="Texto em edição"
          defaultValue="Rascunho preservado"
        />
      ),
      ...props,
    })
  );
}
it("declares both real modal behavior and modal semantics without replacing title/content", () => {
  const html = render();
  expect(state.root).toMatchObject({ open: true, modal: true });
  expect(html).toContain(
    '<dialog open="" aria-modal="true" aria-labelledby="overlay-title"'
  );
  expect(html).toContain('id="overlay-title">Análise da conversa');
  expect(html).toContain('aria-label="Texto em edição">Rascunho preservado');
  expect(state.popup).toMatchObject({
    animated: false,
    showCloseButton: false,
  });
  expect(state.popup?.["aria-describedby"]).toBeUndefined();
});
it("forwards close requests and preserves the consumer's discard veto", () => {
  const discard = vi.fn<() => boolean>().mockReturnValue(false);
  let retained = true;
  const onClose = vi.fn<() => void>(() => {
    if (discard()) retained = false;
  });
  render({ onClose });
  const details: Parameters<NonNullable<RootProps["onOpenChange"]>>[1] = {
    reason: "none",
    event: new Event("close"),
    cancel: vi.fn<() => void>(),
    allowPropagation: vi.fn<() => void>(),
    isCanceled: false,
    isPropagationAllowed: false,
    trigger: undefined,
    preventUnmountOnClose: vi.fn<() => void>(),
  };
  state.root?.onOpenChange?.(true, details);
  expect(onClose).not.toHaveBeenCalled();
  state.root?.onOpenChange?.(false, details);
  expect(onClose).toHaveBeenCalledOnce();
  expect(retained).toBe(true);
  expect(state.root?.open).toBe(true);
  discard.mockReturnValue(true);
  state.root?.onOpenChange?.(false, details);
  expect(onClose).toHaveBeenCalledTimes(2);
  expect(retained).toBe(false);
});
it("keeps imperative initial focus under Base UI's opening lifecycle", () => {
  const focusOnOpen = vi.fn<() => void>();
  render({ focusOnOpen });
  expect(focusOnOpen).not.toHaveBeenCalled();
  const initialFocus = state.popup?.initialFocus;
  if (typeof initialFocus !== "function")
    throw new Error("The focus callback was lost");
  expect(initialFocus("keyboard")).toBe(false);
  expect(focusOnOpen).toHaveBeenCalledOnce();
});
it("uses the primitive's default focus handling when no callback is supplied", () => {
  render();
  expect(state.popup?.initialFocus).toBeUndefined();
});
