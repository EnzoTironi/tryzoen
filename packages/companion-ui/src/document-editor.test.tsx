import type { ComponentProps, ReactNode, Ref } from "react";
import { renderToSourceMarkup as renderToStaticMarkup } from "../../../tests/helpers/companion-i18n";
import { beforeEach, expect, it, vi } from "vitest";
import { DocumentEditor } from "./document-editor";
import {
  MarkdownEditorProvider,
  type MarkdownEditorHandle,
  type MarkdownEditorProps,
} from "./markdown-editor";
import type { ActionButton } from "./button";

vi.mock("react-native", () => import("react-native-web"));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useImperativeHandle: (
    ref: Ref<MarkdownEditorHandle>,
    create: () => MarkdownEditorHandle
  ) => {
    if (typeof ref === "object" && ref) ref.current = create();
  },
}));
vi.mock("./overlay", () => ({
  CompanionOverlay: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
const buttons = vi.hoisted(
  () => new Map<string, ComponentProps<typeof ActionButton>>()
);
vi.mock("./button", () => ({
  ActionButton: (props: ComponentProps<typeof ActionButton>) => {
    buttons.set(props.children, props);
    return <button disabled={props.disabled}>{props.children}</button>;
  },
}));

beforeEach(() => {
  buttons.clear();
});

it("saves the visual editor's current Markdown instead of the initial snapshot", async () => {
  const save = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const close = vi.fn<() => void>();
  renderToStaticMarkup(
    <MarkdownEditorProvider
      value={(props) => {
        if (typeof props.ref === "object" && props.ref)
          props.ref.current = {
            read: async () => "## Revised\n\n**Keep this formatting.**",
          };
        return <div>Visual editor</div>;
      }}
    >
      <DocumentEditor
        markdown
        allowUnchanged
        title="Notes.md"
        label="Notes"
        description="Private notes"
        initialText="Original"
        maxLength={1000}
        onSave={save}
        onClose={close}
      />
    </MarkdownEditorProvider>
  );
  buttons.get("Save")?.onPress();
  await vi.waitFor(() => {
    expect(close).toHaveBeenCalledOnce();
  });
  expect(save).toHaveBeenCalledExactlyOnceWith(
    "## Revised\n\n**Keep this formatting.**"
  );
});

it.each([true, false])(
  "keeps source text exact in the unified shell without a provider (markdown=%s)",
  async (markdown) => {
    const save = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const close = vi.fn<() => void>();
    const content = '  <section>raw</section>\n\nkey = "**literal**"\n';
    const html = renderToStaticMarkup(
      <DocumentEditor
        markdown={markdown}
        allowUnchanged
        title="Document"
        label="Content"
        description="Private document"
        initialText={content}
        maxLength={1000}
        onSave={save}
        onClose={close}
      />
    );
    expect(html).toContain('aria-label="Content"');
    expect(buttons.has("Close")).toBe(true);
    buttons.get("Save")?.onPress();
    await vi.waitFor(() => {
      expect(close).toHaveBeenCalledOnce();
    });
    expect(save).toHaveBeenCalledExactlyOnceWith(content);
  }
);

it("rejects oversized source without saving or discarding the document", async () => {
  const save = vi.fn<() => Promise<void>>();
  const close = vi.fn<() => void>();
  renderToStaticMarkup(
    <DocumentEditor
      allowUnchanged
      title="Notes"
      label="Notes"
      description="Private"
      initialText="too long"
      maxLength={3}
      onSave={save}
      onClose={close}
    />
  );
  buttons.get("Save")?.onPress();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(save).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

it("opens historical documents read-only and omits their save action", () => {
  let editor: MarkdownEditorProps | undefined;
  renderToStaticMarkup(
    <MarkdownEditorProvider
      value={(props) => {
        editor = props;
        return null;
      }}
    >
      <DocumentEditor
        markdown
        readOnly
        title="History.md"
        label="Historical notes"
        description="Saved version"
        initialText="Earlier version"
        maxLength={1000}
        onSave={vi.fn<() => Promise<void>>()}
        onClose={vi.fn<() => void>()}
      />
    </MarkdownEditorProvider>
  );
  expect(editor?.editable).toBe(false);
  expect(editor?.initialMarkdown).toBe("Earlier version");
  expect(buttons.has("Save")).toBe(false);
});
