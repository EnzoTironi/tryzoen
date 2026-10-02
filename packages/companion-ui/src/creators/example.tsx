import { useI18n, Translated } from "./../i18n";

import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import { creatorExampleSchema } from "./schema";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { DocumentEditor } from "../document-editor";
import { usePageStyles } from "../page";
import { useColors } from "../theme";

const rightsOptions = [
  { value: "original", label: "I created this example" },
  { value: "permission", label: "I have permission to use it" },
  { value: "public-domain", label: "It is in the public domain" },
] as const;

export function CreatorExample({
  initial,
  onSave,
  onRemove,
  onClose,
}: {
  readonly initial: z.infer<typeof creatorExampleSchema>;
  readonly onSave: (
    example: z.infer<typeof creatorExampleSchema>
  ) => Promise<void>;
  readonly onRemove?: () => Promise<void>;
  readonly onClose: () => void;
}) {
  const { t, locale, errorText } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
  const [value, setValue] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const save = useMutation({ mutationFn: onSave, onSuccess: onClose });
  const remove = useMutation({
    mutationFn: async () => {
      await onRemove?.();
    },
    onSuccess: onClose,
  });
  const busy = save.isPending || remove.isPending;
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);
  const close = () => {
    if (busy) return;
    if (dirty) setDiscarding(true);
    else onClose();
  };
  return (
    <CompanionSheet title={t("Authored example")} onClose={close}>
      <Text style={pageStyles.rowTitle}>{t("Title")}</Text>
      <TextInput
        accessibilityLabel={t("Example title")}
        placeholder={t("A useful expert decision")}
        style={pageStyles.field}
        maxLength={120}
        value={value.title}
        editable={!busy}
        onChangeText={(title) => {
          setValue({ ...value, title });
        }}
      />
      <Text style={pageStyles.rowTitle}>{t("Source and permission")}</Text>
      <TextInput
        accessibilityLabel={t("Example source and permission")}
        placeholder={t("Where this came from and how you may use it")}
        style={pageStyles.field}
        maxLength={1000}
        value={value.source}
        editable={!busy}
        onChangeText={(source) => {
          setValue({ ...value, source });
        }}
      />
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("Usage rights")}
        style={{ gap: 8 }}
      >
        {rightsOptions.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={t(option.label)}
            aria-checked={confirmed && value.rights === option.value}
            aria-disabled={busy}
            disabled={busy}
            style={styles.choice}
            onPress={() => {
              setValue({ ...value, rights: option.value });
              setConfirmed(true);
            }}
          >
            <Text style={pageStyles.rowTitle}>
              {confirmed && value.rights === option.value ? "●" : "○"}
            </Text>
            <Text style={pageStyles.copy}>{t(option.label)}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={pageStyles.copy}>
        {t(
          "Confirm the source rights for this saved version. This is your declaration; Zoen has not verified the permission."
        )}
      </Text>
      <ActionButton
        quiet
        disabled={busy}
        onPress={() => {
          setEditing(true);
        }}
      >
        {t("Write the example")}
      </ActionButton>
      <Text style={pageStyles.copy}>
        <Translated
          message="{value1} characters in your draft"
          values={{ value1: value.content.length.toLocaleString(locale) }}
        />
      </Text>
      <ActionButton
        disabled={
          busy || !confirmed || !creatorExampleSchema.safeParse(value).success
        }
        onPress={() => {
          save.mutate(value);
        }}
      >
        {save.isPending ? t("Saving…") : t("Save example")}
      </ActionButton>
      {save.isError && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          {errorText(save.error.message)}
        </Text>
      )}
      {onRemove && (
        <ActionButton
          quiet
          disabled={busy}
          onPress={() => {
            setRemoving(true);
          }}
        >
          {t("Remove example")}
        </ActionButton>
      )}
      {removing && (
        <View style={{ gap: 8 }}>
          <Text style={pageStyles.rowTitle}>
            {t("Remove this example from your draft?")}
          </Text>
          <ActionButton
            quiet
            disabled={busy}
            onPress={() => {
              setRemoving(false);
            }}
          >
            {t("Keep example")}
          </ActionButton>
          <ActionButton
            disabled={busy}
            onPress={() => {
              remove.mutate();
            }}
          >
            {remove.isPending ? t("Removing…") : t("Confirm removal")}
          </ActionButton>
          {remove.isError && (
            <Text accessibilityRole="alert" style={pageStyles.copy}>
              {errorText(remove.error.message)}
            </Text>
          )}
        </View>
      )}
      {discarding && (
        <View style={{ gap: 8 }}>
          <Text style={pageStyles.rowTitle}>
            {t("Discard your unsaved example?")}
          </Text>
          <ActionButton
            quiet
            onPress={() => {
              setDiscarding(false);
            }}
          >
            {t("Keep editing")}
          </ActionButton>
          <ActionButton onPress={onClose}>{t("Discard changes")}</ActionButton>
        </View>
      )}
      {editing && (
        <DocumentEditor
          title={t("Example.md")}
          label={t("Expert example")}
          description={t(
            "Describe the case, your observations, strategy, alternatives and useful response. This editor updates your draft; use Save example to save it to your account."
          )}
          initialText={value.content}
          maxLength={24000}
          markdown
          onClose={() => {
            setEditing(false);
          }}
          onSave={async (content) => {
            setValue({ ...value, content });
          }}
        />
      )}
    </CompanionSheet>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    choice: {
      minHeight: 44,
      flexDirection: "row",
      gap: 12,
      alignItems: "center",
      backgroundColor: colors.wash,
      padding: 12,
      borderRadius: 16,
    },
  });
}
