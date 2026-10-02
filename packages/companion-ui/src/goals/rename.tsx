import { useI18n, Translated } from "./../i18n";

import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react-native";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ActionButton } from "../button";
import { IconButton } from "../icon-button";
import { CompanionOverlay } from "../overlay";
import { systemFont, useColors } from "../theme";

export function GoalRename({
  initialTitle,
  onSave,
  onClose,
}: {
  readonly initialTitle: string;
  readonly onSave: (title: string) => Promise<void>;
  readonly onClose: () => void;
}) {
  const { t, errorText } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [title, setTitle] = useState(initialTitle);
  const input = useRef<TextInput>(null);
  const save = useMutation({ mutationFn: onSave, onSuccess: onClose });
  const valid =
    title.trim().length > 0 &&
    title.trim().length <= 100 &&
    title.trim() !== initialTitle.trim();
  const close = () => {
    if (!save.isPending) onClose();
  };
  const submit = () => {
    if (valid && !save.isPending) save.mutate(title.trim());
  };
  return (
    <CompanionOverlay
      title={t("Rename goal")}
      onClose={close}
      focusOnOpen={() => {
        input.current?.focus();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.backdrop}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Cancel goal rename")}
          onPress={close}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.dialog}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.heading}>
              {t("Rename goal")}
            </Text>
            <IconButton
              label={t("Close goal rename")}
              icon={X}
              disabled={save.isPending}
              onPress={close}
            />
          </View>
          <Text nativeID="goal-name-label" style={styles.label}>
            {t("Goal name")}
          </Text>
          <TextInput
            ref={input}
            accessibilityLabel={t("Goal name")}
            aria-labelledby="goal-name-label"
            value={title}
            onChangeText={setTitle}
            maxLength={100}
            editable={!save.isPending}
            returnKeyType="done"
            onSubmitEditing={submit}
            onKeyPress={({ nativeEvent }) => {
              if (nativeEvent.key === "Escape") close();
            }}
            style={styles.input}
          />
          {save.error && (
            <Text accessibilityRole="alert" style={styles.error}>
              <Translated
                message="Could not save this name. Your draft is kept. {value1}"
                values={{ value1: errorText(save.error.message) }}
              />
            </Text>
          )}
          <View style={styles.actions}>
            <ActionButton quiet disabled={save.isPending} onPress={close}>
              {t("Cancel")}
            </ActionButton>
            <ActionButton disabled={!valid || save.isPending} onPress={submit}>
              {save.isPending ? t("Saving…") : t("Save")}
            </ActionButton>
          </View>
        </View>
      </KeyboardAvoidingView>
    </CompanionOverlay>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 16,
      backgroundColor: "rgba(252,252,252,0.45)",
    },
    dialog: {
      width: "100%",
      maxWidth: 420,
      padding: 24,
      paddingTop: 12,
      borderRadius: 24,
      backgroundColor: colors.canvas,
      boxShadow: "0 8px 40px rgba(0,0,0,0.08)",
    },
    header: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
    heading: {
      fontFamily: systemFont,
      flex: 1,
      color: colors.ink,
      fontSize: 18,
      fontWeight: "600",
    },
    label: {
      fontFamily: systemFont,
      color: colors.ink,
      fontSize: 14,
      marginBottom: 4,
    },
    input: {
      fontFamily: systemFont,
      height: 44,
      paddingHorizontal: 12,
      fontSize: 16,
      color: colors.ink,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 10,
    },
    actions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 8,
      marginTop: 16,
    },
    error: {
      fontFamily: systemFont,
      color: colors.danger,
      fontSize: 14,
      marginTop: 12,
    },
  });
}
