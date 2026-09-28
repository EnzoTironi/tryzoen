import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AudioMessageRecorder } from "./composer";
const mocks = vi.hoisted(() => ({
  phase: "recording",
  controller: new AbortController(),
  stateIndex: 0,
  refIndex: 0,
  effects: [] as (() => (() => void) | undefined)[],
  updates: new Map<number, unknown[]>(),
  attach: undefined as (() => void) | undefined,
  onAttach: vi.fn<(file: unknown) => void>(),
  onActive: vi.fn<(active: boolean) => void>(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: () => {
    const index = mocks.stateIndex++;
    const values = [
      mocks.phase,
      {
        type: "file",
        mediaType: "audio/webm",
        url: "data:audio/webm;base64,dm9pY2U=",
      },
      undefined,
      0,
    ];
    return [
      values[index],
      (value: unknown) => {
        mocks.updates.set(index, [...(mocks.updates.get(index) ?? []), value]);
      },
    ];
  },
  useRef: () => ({
    current: mocks.refIndex++ === 0 ? mocks.controller : undefined,
  }),
  useEffect: (effect: () => (() => void) | undefined) => {
    mocks.effects.push(effect);
  },
  useImperativeHandle: () => undefined,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  ActivityIndicator: () => <span>Loading</span>,
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("lucide-react-native", () => ({
  Square: () => null,
  Trash2: () => null,
}));
vi.mock("../icon-button", () => ({
  IconButton: ({ label }: { label: string }) => <button>{label}</button>,
}));
vi.mock("../button", () => ({
  ActionButton: ({
    children,
    onPress,
  }: {
    children: ReactNode;
    onPress: () => void;
  }) => {
    mocks.attach = onPress;
    return <button>{children}</button>;
  },
}));
vi.mock("../attachments/provider", () => ({
  useAttachments: () => ({
    startAudioRecording: vi.fn<() => Promise<unknown>>(),
    renderMedia: () => <span>Audio preview</span>,
  }),
}));
function render(disabled = false) {
  return renderToStaticMarkup(
    <AudioMessageRecorder
      triggerRef={{ current: null }}
      disabled={disabled}
      maxBytes={1000}
      onAttach={mocks.onAttach}
      onActive={mocks.onActive}
    />
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.onAttach.mockReset();
  mocks.controller = new AbortController();
  mocks.phase = "recording";
  mocks.stateIndex = 0;
  mocks.refIndex = 0;
  mocks.effects = [];
  mocks.updates.clear();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
test.each(["recording", "permission", "review"])(
  "becoming disabled discards %s and releases the composer without attaching",
  (phase) => {
    mocks.phase = phase;
    render(true);
    for (const effect of mocks.effects) effect();
    expect(mocks.controller.signal.aborted).toBe(true);
    expect(mocks.onActive).toHaveBeenCalledWith(false);
    expect(mocks.updates.get(0)).toContain("idle");
    expect(mocks.onAttach).not.toHaveBeenCalled();
  }
);
test("review never attaches by itself and requires the explicit attach action", () => {
  mocks.phase = "review";
  expect(render()).toContain("Audio preview");
  expect(mocks.onAttach).not.toHaveBeenCalled();
  mocks.attach?.();
  expect(mocks.onAttach).toHaveBeenCalledOnce();
  expect(mocks.onActive).toHaveBeenCalledWith(false);
});
test("an attachment-limit failure preserves local review and displays the error", () => {
  mocks.phase = "review";
  mocks.onAttach.mockImplementation(() => {
    throw new Error("Attachment limit reached");
  });
  render();
  expect(() => mocks.attach?.()).not.toThrow();
  expect(mocks.updates.get(2)).toContain("Attachment limit reached");
  expect(mocks.controller.signal.aborted).toBe(false);
  expect(mocks.onActive).not.toHaveBeenCalled();
});
