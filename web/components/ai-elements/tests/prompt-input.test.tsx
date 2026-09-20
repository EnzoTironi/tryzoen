import {
  createElement,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";
import { renderToEnglishMarkup as renderToStaticMarkup } from "@tests/helpers/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const submission = vi.hoisted(() => ({
  handler: undefined as unknown,
  capture:
    vi.fn<(controller: ReturnType<typeof usePromptInputController>) => void>(),
}));

vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("react/jsx-dev-runtime")>();
  return {
    ...original,
    jsxDEV: (...args: Parameters<typeof original.jsxDEV>) => {
      const [type, props] = args;
      if (
        type === "form" &&
        props !== null &&
        typeof props === "object" &&
        "onSubmit" in props
      )
        submission.handler = props.onSubmit;
      return original.jsxDEV(...args);
    },
  };
});

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  submission.capture.mockClear();
  submission.handler = undefined;
});

vi.mock("motion/react", () => {
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- Vitest hoists mock factories above module-scope component values.
  const MotionDiv = ({
    layout,
    transition: _transition,
    ...props
  }: ComponentProps<"div"> & {
    layout?: boolean | string;
    transition?: unknown;
  }) => (
    <div
      data-motion-element="div"
      data-motion-layout={layout === undefined ? undefined : String(layout)}
      {...props}
    />
  );
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- Vitest hoists mock factories above module-scope component values.
  const MotionSpan = ({
    layout,
    transition: _transition,
    ...props
  }: ComponentProps<"span"> & {
    layout?: boolean | string;
    transition?: unknown;
  }) => (
    <span
      data-motion-element="span"
      data-motion-layout={layout === undefined ? undefined : String(layout)}
      {...props}
    />
  );

  return {
    LazyMotion: ({ children }: { children: ReactNode }) => children,
    domMax: {},
    m: {
      create:
        (component: ComponentType<ComponentProps<"div">>) =>
        ({
          layout: _layout,
          transition: _transition,
          ...props
        }: ComponentProps<"div"> & {
          layout?: boolean | string;
          transition?: unknown;
        }) =>
          createElement(component, props),
      div: MotionDiv,
      span: MotionSpan,
    },
    useReducedMotion: () => false,
  };
});
import {
  PromptInput,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputProps,
  usePromptInputController,
} from "@web/components/ai-elements/prompt-input";

function CaptureController() {
  submission.capture(usePromptInputController());
  return null;
}

function submit(form: { reset: () => void }) {
  if (typeof submission.handler !== "function")
    throw new Error("The composer has no submit handler.");
  Reflect.apply(submission.handler, undefined, [
    {
      currentTarget: form,
      preventDefault: vi.fn<() => void>(),
    },
  ]);
}

describe("prompt input", () => {
  it("keeps a rejected draft available after the server refuses submission", async () => {
    const send = vi
      .fn<PromptInputProps["onSubmit"]>()
      .mockRejectedValue(new Error("session_not_ready"));
    const form = { value: "Keep my draft", reset: vi.fn<() => void>() };
    vi.stubGlobal(
      "FormData",
      class {
        get() {
          return form.value;
        }
      }
    );
    renderToStaticMarkup(<PromptInput onSubmit={send} />);
    submit(form);
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        { text: "Keep my draft", files: [] },
        expect.anything()
      );
    });
    expect(form.reset).not.toHaveBeenCalled();
  });

  it.each([
    { edited: false, provider: false },
    { edited: true, provider: false },
    { edited: false, provider: true },
    { edited: true, provider: true },
  ])(
    "clears only the submitted draft (edited: $edited, provider: $provider)",
    async ({ edited, provider }) => {
      const completion = Promise.withResolvers<void>();
      const send = vi.fn<PromptInputProps["onSubmit"]>(
        () => completion.promise
      );
      const form = { value: "Original draft", reset: vi.fn<() => void>() };
      vi.stubGlobal(
        "FormData",
        class {
          get() {
            return form.value;
          }
        }
      );
      renderToStaticMarkup(
        provider ? (
          <PromptInputProvider initialInput="Original draft">
            <PromptInput onSubmit={send}>
              <CaptureController />
            </PromptInput>
          </PromptInputProvider>
        ) : (
          <PromptInput onSubmit={send} />
        )
      );
      const controller = submission.capture.mock.calls[0]?.[0];
      const clear = controller
        ? vi.spyOn(controller.textInput, "clear")
        : form.reset;
      submit(form);
      await vi.waitFor(() => {
        expect(send).toHaveBeenCalledTimes(1);
      });
      expect(clear).not.toHaveBeenCalled();
      if (edited) form.value = "My next draft";
      completion.resolve();
      await completion.promise;
      await vi.waitFor(() => {
        expect(clear).toHaveBeenCalledTimes(edited ? 0 : 1);
      });
      expect(form.value).toBe(edited ? "My next draft" : "Original draft");
    }
  );

  it("anchors the compact submit button without dropping footer children", () => {
    const markup = renderToStaticMarkup(
      <PromptInput compact onSubmit={() => undefined}>
        <PromptInputFooter>
          <span>Composer tools</span>
          <PromptInputSubmit />
        </PromptInputFooter>
      </PromptInput>
    );

    expect(markup).toContain("Composer tools");
    expect(markup).toContain('aria-label="Submit"');
    expect(markup).toContain("absolute");
    expect(markup).toContain("right-1.5");
    expect(markup).toContain("bottom-1.5");
  });

  it("leaves non-compact submit buttons in normal flow", () => {
    const markup = renderToStaticMarkup(<PromptInputSubmit />);

    expect(markup).toContain('aria-label="Submit"');
    expect(markup).not.toContain("absolute");
  });

  it("adds scale correction around compact textareas only", () => {
    const compactMarkup = renderToStaticMarkup(
      <PromptInput compact onSubmit={() => undefined}>
        <PromptInputTextarea placeholder="Compact placeholder" />
      </PromptInput>
    );
    const regularMarkup = renderToStaticMarkup(
      <PromptInput onSubmit={() => undefined}>
        <PromptInputTextarea placeholder="Regular placeholder" />
      </PromptInput>
    );

    expect(compactMarkup).toContain(
      'data-motion-element="div" data-motion-layout="position"'
    );
    expect(regularMarkup).not.toContain('data-motion-element="div"');
  });
});
