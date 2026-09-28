import {
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  RichText,
  TenTapStartKit,
  useBridgeState,
  useEditorBridge,
} from "@10play/tentap-editor";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Type,
  Link,
  Quote,
  Code,
} from "lucide-react-native";
import type { ComposerEditorProps } from "@zoen/companion-ui";
import {
  composerMarkdown,
  isSafeWebLink,
  composerReferenceAt,
  composerReferenceContent,
  replaceComposerRange,
} from "@zoen/companion-ui/composer";
import { documentMarkdown } from "@zoen/companion-ui/markdown";

function NativePromptEditor({ ref, ...props }: ComposerEditorProps) {
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  }, [props]);
  const last = useRef(props.value);
  const sequence = useRef(0);
  const [formatting, setFormatting] = useState(false);
  const [link, setLink] = useState<string>();
  const editor = useEditorBridge({
    initialContent: documentMarkdown.parse(props.value),
    editable: !props.disabled,
    avoidIosKeyboard: true,
    dynamicHeight: true,
    webviewBaseURL: "about:blank",
    bridgeExtensions: TenTapStartKit.filter(
      (bridge) =>
        !["image", "underline", "taskList", "color", "highlight"].includes(
          bridge.name
        )
    ).map((bridge) =>
      bridge.name === "link"
        ? bridge.configureExtension({
            openOnClick: false,
            autolink: false,
            protocols: ["zoen-reference"],
          })
        : bridge.name === "placeholder"
          ? bridge.configureExtension({ placeholder: props.placeholder })
          : bridge
    ),
    onChange: () => {
      void synchronize();
    },
  });
  const state = useBridgeState(editor);
  async function synchronize() {
    const turn = ++sequence.current;
    try {
      const content = await editor.getJSON();
      if (turn !== sequence.current) return;
      last.current = composerMarkdown(content);
      latest.current.onChange(last.current);
      latest.current.onReference(
        composerReferenceAt(content, editor.getEditorState().selection.from)
      );
    } catch {
      latest.current.onError(
        "Não foi possível ler a mensagem. Tente novamente."
      );
    }
  }
  useEffect(() => {
    editor.setEditable(!props.disabled);
  }, [editor, props.disabled]);
  useEffect(() => {
    if (state.isReady && props.value !== last.current) {
      last.current = props.value;
      editor.setContent(documentMarkdown.parse(props.value));
    }
  }, [editor, props.value, state.isReady]);
  useEffect(() => {
    if (!state.isReady) return undefined;
    let active = true;
    void editor
      .getJSON()
      .then((content) => {
        if (active)
          latest.current.onReference(
            composerReferenceAt(content, state.selection.from)
          );
      })
      .catch(() => {
        if (active) latest.current.onReference(null);
      });
    return () => {
      active = false;
    };
  }, [editor, state.isReady, state.selection.from]);
  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editor.focus();
      },
      read: async () => composerMarkdown(await editor.getJSON()),
      insertText: (text) => {
        void editor
          .getJSON()
          .then((content) => {
            const selection = editor.getEditorState().selection;
            editor.setContent(
              replaceComposerRange(content, selection.from, selection.to, [
                { type: "text", text },
              ])
            );
            editor.setSelection(
              selection.from + text.length,
              selection.from + text.length
            );
            editor.focus();
          })
          .catch(() => {
            latest.current.onError("Não foi possível inserir a referência.");
          });
      },
      insertReference: (item) => {
        void editor
          .getJSON()
          .then((content) => {
            const token = composerReferenceAt(
              content,
              editor.getEditorState().selection.from
            );
            if (!token) return;
            editor.setContent(
              replaceComposerRange(
                content,
                token.start,
                token.end,
                composerReferenceContent(item)
              )
            );
            const caret = token.start + item.title.length + 1;
            editor.setSelection(caret, caret);
            editor.focus();
          })
          .catch(() => {
            latest.current.onError("Não foi possível inserir a referência.");
          });
      },
    }),
    [editor]
  );
  const commands = [
    {
      label: "Negrito",
      Icon: Bold,
      active: state.isBoldActive,
      run: editor.toggleBold,
    },
    {
      label: "Itálico",
      Icon: Italic,
      active: state.isItalicActive,
      run: editor.toggleItalic,
    },
    {
      label: "Lista",
      Icon: List,
      active: state.isBulletListActive,
      run: editor.toggleBulletList,
    },
    {
      label: "Lista numerada",
      Icon: ListOrdered,
      active: state.isOrderedListActive,
      run: editor.toggleOrderedList,
    },
    {
      label: "Citação",
      Icon: Quote,
      active: state.isBlockquoteActive,
      run: editor.toggleBlockquote,
    },
    {
      label: "Inserir link",
      Icon: Link,
      active: link !== undefined,
      run: () => {
        setLink("");
      },
    },
    {
      label: "Código",
      Icon: Code,
      active: state.isCodeActive,
      run: editor.toggleCode,
    },
  ];
  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Formatação da mensagem"
          accessibilityState={{ expanded: formatting }}
          onPress={() => {
            setFormatting(!formatting);
          }}
          style={styles.button}
        >
          <Type size={19} color="#6c7075" />
        </Pressable>
        {formatting && (
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="always"
            contentContainerStyle={styles.toolbar}
          >
            {commands.map(({ label, Icon, active, run }) => (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{
                  selected: active,
                  disabled: props.disabled || !state.isReady,
                }}
                disabled={props.disabled || !state.isReady}
                onPress={run}
                style={[styles.button, active && styles.active]}
              >
                <Icon size={18} color={active ? "#0866c9" : "#6c7075"} />
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
      {link !== undefined && (
        <View style={styles.toolbar}>
          <TextInput
            accessibilityLabel="Endereço do link"
            placeholder="https://"
            value={link}
            onChangeText={setLink}
            autoCapitalize="none"
            style={{ flex: 1, minHeight: 44 }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Aplicar link"
            disabled={!isSafeWebLink(link)}
            onPress={() => {
              if (isSafeWebLink(link)) editor.setLink(link);
              setLink(undefined);
            }}
          >
            <Text>Aplicar</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancelar link"
            onPress={() => {
              setLink(undefined);
              editor.focus();
            }}
          >
            <Text>Cancelar</Text>
          </Pressable>
        </View>
      )}
      <RichText
        editor={editor}
        accessibilityLabel={props.label}
        style={styles.input}
        originWhitelist={["about:blank"]}
        onShouldStartLoadWithRequest={({ url }) => url === "about:blank"}
        onError={() => {
          props.onError("Não foi possível carregar o campo de mensagem.");
        }}
        onLoadEnd={() => {
          editor.injectCSS(
            'body { margin:0; padding:4px; font-family:-apple-system,sans-serif; color:#111112; } .tiptap {font-size:16px;line-height:1.5} p {margin:0 0 4px} a {pointer-events:none;color:#0866c9} a[href^="zoen-reference:"] {background:#e8f1ff;border-radius:6px;padding:2px 5px;text-decoration:none} blockquote {border-left:3px solid #b9c0c8;padding-left:12px}'
          );
        }}
      />
      {props.value.length > props.maxLength && (
        <Text accessibilityRole="alert">A mensagem é muito longa.</Text>
      )}
    </View>
  );
}
export function renderComposerEditor(props: ComposerEditorProps) {
  return <NativePromptEditor {...props} />;
}
const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0 },
  toolbar: { flexDirection: "row", alignItems: "center", gap: 2 },
  button: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  active: { backgroundColor: "#e8f1ff" },
  input: { minHeight: 48, maxHeight: 192, backgroundColor: "transparent" },
});
