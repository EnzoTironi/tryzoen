import type { ComponentProps, ReactNode } from "react";
import type { TextInput } from "react-native";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StyleSheet } from "react-native";
import { Composer } from "./composer";
import {
  ComposerEditorProvider,
  type ComposerEditorProps,
} from "./composer/editor";
import type { useComposerSheet } from "./references/sheet";

const state = vi.hoisted(() => ({
  input: undefined as ComponentProps<typeof TextInput> | undefined,
  read: vi.fn<() => Promise<string>>(),
  field: undefined as ComponentProps<
    typeof import("react-native").View
  >["style"],
  preferences: {
    reduceMotion: false,
    reduceTransparency: false,
    increasedContrast: false,
    forcedColors: false,
  },
  dark: false,
  platform: "web",
  blur: true,
}));
vi.mock("react-native", async () => {
  const native =
    await vi.importActual<typeof import("react-native")>("react-native-web");
  return {
    ...native,
    Platform: {
      ...native.Platform,
      get OS() {
        return state.platform;
      },
    },
    useColorScheme: () => (state.dark ? "dark" : "light"),
    View: (props: ComponentProps<typeof import("react-native").View>) => {
      const style = native.StyleSheet.flatten(props.style);
      if (
        props.style &&
        style.flex === 1 &&
        style.flexDirection === "row" &&
        style.alignItems === "flex-end"
      )
        state.field = props.style;
      return <native.View {...props} />;
    },
    TextInput: (props: ComponentProps<typeof TextInput>) => {
      state.input = props;
      return (
        <textarea
          aria-label={props.accessibilityLabel}
          defaultValue={props.value}
        />
      );
    },
  };
});
vi.mock("lucide-react-native", () => import("lucide-react"));
vi.mock("./recording/composer", () => ({ AudioMessageRecorder: () => null }));
vi.mock("./references/sheet", () => ({
  useComposerSheet: ({ change }: Parameters<typeof useComposerSheet>[0]) => ({
    content: null,
    source: undefined,
    changeText: change,
    key: () => false,
    open: vi.fn<ReturnType<typeof useComposerSheet>["open"]>(),
    setCaret: vi.fn<ReturnType<typeof useComposerSheet>["setCaret"]>(),
    selection: undefined,
  }),
}));

vi.mock("./theme", async (original) => ({
  ...(await original<typeof import("./theme")>()),
  useAccessibilityPreferences: () => state.preferences,
}));
function render(
  onSend: ComponentProps<typeof Composer>["onSend"],
  sendStatus?: "sending"
) {
  return renderToStaticMarkup(
    <Composer
      initialDraft={{ text: "Hello", files: [] }}
      onSend={onSend}
      attachments={false}
      sendStatus={sendStatus}
    />
  );
}
function enter(extra: Record<string, unknown> = {}) {
  const preventDefault = vi.fn<() => void>();
  const event = { nativeEvent: { key: "Enter", ...extra }, preventDefault };
  if (state.input?.onKeyPress)
    Reflect.apply(state.input.onKeyPress, undefined, [event]);
  return preventDefault;
}
beforeEach(() => {
  vi.clearAllMocks();
  state.input = undefined;
  state.field = undefined;
  state.dark = false;
  state.platform = "web";
  state.blur = true;
  state.preferences = {
    reduceMotion: false,
    reduceTransparency: false,
    increasedContrast: false,
    forcedColors: false,
  };
  vi.stubGlobal("CSS", { supports: () => state.blur });
});
afterEach(() => vi.unstubAllGlobals());

