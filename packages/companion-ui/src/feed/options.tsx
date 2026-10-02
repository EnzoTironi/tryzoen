import { useI18n, Translated } from "./../i18n";

import { useState } from "react";
import type { z } from "zod";
import { Text } from "react-native";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import { usePageStyles } from "../page";
import { useColors } from "../theme";
import type { feedPostSchema } from "./schema";

export function FeedOptions({
  post,
  pending,
  error,
  onDelete,
  onClose,
}: {
  readonly post: z.infer<typeof feedPostSchema>;
  readonly pending: boolean;
  readonly error?: string;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const colors = useColors();
  const pageStyles = usePageStyles();
  const [confirm, setConfirm] = useState(false);
  return (
    <CompanionSheet
      title={confirm ? t("Delete this post?") : t("About this post")}
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <Text style={pageStyles.rowTitle}>{post.title}</Text>
      {confirm ? (
        <Text style={pageStyles.copy}>
          {t(
            "This permanently removes the post from your Feed. Conversations about it are kept."
          )}
        </Text>
      ) : (
        <>
          <Text style={pageStyles.copy}>
            <Translated
              message="Published {value1}"
              values={{
                value1: new Date(post.createdAt).toLocaleString(locale),
              }}
            />
          </Text>
          <Text style={pageStyles.rowTitle}>{t("Why this was created")}</Text>
          <Text style={pageStyles.copy}>{post.rationale}</Text>
        </>
      )}
      {error && (
        <Text accessibilityRole="alert" style={{ color: colors.danger }}>
          {error}
        </Text>
      )}
      <ActionButton
        quiet
        disabled={pending}
        onPress={() => {
          if (confirm) onDelete();
          else setConfirm(true);
        }}
      >
        {pending ? t("Deleting…") : t("Delete post")}
      </ActionButton>
      {confirm && (
        <ActionButton
          quiet
          disabled={pending}
          onPress={() => {
            setConfirm(false);
          }}
        >
          {t("Keep post")}
        </ActionButton>
      )}
    </CompanionSheet>
  );
}
