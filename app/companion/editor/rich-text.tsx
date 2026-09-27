"use client";
import { useEffect, useImperativeHandle, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { Bold, Italic, List, ListOrdered, Undo2, Redo2 } from "lucide-react";
import {
  MarkdownSourceEditor,
  type MarkdownEditorProps,
} from "@zoen/companion-ui";
import {
  documentExtensions,
  documentMarkdown,
  needsSourceEditor,
} from "@zoen/companion-ui/markdown";
import { Button } from "@web/components/ui/button";
import styles from "./rich-text.module.css";

export default function RichTextEditor(props: MarkdownEditorProps) {
  return needsSourceEditor(props.initialMarkdown) ? (
    <MarkdownSourceEditor {...props} />
  ) : (
    <VisualEditor {...props} />
  );
}

function VisualEditor({
  initialMarkdown,
  editable,
  label,
  description,
  onChange,
  ref,
}: MarkdownEditorProps) {
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
    editor?.setEditable(editable);
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
      label: "Bold",
      active: state?.bold,
      icon: <Bold />,
      run: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      label: "Italic",
      active: state?.italic,
      icon: <Italic />,
      run: () => editor?.chain().focus().toggleItalic().run(),
    },
    ...([1, 2, 3] as const).map((level) => ({
      label: `Heading ${level}`,
      active: state?.[`h${level}`],
      icon: <>H{level}</>,
      run: () => editor?.chain().focus().toggleHeading({ level }).run(),
    })),
    {
      label: "Bullet list",
      active: state?.bullet,
      icon: <List />,
      run: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      active: state?.ordered,
      icon: <ListOrdered />,
      run: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Undo",
      active: false,
      disabled: !state?.undo,
      icon: <Undo2 />,
      run: () => editor?.chain().focus().undo().run(),
    },
    {
      label: "Redo",
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
        aria-label="Text formatting"
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
      </div>
      <div className={styles.scroller}>
        <div className={styles.document}>
          <p className={styles.about}>{description}</p>
          {!editor && <output>Opening editor…</output>}
          <EditorContent editor={editor} className={styles.prose} />
        </div>
      </div>
    </div>
  );
}
