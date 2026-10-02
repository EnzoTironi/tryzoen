import type { ComponentProps, ReactNode } from "react";
import type { Pressable } from "react-native";
import { renderToSourceMarkup as renderToStaticMarkup } from "../../../../tests/helpers/companion-i18n";
import { beforeEach, expect, it, vi } from "vitest";
import ReactionPicker from "./picker";

const state = vi.hoisted(() => ({
  buttons: [] as ComponentProps<typeof Pressable>[],
}));
vi.mock("react-native", async () => ({
  ...(await vi.importActual<typeof import("react-native")>("react-native-web")),
  useWindowDimensions: () => ({
    width: 390,
    height: 844,
    scale: 1,
    fontScale: 1,
  }),
  Pressable: (props: ComponentProps<typeof Pressable>) => {
    state.buttons.push(props);
    return (
      <button aria-label={props.accessibilityLabel}>
        {typeof props.children === "function"
          ? props.children({ pressed: false })
          : props.children}
      </button>
    );
  },
}));
vi.mock("lucide-react-native", () => import("lucide-react"));
vi.mock("../overlay", () => ({
  CompanionOverlay: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
beforeEach(() => {
  state.buttons = [];
});
function render(
  onSelect: NonNullable<ComponentProps<typeof ReactionPicker>["onSelect"]>,
  selected?: string
) {
  return renderToStaticMarkup(
    <ReactionPicker
      anchor={{ x: 64, y: 300, width: 220, height: 70 }}
      outgoing={false}
      selected={selected}
      onSelect={onSelect}
      onClose={vi.fn<() => void>()}
    >
      <span>Responder</span>
    </ReactionPicker>
  );
}
function press(label: string) {
  const button = state.buttons.find(
    (props) => props.accessibilityLabel === label
  );
  if (!button?.onPress) throw new Error("Button missing: " + label);
  Reflect.apply(button.onPress, undefined, []);
}
it("keeps quick reactions, the full catalog entry and contextual content", () => {
  const html = render(vi.fn());
  expect(html).toContain('aria-label="Mais reações"');
  expect(html).toContain('aria-label="React with red heart"');
  expect(html).toContain("Responder");
});
it("removes the selected reaction using the existing null contract", async () => {
  const select = vi
    .fn<NonNullable<ComponentProps<typeof ReactionPicker>["onSelect"]>>()
    .mockResolvedValue();
  render(select, "❤️");
  press("Remove red heart reaction");
  await Promise.resolve();
  expect(select).toHaveBeenCalledExactlyOnceWith(null);
});
it("prevents duplicate submissions before the pending render", async () => {
  let finish: (() => void) | undefined;
  const select = vi.fn<
    NonNullable<ComponentProps<typeof ReactionPicker>["onSelect"]>
  >(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  render(select);
  press("React with red heart");
  press("React with red heart");
  expect(select).toHaveBeenCalledExactlyOnceWith("❤️");
  finish?.();
  await Promise.resolve();
});
it("allows retry after the selection rejects", async () => {
  const select = vi
    .fn<NonNullable<ComponentProps<typeof ReactionPicker>["onSelect"]>>()
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce();
  render(select);
  press("React with red heart");
  await Promise.resolve();
  await Promise.resolve();
  press("React with red heart");
  await Promise.resolve();
  expect(select).toHaveBeenCalledTimes(2);
});
