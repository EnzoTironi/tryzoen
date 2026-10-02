import type { ComponentProps } from "react";
import { renderToSourceMarkup as renderToStaticMarkup } from "../../../tests/helpers/companion-i18n";
import { beforeEach, expect, it, vi } from "vitest";
import {
  CompanionOverlay,
  CompanionOverlayProvider,
  type CompanionOverlayProps,
} from "./overlay";

const state = vi.hoisted(() => ({
  width: 390,
  reads: 0,
  preferences: {
    reduceMotion: false,
    reduceTransparency: false,
    increasedContrast: false,
    forcedColors: false,
  },
  modal: undefined as
    | ComponentProps<typeof import("react-native").Modal>
    | undefined,
}));
vi.mock("react-native", () => ({
  useWindowDimensions: () => ({
    width: state.width,
    height: 844,
    scale: 1,
    fontScale: 1,
  }),
  Modal: (props: ComponentProps<typeof import("react-native").Modal>) => {
    state.modal = props;
    return (
      <section aria-label={props.accessibilityLabel}>{props.children}</section>
    );
  },
}));
vi.mock("./theme", () => ({
  useAccessibilityPreferences: () => {
    state.reads++;
    return state.preferences;
  },
}));
beforeEach(() => {
  state.width = 390;
  state.reads = 0;
  state.preferences = {
    reduceMotion: false,
    reduceTransparency: false,
    increasedContrast: false,
    forcedColors: false,
  };
  state.modal = undefined;
});
function render(props: Partial<CompanionOverlayProps> = {}) {
  return renderToStaticMarkup(
    <CompanionOverlay
      title="Documento"
      onClose={vi.fn<() => void>()}
      {...props}
    >
      <textarea defaultValue="Rascunho" />
    </CompanionOverlay>
  );
}
it.each([
  { width: 390, animation: "slide" },
  { width: 1000, animation: "fade" },
])(
  "keeps normal platform transitions at width $width",
  ({ width, animation }) => {
    state.width = width;
    expect(render()).toContain('aria-label="Documento"');
    expect(state.modal?.transparent).toBe(true);
    expect(state.modal?.animationType).toBe(animation);
  }
);
it.each([390, 1000])(
  "drops only animation when reduced motion changes at width %s",
  (width) => {
    state.width = width;
    const close = vi.fn<() => void>(),
      focus = vi.fn<() => void>();
    render({ onClose: close, focusOnOpen: focus });
    state.preferences.reduceMotion = true;
    expect(render({ onClose: close, focusOnOpen: focus })).toContain(
      "Rascunho"
    );
    expect(state.modal?.animationType).toBe("none");
    expect(state.modal?.transparent).toBe(true);
    expect(state.modal?.onRequestClose).toBe(close);
    expect(state.modal?.onShow).toBe(focus);
    state.preferences.reduceMotion = false;
    render({ onClose: close, focusOnOpen: focus });
    expect(state.modal?.animationType).toBe(width < 720 ? "slide" : "fade");
    expect(close).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  }
);
it.each(["reduceTransparency", "increasedContrast", "forcedColors"] as const)(
  "does not change modal composition or transition for independent %s",
  (preference) => {
    state.preferences[preference] = true;
    render();
    expect(state.modal?.animationType).toBe("slide");
    expect(state.modal?.transparent).toBe(true);
  }
);
it("delegates close to the editor owner so unsaved changes can veto dismissal", () => {
  let dirty = true,
    closed = false;
  const close = vi.fn<() => void>(() => {
    if (!dirty) closed = true;
  });
  render({ onClose: close });
  expect(state.modal?.onRequestClose).toBe(close);
  close();
  expect(closed).toBe(false);
  state.preferences.reduceMotion = true;
  render({ title: "Histórico", onClose: close });
  expect(state.modal?.accessibilityLabel).toBe("Histórico");
  expect(state.modal?.onRequestClose).toBe(close);
  dirty = false;
  close();
  expect(closed).toBe(true);
});
it("leaves overridden web/native renderers and focus ownership untouched", () => {
  const props: CompanionOverlayProps = {
    title: "Histórico",
    children: <button>Fechar</button>,
    onClose: vi.fn<() => void>(),
    focusOnOpen: vi.fn<() => void>(),
  };
  const renderer = vi.fn<(props: CompanionOverlayProps) => React.ReactNode>(
    (value) => <dialog aria-label={value.title}>{value.children}</dialog>
  );
  const html = renderToStaticMarkup(
    <CompanionOverlayProvider renderOverlay={renderer}>
      <CompanionOverlay {...props} />
    </CompanionOverlayProvider>
  );
  expect(html).toContain('aria-label="Histórico"');
  expect(renderer).toHaveBeenCalledExactlyOnceWith(props);
  expect(state.modal).toBeUndefined();
  expect(state.reads).toBe(0);
});
