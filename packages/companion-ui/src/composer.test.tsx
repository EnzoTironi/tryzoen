import type { ComponentProps, ReactNode } from "react";
import type { TextInput } from "react-native";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { Composer } from "./composer";
import {
  ComposerEditorProvider,
  type ComposerEditorProps,
} from "./composer/editor";
import type { useComposerSheet } from "./references/sheet";

const state = vi.hoisted(() => ({
  input: undefined as ComponentProps<typeof TextInput> | undefined,
  read: vi.fn<() => Promise<string>>(),
}));
vi.mock("react-native", async () => ({
  ...(await vi.importActual<typeof import("react-native")>("react-native-web")),
  TextInput: (props: ComponentProps<typeof TextInput>) => {
    state.input = props;
    return (
      <textarea
        aria-label={props.accessibilityLabel}
        defaultValue={props.value}
      />
    );
  },
}));
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
});

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
