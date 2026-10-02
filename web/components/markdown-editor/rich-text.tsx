"use client";
import { useI18n } from "@zoen/companion-ui/i18n";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Undo2,
  Redo2,
  MoreHorizontal,
} from "lucide-react";
import {
  MarkdownSourceEditor,
  useDarkAppearance,
  type MarkdownEditorProps,
  type MarkdownEditorHandle,
} from "@zoen/companion-ui";
import {
  documentExtensions,
  documentMarkdown,
  needsSourceEditor,
} from "@zoen/companion-ui/markdown";
import { Button } from "@web/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@web/components/ui/dropdown-menu";
import styles from "./rich-text.module.css";

export default function RichTextEditor({ ref, ...props }: MarkdownEditorProps) {
  const { t, errorText } = useI18n();
  const darkAppearance = useDarkAppearance();
  const editor = useRef<MarkdownEditorHandle>(null);
  const [document, setDocument] = useState({
    text: props.initialMarkdown,
    version: 0,
  });
  const [source, setSource] = useState(() =>
    needsSourceEditor(props.initialMarkdown)
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  useImperativeHandle(
    ref,
    () => ({
      read: async () => {
        if (!editor.current)
          throw new Error("The editor is still loading. Try again.");
        return await editor.current.read();
      },
    }),
    []
  );
  const act = async (action: "source" | "copy" | "download" | "print") => {
    if (busy || !editor.current) return;
    setBusy(true);
    setStatus("");
    try {
      const text = await editor.current.read();
      if (action === "source") {
        if (source && needsSourceEditor(text)) {
          setStatus(
            "This document needs source mode to preserve its formatting and metadata."
          );
          return;
        }
        setDocument((current) => ({ text, version: current.version + 1 }));
        setSource(!source);
      } else if (action === "copy") {
        await navigator.clipboard.writeText(text);
        setStatus(t("Markdown copied."));
      } else if (action === "download") {
        const url = URL.createObjectURL(
          new Blob([text], { type: "text/markdown;charset=utf-8" })
        );
        const link = window.document.createElement("a");
        link.href = url;
        link.download = `${(props.filename ?? "document").replace(/\.md$/i, "")}.md`;
        link.click();
        // Downloads may read their object URL after this event has returned.
        window.setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 60000);
        setStatus(t("Markdown downloaded."));
      } else {
        window.print();
      }
    } catch (error) {
      props.onError(
        error instanceof Error
          ? errorText(error.message)
          : t("The document action failed. Try again.")
      );
    } finally {
      setBusy(false);
    }
  };
  const actions = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={t("Document actions")}
            disabled={busy}
          />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={darkAppearance ? "dark" : undefined}
      >
        {(
          [
            ["source", source ? t("Visual editor") : t("View Markdown source")],
            ["copy", t("Copy Markdown")],
            ["download", t("Download Markdown")],
            ["print", t("Print / save as PDF")],
          ] as const
        ).map(([action, label]) => (
          <DropdownMenuItem
            key={action}
            onClick={() => {
              void act(action);
            }}
          >
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const editorProps = { ...props, initialMarkdown: document.text };
  return (
    <div className={styles.root} data-document-editor>
      {status && <output className={styles.status}>{status}</output>}
      {source ? (
        <>
          <div className={styles.sourceActions}>{actions}</div>
          <MarkdownSourceEditor
            key={document.version}
            ref={editor}
            {...editorProps}
            notice={t("Markdown source")}
          />
        </>
      ) : (
        <VisualEditor
          key={document.version}
          ref={editor}
          {...editorProps}
          actions={actions}
        />
      )}
    </div>
  );
}

function VisualEditor({
  initialMarkdown,
  editable,
  label,
  description,
  actions,
  onChange,
  ref,
}: MarkdownEditorProps & { readonly actions: ReactNode }) {
  const { t } = useI18n();
  const [initial] = useState(() => {
    const content = documentMarkdown.parse(initialMarkdown);
    return { content, canonical: documentMarkdown.serialize(content) };
  });
  const editor = useEditor({
    extensions: documentExtensions,
    content: initial.content,
    immediatelyRender: false,
    editable,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": label,
        "aria-multiline": "true",
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor: current }) => {
      const markdown = documentMarkdown.serialize(current.getJSON());
      onChange(markdown === initial.canonical ? initialMarkdown : markdown);
    },
  });
  useEffect(() => {
    editor?.setEditable(editable, false);
  }, [editor, editable]);
  useImperativeHandle(
    ref,
    () => ({
      read: () => {
        if (!editor)
          return Promise.reject(
            new Error("The editor is still loading. Try again.")
          );
        const markdown = documentMarkdown.serialize(editor.getJSON());
        return Promise.resolve(
          markdown === initial.canonical ? initialMarkdown : markdown
        );
      },
    }),
    [editor, initial.canonical, initialMarkdown]
  );
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            bold: current.isActive("bold"),
            italic: current.isActive("italic"),
            h1: current.isActive("heading", { level: 1 }),
            h2: current.isActive("heading", { level: 2 }),
            h3: current.isActive("heading", { level: 3 }),
            bullet: current.isActive("bulletList"),
            ordered: current.isActive("orderedList"),
            undo: current.can().undo(),
            redo: current.can().redo(),
          }
        : null,
  });
  const commands = [
    {
      label: t("Bold"),
      active: state?.bold,
      icon: <Bold />,
      run: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      label: t("Italic"),
      active: state?.italic,
      icon: <Italic />,
      run: () => editor?.chain().focus().toggleItalic().run(),
    },
    ...([1, 2, 3] as const).map((level) => ({
      label: t("Heading {level}", { level }),
      active: state?.[`h${level}`],
      icon: <>H{level}</>,
      run: () => editor?.chain().focus().toggleHeading({ level }).run(),
    })),
    {
      label: t("Bullet list"),
      active: state?.bullet,
      icon: <List />,
      run: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      label: t("Numbered list"),
      active: state?.ordered,
      icon: <ListOrdered />,
      run: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      label: t("Undo"),
      active: false,
      disabled: !state?.undo,
      icon: <Undo2 />,
      run: () => editor?.chain().focus().undo().run(),
    },
    {
      label: t("Redo"),
      active: false,
      disabled: !state?.redo,
      icon: <Redo2 />,
      run: () => editor?.chain().focus().redo().run(),
    },
  ];
  return (
    <div className={styles.root}>
      <div
        role="toolbar"
        aria-label={t("Text formatting")}
        className={styles.toolbar}
      >
        {commands.map(({ label: name, icon, run, active, ...command }) => (
          <Button
            key={name}
            variant="ghost"
            size="icon-lg"
            aria-label={name}
            title={name}
            aria-pressed={active}
            disabled={!editor || !editable || command.disabled}
            className="aria-pressed:bg-muted"
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              run();
            }}
          >
            {icon}
          </Button>
        ))}
        {actions}
      </div>
      <div className={styles.scroller}>
        <div className={styles.document}>
          {description && <p className={styles.about}>{description}</p>}
          {!editor && <output>{t("Opening editor…")}</output>}
          <EditorContent editor={editor} className={styles.prose} />
        </div>
      </div>
    </div>
  );
}
