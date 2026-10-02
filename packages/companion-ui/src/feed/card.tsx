import { useI18n } from "./../i18n";
import { useMemo, useState } from "react";
import type { z } from "zod";
import { Ellipsis, Heart, MessageCircle } from "lucide-react-native";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { AssistantMarkdown } from "../markdown";
import { IconButton } from "../icon-button";
import { usePageStyles } from "../page";
import { systemFont, useColors } from "../theme";
import type { feedPostSchema } from "./schema";

export function FeedCard({
  post,
  pending,
  onLike,
  onDiscuss,
  onOptions,
}: {
  readonly post: z.infer<typeof feedPostSchema>;
  readonly pending: boolean;
  readonly onLike: () => void;
  readonly onDiscuss: () => void;
  readonly onOptions: () => void;
}) {
  const { t, locale } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
  const [linkError, setLinkError] = useState(false);
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          {post.title}
        </Text>
        <Text style={styles.date}>
          {new Date(post.createdAt).toLocaleDateString(locale, {
            month: "short",
            day: "numeric",
          })}
        </Text>
        <IconButton
          label={t("Options for {value1}", { value1: post.title })}
          icon={Ellipsis}
          onPress={onOptions}
        />
      </View>
      <AssistantMarkdown text={post.content} />
      {post.sources.length > 0 && (
        <View style={styles.sources}>
          <Text style={pageStyles.rowTitle}>{t("Sources")}</Text>
          {post.sources.map((source) => (
            <Pressable
              key={source.url}
              accessibilityRole="link"
              onPress={() => {
                setLinkError(false);
                void Linking.openURL(source.url).catch(() => {
                  setLinkError(true);
                });
              }}
            >
              <Text style={styles.source}>{source.title}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {linkError && (
        <Text accessibilityRole="alert" style={{ color: colors.danger }}>
          {t("Couldn’t open the source. Try again.")}
        </Text>
      )}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${post.liked ? t("Unlike") : t("Like")} ${post.title}`}
          accessibilityState={{ selected: post.liked, disabled: pending }}
          disabled={pending}
          onPress={onLike}
          style={styles.action}
        >
          <Heart
            size={21}
            color={post.liked ? colors.danger : colors.ink}
            fill={post.liked ? colors.danger : "transparent"}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Discuss {value1}", { value1: post.title })}
          onPress={onDiscuss}
          style={styles.action}
        >
          <MessageCircle size={21} color={colors.ink} />
          <Text style={styles.discuss}>{t("Discuss")}</Text>
        </Pressable>
      </View>
    </View>
  );
}
function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    card: {
      gap: 8,
      marginBottom: 32,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 12,
    },
    title: {
      fontFamily: systemFont,
      color: colors.ink,
      fontSize: 18,
      lineHeight: 26,
      fontWeight: "500",
      flex: 1,
    },
    date: {
      fontFamily: systemFont,
      color: colors.muted,
      fontSize: 12,
      lineHeight: 26,
    },
    discuss: {
      fontFamily: systemFont,
      color: colors.ink,
      fontSize: 13,
      lineHeight: 20,
    },
    sources: { gap: 10 },
    source: {
      fontFamily: systemFont,
      color: colors.accent,
      fontSize: 14,
      lineHeight: 22,
    },
    actions: { flexDirection: "row", gap: 12, alignItems: "center" },
    action: {
      minHeight: 44,
      minWidth: 44,
      flexDirection: "row",
      gap: 10,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 8,
    },
  });
}
