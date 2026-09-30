import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import type {
  MarkdownEditorProps,
  MarkdownSourceEditor,
  useDarkAppearance,
} from "@zoen/companion-ui";
import type { Button } from "@web/components/ui/button";
import type {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@web/components/ui/dialog";
import type {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@web/components/ui/dropdown-menu";
import { beforeEach, expect, test, vi } from "vitest";
import RichTextEditor from "@web/components/markdown-editor/rich-text";
import { FileEditor } from "./file-editor";

const controls = vi.hoisted(() => ({
  darkAppearance: vi.fn<typeof useDarkAppearance>().mockReturnValue(false),
  buttons: [] as ComponentProps<typeof Button>[],
  editorProps: undefined as MarkdownEditorProps | undefined,
  writes: vi.fn<() => Promise<void>>(),
  invalidate: vi.fn<() => Promise<void>>(),
}));
vi.mock("next/dynamic", () => ({
  default: () => (props: MarkdownEditorProps) => {
    controls.editorProps = props;
    return <div aria-label={props.label}>{props.initialMarkdown}</div>;
  },
}));
vi.mock("@web/trpc/client", () => ({
  api: {
    useUtils: () => ({
      workspaces: { history: { invalidate: controls.invalidate } },
    }),
    workspaces: {
      write: {
        useMutation: () => ({ mutateAsync: controls.writes, isPending: false }),
      },
    },
  },
}));
vi.mock("@web/i18n/context", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "pt-br" }),
}));
vi.mock("@web/components/ui/button", () => ({
  Button: (props: ComponentProps<typeof Button>) => {
    controls.buttons.push(props);
    return (
      <button aria-label={props["aria-label"]} disabled={props.disabled}>
        {props.children}
      </button>
    );
  },
}));
vi.mock("@web/components/ui/dialog", () => ({
  Dialog: ({ children }: ComponentProps<typeof Dialog>) => children,
  DialogContent: ({
    children,
    className,
  }: ComponentProps<typeof DialogContent>) => (
    <div
      data-testid="file-panel"
      className={typeof className === "string" ? className : undefined}
    >
      {children}
    </div>
  ),
  DialogTitle: ({ children }: ComponentProps<typeof DialogTitle>) => (
    <h1>{children}</h1>
  ),
}));
vi.mock("./file-history", () => ({ FileHistory: () => null }));
vi.mock("@zoen/companion-ui", () => ({
  useDarkAppearance: controls.darkAppearance,
  MarkdownSourceEditor: (
    props: ComponentProps<typeof MarkdownSourceEditor>
  ) => {
    controls.editorProps = props;
    return <div aria-label={props.label}>{props.initialMarkdown}</div>;
  },
}));
vi.mock("@zoen/companion-ui/markdown", () => ({
  needsSourceEditor: () => true,
}));
vi.mock("@web/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: ComponentProps<typeof DropdownMenu>) => children,
  DropdownMenuTrigger: ({
    children,
  }: ComponentProps<typeof DropdownMenuTrigger>) => children,
  DropdownMenuContent: ({
    children,
    className,
  }: ComponentProps<typeof DropdownMenuContent>) => (
    <div
      data-testid="document-actions-portal"
      className={typeof className === "string" ? className : undefined}
    >
      {children}
    </div>
  ),
  DropdownMenuItem: ({ children }: ComponentProps<typeof DropdownMenuItem>) => (
    <div>{children}</div>
  ),
}));

const original = "# Launch notes\n\nKeep **every** unsaved character.\n";
const onClose = vi.fn<() => void>();
const onSaved = vi.fn<() => Promise<void>>();
const onChange = vi.fn<(value: string) => void>();
const onError = vi.fn<(error: string) => void>();
const onDirty = vi.fn<() => void>();

beforeEach(() => {
  controls.darkAppearance.mockReturnValue(false);
  controls.buttons = [];
  controls.editorProps = undefined;
  vi.clearAllMocks();
});

test.each(["light", "dark", "unspecified"] as const)(
  "uses the existing CSS palette on the file panel for %s appearance",
  (scheme) => {
    controls.darkAppearance.mockReturnValue(scheme === "dark");
    const markup = renderToStaticMarkup(
      <FileEditor
        path="knowledge/launch-notes.md"
        content={original}
        revision="revision-current"
        onClose={onClose}
        onSaved={onSaved}
        readOnly={false}
      />
    );
    const themed = /data-testid="file-panel" class="[^"]*\bdark\b/u.test(
      markup
    );
    expect(themed).toBe(scheme === "dark");
    expect(markup).toContain("launch-notes.md");
    expect(controls.editorProps?.initialMarkdown).toBe(original);
    expect(controls.editorProps?.editable).toBe(true);
    expect(controls.writes).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  }
);

test.each(["light", "dark", "unspecified"] as const)(
  "themes the separately portaled document actions for %s appearance",
  (scheme) => {
    controls.darkAppearance.mockReturnValue(scheme === "dark");
    const markup = renderToStaticMarkup(
      <RichTextEditor
        ref={null}
        filename="launch-notes.md"
        initialMarkdown={original}
        label="Document content"
        description=""
        editable
        onChange={onChange}
        onDirty={onDirty}
        onError={onError}
      />
    );
    const themed =
      /data-testid="document-actions-portal" class="[^"]*\bdark\b/u.test(
        markup
      );
    expect(themed).toBe(scheme === "dark");
    expect(controls.editorProps?.initialMarkdown).toBe(original);
    expect(markup).toContain("Copy Markdown");
    expect(markup).toContain("Download Markdown");
    expect(markup).toContain("Print / save as PDF");
    expect(onChange).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  }
);

test("preserves read-only historical content and disabled writes in dark appearance", () => {
  controls.darkAppearance.mockReturnValue(true);
  renderToStaticMarkup(
    <FileEditor
      path="knowledge/launch-notes.md"
      content={original}
      revision="revision-earlier"
      onClose={onClose}
      onSaved={onSaved}
      readOnly
    />
  );
  expect(controls.editorProps?.initialMarkdown).toBe(original);
  expect(controls.editorProps?.editable).toBe(false);
  expect(
    controls.buttons.find(
      (button) => button["aria-label"] === "Remover arquivo"
    )
  ).toBeUndefined();
  expect(controls.buttons.some((button) => button.disabled)).toBe(true);
  expect(controls.writes).not.toHaveBeenCalled();
});
