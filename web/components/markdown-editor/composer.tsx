"use client";
import { useI18n } from "@zoen/companion-ui/i18n";
import {
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import {
  Bold,
  Italic,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Code,
  Type,
  Link,
} from "lucide-react";
import type { ComposerEditorProps } from "@zoen/companion-ui";
import {
  composerExtensions,
  isSafeWebLink,
  composerMarkdown,
  composerReferenceAt,
  composerReferenceContent,
} from "@zoen/companion-ui/composer";
import { documentMarkdown } from "@zoen/companion-ui/markdown";
import { Button } from "@web/components/ui/button";
import styles from "./composer.module.css";

export default function PromptEditor({ ref, ...props }: ComposerEditorProps) {
  const { t } = useI18n();
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  }, [props]);
  const last = useRef(props.value);
  const [formatting, setFormatting] = useState(false);
  const [link, setLink] = useState<string>();
  const editor = useEditor({
    extensions: composerExtensions,
    content: documentMarkdown.parse(props.value),
    immediatelyRender: false,
    editable: !props.disabled,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": props.label,
        "aria-multiline": "true",
        spellcheck: "true",
        "data-placeholder": props.placeholder,
      },
      handleKeyDown: (view, event) => {
        if (view.composing || event.isComposing || event.shiftKey) return false;
        if (latest.current.onKey(event.key)) return true;
        if (
          event.key === "Enter" &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          latest.current.onSubmit();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => {
      last.current = composerMarkdown(current.getJSON());
      latest.current.onChange(last.current);
      latest.current.onReference(
        composerReferenceAt(current.getJSON(), current.state.selection.from)
      );
    },
    onSelectionUpdate: ({ editor: current }) => {
      latest.current.onReference(
        composerReferenceAt(current.getJSON(), current.state.selection.from)
      );
    },
  });
  useEffect(() => {
    editor?.setEditable(!props.disabled, false);
  }, [editor, props.disabled]);
  useEffect(() => {
    if (editor && props.value !== last.current) {
      last.current = props.value;
      editor.commands.setContent(documentMarkdown.parse(props.value), {
        emitUpdate: false,
      });
      props.onReference(null);
    }
  }, [editor, props]);
  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editor?.commands.focus();
      },
      read: async () => {
        if (!editor) throw new Error("O editor ainda está carregando.");
        return composerMarkdown(editor.getJSON());
      },
      insertText: (text) => {
        editor?.chain().focus().insertContent({ type: "text", text }).run();
      },
      insertReference: (item) => {
        if (!editor) return;
        const token = composerReferenceAt(
          editor.getJSON(),
          editor.state.selection.from
        );
        if (token)
          editor
            .chain()
            .focus()
            .insertContentAt(
              { from: token.start, to: token.end },
              composerReferenceContent(item)
            )
            .run();
      },
    }),
    [editor]
  );
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            bold: current.isActive("bold"),
            italic: current.isActive("italic"),
            strike: current.isActive("strike"),
            bullet: current.isActive("bulletList"),
            ordered: current.isActive("orderedList"),
            quote: current.isActive("blockquote"),
            code: current.isActive("code"),
          }
        : null,
  });
  const commands = [
    {
      label: t("Negrito"),
      Icon: Bold,
      active: state?.bold,
      run: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      label: t("Itálico"),
      Icon: Italic,
      active: state?.italic,
      run: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      label: t("Riscado"),
      Icon: Strikethrough,
      active: state?.strike,
      run: () => editor?.chain().focus().toggleStrike().run(),
    },
    {
      label: t("Lista"),
      Icon: List,
      active: state?.bullet,
      run: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      label: t("Lista numerada"),
      Icon: ListOrdered,
      active: state?.ordered,
      run: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      label: t("Citação"),
      Icon: Quote,
      active: state?.quote,
      run: () => editor?.chain().focus().toggleBlockquote().run(),
    },
    {
      label: t("Inserir link"),
      Icon: Link,
      active: link !== undefined,
      run: () => {
        setLink("");
      },
    },
    {
      label: t("Código"),
      Icon: Code,
      active: state?.code,
      run: () => editor?.chain().focus().toggleCode().run(),
    },
  ];
  return (
    <div className={styles.root}>
      <div className={styles.tools}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("Formatação da mensagem")}
          aria-expanded={formatting}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            setFormatting(!formatting);
          }}
        >
          <Type size={18} />
        </Button>
        {formatting && (
          <div
            role="toolbar"
            aria-label={t("Formatar mensagem")}
            className={styles.toolbar}
          >
            {commands.map(({ label, Icon, active, run }) => (
              <Button
                key={label}
                type="button"
                variant="ghost"
                size="icon"
                aria-label={label}
                aria-pressed={!!active}
                disabled={props.disabled || !editor}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  run();
                }}
              >
                <Icon size={17} />
              </Button>
            ))}
          </div>
        )}
      </div>
      {link !== undefined && (
        <div className={styles.linkForm}>
          <input
            aria-label={t("Endereço do link")}
            placeholder="https://"
            value={link}
            onChange={(event) => {
              setLink(event.target.value);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            disabled={!isSafeWebLink(link)}
            onClick={() => {
              if (isSafeWebLink(link))
                editor?.chain().focus().setLink({ href: link }).run();
              setLink(undefined);
            }}
          >
            {t("Aplicar")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setLink(undefined);
              editor?.commands.focus();
            }}
          >
            {t("Cancelar")}
          </Button>
        </div>
      )}
      <EditorContent editor={editor} className={styles.input} />
      {props.value.length > props.maxLength && (
        <span role="alert" className={styles.error}>
          {t("A mensagem excede {count} caracteres.", {
            count: props.maxLength,
          })}
        </span>
      )}
    </div>
  );
}
