import { renderToSourceMarkup as renderToStaticMarkup } from "../../../../tests/helpers/companion-i18n";
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

const mailApproval = {
  ...question,
  toolName: "gmail-send",
  input: {
    to: ["recipient@example.invalid"],
    cc: ["copy@example.invalid"],
    bcc: ["hidden@example.invalid"],
    subject: "Exact subject",
    body: "Complete outgoing body with consequential details.",
    inReplyTo: "<original@example.invalid>",
    threadId: "original-thread",
    approvalMessage: "A harmless supplementary summary.",
  },
  toolMetadata: {
    eve: {
      kind: "tool-call",
      name: "gmail-send",
      inputRequest: {
        requestId: "request-mail",
        kind: "tool-approval",
        prompt: "Approve gmail-send?",
        options: [
          { id: "approve", label: "Approve" },
          { id: "cancel", label: "Cancel", style: "danger" },
        ],
        allowFreeform: true,
      },
    },
  },
} satisfies EveDynamicToolPart;

it("discloses the stored Gmail recipients, full body and reply context before approval", () => {
  const markup = renderToStaticMarkup(
    <InputRequestCard
      part={mailApproval}
      enabled
      onRespond={async () => undefined}
    />
  );
  for (const detail of [
    ...mailApproval.input.to,
    ...mailApproval.input.cc,
    ...mailApproval.input.bcc,
    mailApproval.input.subject,
    mailApproval.input.body,
    "original@example.invalid",
    mailApproval.input.threadId,
    mailApproval.input.approvalMessage,
  ])
    expect(markup).toContain(detail);
  expect(buttons.get("Approve")?.disabled).toBe(false);
  expect(markup).not.toContain("textarea");
  expect(buttons.has("Send answer")).toBe(false);
});

it("discloses the frozen network recipient, workspace and revision", () => {
  const input = {
    username: "destination",
    destination: {
      botId: "10000000-0000-4000-8000-000000000001",
      workspaceId: "synthetic-destination-workspace",
      revision: "a".repeat(64),
    },
    text: "Complete network message.",
  };
  const part: EveDynamicToolPart = {
    ...mailApproval,
    toolName: "network-contact",
    input,
  };
  const markup = renderToStaticMarkup(
    <InputRequestCard part={part} enabled onRespond={async () => undefined} />
  );
  for (const detail of [
    input.username,
    input.destination.botId,
    input.destination.workspaceId,
    input.destination.revision,
    input.text,
  ])
    expect(markup).toContain(detail);
  expect(buttons.get("Approve")?.disabled).toBe(false);
});

it.each([
  ["missing recipients", { ...mailApproval.input, to: [] }],
  ["invalid recipient", { ...mailApproval.input, bcc: ["not-an-email"] }],
  [
    "header injection",
    { ...mailApproval.input, subject: "Hi\r\nBcc: hidden@example.invalid" },
  ],
  ["oversize body", { ...mailApproval.input, body: "x".repeat(17_000) }],
  [
    "oversize summary",
    { ...mailApproval.input, approvalMessage: "x".repeat(17_000) },
  ],
  ["malformed text", { ...mailApproval.input, body: "bad\ud800" }],
  ["missing stored input", undefined],
])(
  "blocks invalid Gmail approval (%s) while permitting the exact native cancellation",
  async (_name, input) => {
    const onRespond = vi.fn<
      ComponentProps<typeof InputRequestCard>["onRespond"]
    >(async () => undefined);
    const markup = renderToStaticMarkup(
      <InputRequestCard
        part={{ ...mailApproval, input }}
        enabled
        onRespond={onRespond}
      />
    );
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain("textarea");
    expect(buttons.get("Approve")?.disabled).toBe(true);
    buttons.get("Approve")?.onPress();
    expect(onRespond).not.toHaveBeenCalled();
    expect(buttons.get("Cancel")?.disabled).toBe(false);
    buttons.get("Cancel")?.onPress();
    expect(onRespond).toHaveBeenCalledExactlyOnceWith([
      { requestId: "request-mail", optionId: "cancel" },
    ]);
    await Promise.resolve();
  }
);

it("blocks approval of a network request without the frozen destination", () => {
  const onRespond = vi.fn<ComponentProps<typeof InputRequestCard>["onRespond"]>(
    async () => undefined
  );
  renderToStaticMarkup(
    <InputRequestCard
      part={{
        ...mailApproval,
        toolName: "network-contact",
        input: { username: "destination", text: "Message" },
      }}
      enabled
      onRespond={onRespond}
    />
  );
  expect(buttons.get("Approve")?.disabled).toBe(true);
  buttons.get("Approve")?.onPress();
  expect(onRespond).not.toHaveBeenCalled();
});

it("distinguishes unsupported tools from invalid Gmail or network payloads", () => {
  const markup = renderToStaticMarkup(
    <InputRequestCard
      part={{
        ...mailApproval,
        toolName: "other-action",
        input: { description: "Unknown action" },
      }}
      enabled
      onRespond={async () => undefined}
    />
  );
  expect(markup).toContain(
    "Exact action details are unavailable for this tool."
  );
  expect(markup).toContain(mailApproval.toolMetadata.eve.inputRequest.prompt);
  expect(markup).not.toContain('role="alert"');
});