it.each([
  { isComposing: true },
  { keyCode: 229 },
  { shiftKey: true },
  { altKey: true },
  { ctrlKey: true },
  { metaKey: true },
])("preserves composition or modified Return without sending: %j", (extra) => {
  const send = vi.fn<ComponentProps<typeof Composer>["onSend"]>();
  render(send);
  expect(enter(extra)).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
it("sends plain Return once while the delivery promise remains pending", async () => {
  let finish: (() => void) | undefined;
  const send = vi.fn<ComponentProps<typeof Composer>["onSend"]>(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  render(send);
  expect(enter()).toHaveBeenCalledOnce();
  enter();
  expect(send).toHaveBeenCalledExactlyOnceWith({ text: "Hello", files: [] });
  finish?.();
  await Promise.resolve();
});
it("permits retry with the original draft after delivery rejects", async () => {
  const send = vi
    .fn<ComponentProps<typeof Composer>["onSend"]>()
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce();
  render(send);
  enter();
  await Promise.resolve();
  await Promise.resolve();
  enter();
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenLastCalledWith({ text: "Hello", files: [] });
  await Promise.resolve();
});
it("keeps the field editable during delivery without enabling a duplicate send", () => {
  const html = render(
    vi.fn<ComponentProps<typeof Composer>["onSend"]>(),
    "sending"
  );
  expect(state.input?.editable).toBe(true);
  expect(html).toContain('aria-label="Send message"');
  expect(html).toContain('aria-disabled="true"');
});
it("does not send an empty document read from the rich editor", async () => {
  state.read.mockResolvedValue("");
  const Editor = vi.fn<(props: ComposerEditorProps) => ReactNode>((props) => (
    <span>{props.value}</span>
  ));
  const send = vi.fn<ComponentProps<typeof Composer>["onSend"]>();
  renderToStaticMarkup(
    <ComposerEditorProvider value={{ Input: Editor }}>
      <Composer
        initialDraft={{ text: "Hello", files: [] }}
        attachments={false}
        onSend={send}
      />
    </ComposerEditorProvider>
  );
  const call = Editor.mock.calls.at(0);
  if (!call) throw new Error("The editor adapter did not render");
  const props = call[0];
  const handle = { focus: vi.fn<() => void>(), read: state.read };
  if (typeof props.ref === "function") props.ref(handle);
  else if (props.ref) props.ref.current = handle;
  props.onSubmit();
  await Promise.resolve();
  expect(state.read).toHaveBeenCalledOnce();
  expect(send).not.toHaveBeenCalled();
});

function material() {
  const style = StyleSheet.flatten(state.field);
  expect(state.field).toBeDefined();
  return style;
}
const send = () => vi.fn<ComponentProps<typeof Composer>["onSend"]>();
it("keeps transparency independent of reduced motion and preserves field geometry", () => {
  render(send());
  const normal = material();
  state.preferences.reduceMotion = true;
  render(send());
  expect(material()).toEqual(normal);
  state.preferences.reduceTransparency = true;
  render(send());
  expect(material()).toMatchObject({
    backgroundColor: "#ffffff",
    borderColor: "#d1d1d6",
    backdropFilter: "none",
  });
  for (const key of [
    "minHeight",
    "paddingVertical",
    "paddingLeft",
    "paddingRight",
    "borderWidth",
    "borderRadius",
  ] as const)
    expect(material()[key]).toBe(normal[key]);
});
it.each(["increasedContrast", "forcedColors"] as const)(
  "makes the field opaque with a defined border for %s",
  (preference) => {
    state.preferences[preference] = true;
    state.dark = true;
    render(send());
    expect(material()).toMatchObject({
      backgroundColor: "#1c1c1e",
      borderColor: "#f5f5f7",
      backdropFilter: "none",
    });
    expect(state.input?.placeholderTextColor).toBe("#f5f5f7");
  }
);
it.each(["ios", "android", "web"])(
  "uses an opaque fallback when blur is unavailable on %s",
  (platform) => {
    state.platform = platform;
    state.blur = false;
    render(send());
    expect(material()).toMatchObject({ backgroundColor: "#ffffff" });
    expect(material()).not.toMatchObject({
      backdropFilter: "blur(20px) saturate(180%)",
    });
  }
);
function rgb(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^#[\da-f]{6}(?:[\da-f]{2})?$/iu.test(value)
  )
    throw new Error("Unexpected material color");
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
    value.length === 9 ? Number.parseInt(value.slice(7, 9), 16) / 255 : 1,
  ];
}
function contrast(foreground: unknown, background: unknown, backdrop: number) {
  const [r = 0, g = 0, b = 0, alpha = 1] = rgb(background);
  const values = [
    rgb(foreground).slice(0, 3),
    [r, g, b].map((channel) => channel * alpha + backdrop * (1 - alpha)),
  ];
  const light = values.map((channels) =>
    channels
      .map((channel) => {
        const s = channel / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      })
      .reduce(
        (sum, channel, index) =>
          sum + channel * ([0.2126, 0.7152, 0.0722][index] ?? 0),
        0
      )
  );
  return (Math.max(...light) + 0.05) / (Math.min(...light) + 0.05);
}
it.each([false, true])(
  "keeps field text and placeholder readable over bright and dark media, dark %s",
  (dark) => {
    state.dark = dark;
    render(send());
    const input = StyleSheet.flatten(state.input?.style);
    for (const backdrop of [0, 255]) {
      expect(
        contrast(input.color, material().backgroundColor, backdrop)
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(
          state.input?.placeholderTextColor,
          material().backgroundColor,
          backdrop
        )
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
);
