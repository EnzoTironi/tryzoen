import { useImperativeHandle, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  RichText,
  useEditorBridge,
  useBridgeState,
  TenTapStartKit,
} from "@10play/tentap-editor";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Undo2,
  Redo2,
} from "lucide-react-native";
import {
  MarkdownSourceEditor,
  type MarkdownEditorProps,
} from "@zoen/companion-ui";
import {
  documentMarkdown,
  needsSourceEditor,
} from "@zoen/companion-ui/markdown";
import { Pressable } from "react-native";

// The native bundle supports these Markdown nodes; omit marks that cannot be serialized.
const bridges = TenTapStartKit.filter(
  (bridge) =>
    !["image", "underline", "taskList", "color", "highlight"].includes(
      bridge.name
    )
);

export function MobileEditor(props: MarkdownEditorProps) {
  return needsSourceEditor(props.initialMarkdown, true) ? (
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
  onError,
  onDirty,
  ref,
}: MarkdownEditorProps) {
  const [initial] = useState(() => {
    const content = documentMarkdown.parse(initialMarkdown);
    return { content, canonical: documentMarkdown.serialize(content) };
  });
  const sequence = useRef(0);
  const editor = useEditorBridge({
    initialContent: initial.content,
    editable,
    webviewBaseURL: "about:blank",
    avoidIosKeyboard: true,
    bridgeExtensions: bridges,
    onChange: () => {
      onDirty();
      const current = ++sequence.current;
      void editor
        .getJSON()
        .then((content) => {
          if (current !== sequence.current) return;
          const markdown = documentMarkdown.serialize(content);
          onChange(markdown === initial.canonical ? initialMarkdown : markdown);
        })
        .catch(() => {
          onError("The editor could not read your changes. Try saving again.");
        });
    },
  });
  const state = useBridgeState(editor);
  useImperativeHandle(
    ref,
    () => ({
      read: async () => {
        if (!editor.getEditorState().isReady)
          throw new Error("The editor is still loading. Try again.");
        const markdown = documentMarkdown.serialize(await editor.getJSON());
        return markdown === initial.canonical ? initialMarkdown : markdown;
      },
    }),
    [editor, initial.canonical, initialMarkdown]
  );
  const commands = [
    {
      label: "Bold",
      active: state.isBoldActive,
      icon: <Bold size={19} />,
      run: editor.toggleBold,
    },
    {
      label: "Italic",
      active: state.isItalicActive,
      icon: <Italic size={19} />,
      run: editor.toggleItalic,
    },
    ...([1, 2, 3] as const).map((level) => ({
      label: `Heading ${level}`,
      active: state.headingLevel === level,
      icon: <Text>H{level}</Text>,
      run: () => {
        editor.toggleHeading(level);
      },
    })),
    {
      label: "Bullet list",
      active: state.isBulletListActive,
      icon: <List size={20} />,
      run: editor.toggleBulletList,
    },
    {
      label: "Numbered list",
      active: state.isOrderedListActive,
      icon: <ListOrdered size={20} />,
      run: editor.toggleOrderedList,
    },
    {
      label: "Undo",
      active: false,
      icon: <Undo2 size={19} />,
      run: editor.undo,
    },
    {
      label: "Redo",
      active: false,
      icon: <Redo2 size={19} />,
      run: editor.redo,
    },
  ];
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View accessibilityRole="toolbar" style={styles.toolbar}>
        {commands.map((command) => (
          <Pressable
            key={command.label}
            accessibilityRole="button"
            accessibilityLabel={command.label}
            accessibilityState={{
              selected: command.active,
              disabled: !editable || !state.isReady,
            }}
            disabled={!editable || !state.isReady}
            onPress={command.run}
            style={[styles.tool, command.active && styles.active]}
          >
            {command.icon}
          </Pressable>
        ))}
      </View>
      <Text style={styles.about}>{description}</Text>
      <RichText
        editor={editor}
        accessibilityLabel={label}
        style={styles.root}
        onError={() => {
          onError("The editor could not load. Close it and try again.");
        }}
        onContentProcessDidTerminate={() => {
          onError(
            "The editor stopped responding. Your saved document is unchanged."
          );
        }}
        originWhitelist={["about:blank"]}
        onShouldStartLoadWithRequest={({ url }) => url === "about:blank"}
        onLoadEnd={() => {
          editor.injectCSS(
            "body { margin: 0; padding: 16px 24px 60px; color: #111112; font-family: -apple-system, sans-serif; } .tiptap { font-size: 18px; line-height: 1.6; } h1 {font-size:32px} h2 {font-size:26px} h3 {font-size:22px} a {pointer-events:none}"
          );
        }}
      />
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: "#fcfcfc" },
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 2,
    padding: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e2e2e2",
  },
  tool: {
    width: 40,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  active: { backgroundColor: "#ededee" },
  about: {
    fontSize: 15,
    lineHeight: 23,
    fontStyle: "italic",
    color: "#666",
    margin: 24,
    borderLeftWidth: 3,
    borderLeftColor: "#e2e2e2",
    paddingLeft: 14,
  },
});
