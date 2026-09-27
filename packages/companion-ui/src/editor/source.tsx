import { useImperativeHandle, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { MarkdownEditorProps } from "../markdown-editor";
import { colors } from "../theme";

export function MarkdownSourceEditor({
  initialMarkdown,
  editable,
  label,
  description,
  onChange,
  ref,
  notice = "This document uses formatting the visual editor does not support yet. Edit its Markdown here to preserve it.",
}: MarkdownEditorProps & { readonly notice?: string }) {
  const [text, setText] = useState(initialMarkdown);
  useImperativeHandle(ref, () => ({ read: () => Promise.resolve(text) }), [
    text,
  ]);
  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.document}>
        {Boolean(description) && (
          <Text style={styles.about}>{description}</Text>
        )}
        {Boolean(notice) && <Text style={styles.notice}>{notice}</Text>}
        <TextInput
          accessibilityLabel={label}
          editable={editable}
          multiline
          value={text}
          style={styles.source}
          onChangeText={(value) => {
            setText(value);
            onChange(value);
          }}
        />
      </View>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  scroll: { alignItems: "center", padding: 24 },
  document: { width: "100%", maxWidth: 920, gap: 24 },
  about: {
    fontSize: 16,
    lineHeight: 25,
    fontStyle: "italic",
    color: colors.muted,
    borderLeftWidth: 3,
    borderLeftColor: colors.line,
    paddingLeft: 16,
  },
  notice: { fontSize: 14, lineHeight: 21, color: colors.muted },
  source: {
    minHeight: 420,
    textAlignVertical: "top",
    fontSize: 16,
    lineHeight: 25,
    color: colors.ink,
  },
});
