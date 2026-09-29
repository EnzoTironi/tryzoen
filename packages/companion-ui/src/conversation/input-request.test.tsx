import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import type { EveDynamicToolPart } from "eve/react";
import { beforeEach, expect, it, vi } from "vitest";
import { InputRequestCard } from "./input-request";
import type { ActionButton } from "../button";

vi.mock("react-native", () => import("react-native-web"));
vi.mock("lucide-react-native", () => ({
  Check: () => null,
  CircleAlert: () => null,
  MessageCircle: () => null,
  ShieldCheck: () => null,
}));
const buttons = vi.hoisted(
  () => new Map<string, ComponentProps<typeof ActionButton>>()
);
vi.mock("../button", () => ({
  ActionButton: (props: ComponentProps<typeof ActionButton>) => {
    buttons.set(props.children, props);
    return <button disabled={props.disabled}>{props.children}</button>;
  },
}));
const question = {
  type: "dynamic-tool",
  toolCallId: "call-review",
  toolName: "creator-review",
  state: "approval-requested",
  input: { id: "preview" },
  approval: { id: "request-review" },
  toolMetadata: {
    eve: {
      kind: "tool-call",
      name: "creator-review",
      inputRequest: {
        requestId: "request-review",
        kind: "question",
        prompt: "Review the preserved source and response.",
        options: [{ id: "useful", label: "Useful for this case" }],
        allowFreeform: true,
      },
    },
  },
} satisfies EveDynamicToolPart;
beforeEach(() => {
  buttons.clear();
});

it("renders the complete pending prompt and a multiline answer field", () => {
  const markup = renderToStaticMarkup(
    <InputRequestCard
      part={question}
      enabled
      onRespond={async () => undefined}
    />
  );
  expect(markup).toContain(question.toolMetadata.eve.inputRequest.prompt);
  expect(markup).toContain("textarea");
  expect(buttons.get("Useful for this case")?.disabled).toBe(false);
});

it.each([
  ["output-available", "Request completed"],
  ["output-denied", "The action was not allowed."],
  ["output-error", "The action failed."],
  ["approval-responded", "Response received"],
  ["input-available", "In progress"],
] as const)(
  "never offers another decision for %s even when response metadata is absent",
  (state, label) => {
    const part: EveDynamicToolPart = {
      ...question,
      state,
      output: {},
      errorText: "Failed",
    };
    const markup = renderToStaticMarkup(
      <InputRequestCard part={part} enabled onRespond={async () => undefined} />
    );
    expect(markup).toContain(label);
    expect(markup).not.toContain("textarea");
    expect(buttons.has("Useful for this case")).toBe(false);
    expect(buttons.has("Send answer")).toBe(false);
    expect(buttons.has("View request")).toBe(true);
    expect(markup).not.toContain("Useful for this case");
  }
);

it("shows an authoritative response without interpreting it as approval", () => {
  const part = {
    ...question,
    toolMetadata: {
      eve: {
        ...question.toolMetadata.eve,
        inputResponse: {
          requestId: "request-review",
          text: "This needs more evidence.",
        },
      },
    },
  };
  const markup = renderToStaticMarkup(
    <InputRequestCard part={part} enabled onRespond={async () => undefined} />
  );
  expect(markup).toContain("This needs more evidence.");
  expect(buttons.has("Send answer")).toBe(false);
});

it("coalesces a double click and submits only the selected request ID", async () => {
  let release: (() => void) | undefined;
  const onRespond = vi.fn<ComponentProps<typeof InputRequestCard>["onRespond"]>(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  renderToStaticMarkup(
    <InputRequestCard part={question} enabled onRespond={onRespond} />
  );
  const press = buttons.get("Useful for this case")?.onPress;
  press?.();
  press?.();
  expect(onRespond).toHaveBeenCalledExactlyOnceWith([
    { requestId: "request-review", optionId: "useful" },
  ]);
  release?.();
  await Promise.resolve();
  press?.();
  expect(onRespond).toHaveBeenCalledTimes(1);
});

it("permits retry after a failed response without an unhandled rejection", async () => {
  const onRespond = vi
    .fn<ComponentProps<typeof InputRequestCard>["onRespond"]>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(undefined);
  renderToStaticMarkup(
    <InputRequestCard part={question} enabled onRespond={onRespond} />
  );
  const press = buttons.get("Useful for this case")?.onPress;
  press?.();
  await Promise.resolve();
  press?.();
  await Promise.resolve();
  expect(onRespond).toHaveBeenCalledTimes(2);
});

it("does not respond while the session is unavailable", () => {
  const onRespond = vi.fn<ComponentProps<typeof InputRequestCard>["onRespond"]>(
    async () => undefined
  );
  renderToStaticMarkup(
    <InputRequestCard part={question} enabled={false} onRespond={onRespond} />
  );
  const button = buttons.get("Useful for this case");
  expect(button?.disabled).toBe(true);
  button?.onPress();
  expect(onRespond).not.toHaveBeenCalled();
});
