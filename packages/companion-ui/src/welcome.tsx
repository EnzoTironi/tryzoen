import { useI18n } from "./i18n";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  ArrowUpRight,
  CalendarDays,
  Compass,
  Lightbulb,
} from "lucide-react-native";
import { useMemo, useCallback, useState, type ComponentProps } from "react";
import type { ConversationDraft } from "./session/input";
import { Composer } from "./composer";
import { systemFont, useColors } from "./theme";
import {
  readReplyMessage,
  replyMessage,
  type MessageReply,
} from "./session/reply";

const suggestions = [
  {
    title: "Make room for what matters",
    detail: "Find a little breathing room in my week",
    prompt:
      "Help me find a little breathing room in my week. Ask me what matters most before changing anything.",
    icon: CalendarDays,
  },
  {
    title: "Follow a little curiosity",
    detail: "Explore something I’ve been thinking about",
    prompt:
      "Help me explore an idea. Start by asking what I have been thinking about.",
    icon: Compass,
  },
  {
    title: "Turn an idea into a plan",
    detail: "Take the first step on something meaningful",
    prompt:
      "Help me turn an idea into an achievable plan. Ask me what I want to work toward.",
    icon: Lightbulb,
  },
];

export function Welcome({
  name,
  initialDraft,
  avatarUri,
  onSend,
  onDraftChange,
  disabled = false,
}: Pick<
  ComponentProps<typeof Composer>,
  "onSend" | "disabled" | "onDraftChange"
> & {
  readonly name?: string;
  readonly initialDraft?: ConversationDraft;
  readonly avatarUri?: string;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const staged = readReplyMessage(initialDraft?.text ?? "");
  const [reply, setReply] = useState<MessageReply | undefined>(() =>
    staged
      ? { id: staged.id, role: staged.role, text: staged.quote }
      : undefined
  );
  const [suggestion, setSuggestion] = useState({
    draft: {
      files: initialDraft?.files ?? [],
      text: staged?.text ?? initialDraft?.text ?? "",
    },
    revision: 0,
  });
  const rememberDraft = useCallback(
    (draft: ConversationDraft) => {
      setSuggestion((current) => ({ ...current, draft }));
      onDraftChange?.({ ...draft, text: replyMessage(draft.text, reply) });
    },
    [onDraftChange, reply]
  );
  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.page}>
        <View style={styles.greeting}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatar} />
          ) : (
            <View style={styles.monogram}>
              <Text style={styles.monogramText}>{t("z.")}</Text>
            </View>
          )}
          <Text accessibilityRole="header" style={styles.heading}>
            {name
              ? t("A little space for you, {value1}.", { value1: name })
              : t("A little space for you.")}
          </Text>
          <Text style={styles.subtitle}>
            {t("Big plans, small errands, and everything in between.")}
          </Text>
        </View>
        <Composer
          key={suggestion.revision}
          initialDraft={suggestion.draft}
          onDraftChange={rememberDraft}
          reply={reply}
          onRemoveReply={() => {
            setReply(undefined);
          }}
          onSend={async (message) => {
            await onSend({
              ...message,
              text: replyMessage(message.text, reply),
            });
            setReply(undefined);
          }}
          disabled={disabled}
        />
        <View style={styles.suggestions}>
          <Text style={styles.eyebrow}>{t("SOMEWHERE TO START")}</Text>
          {suggestions.map(({ title, detail, prompt, icon: Icon }) => (
            <Pressable
              key={title}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={t(title)}
              onPress={() => {
                setSuggestion((current) => ({
                  draft: { ...current.draft, text: t(prompt) },
                  revision: current.revision + 1,
                }));
              }}
              style={({ pressed }) => [
                styles.suggestion,
                pressed && { opacity: 0.6 },
              ]}
            >
              <View style={styles.suggestionIcon}>
                <Icon size={20} strokeWidth={1.5} color={colors.accent} />
              </View>
              <View style={styles.suggestionCopy}>
                <Text style={styles.suggestionTitle}>{t(title)}</Text>
                <Text style={styles.suggestionDetail}>{t(detail)}</Text>
              </View>
              <ArrowUpRight size={17} color={colors.muted} strokeWidth={1.5} />
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    scroll: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingTop: 28,
      paddingBottom: 56,
      justifyContent: "center",
    },
    page: { width: "100%", maxWidth: 690, alignSelf: "center" },
    greeting: { alignItems: "center", marginBottom: 40 },
    avatar: { width: 100, height: 100, borderRadius: 50, marginBottom: 24 },
    monogram: {
      width: 86,
      height: 86,
      borderRadius: 43,
      backgroundColor: "#e5e8d8",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 24,
    },
    monogramText: {
      fontFamily: systemFont,
      fontSize: 48,
      fontWeight: "500",
      letterSpacing: -5,
      color: colors.accent,
    },
    heading: {
      fontFamily: systemFont,
      color: colors.ink,
      fontSize: 32,
      fontWeight: "500",
      lineHeight: 41,
      letterSpacing: -1.3,
      textAlign: "center",
    },
    subtitle: {
      fontFamily: systemFont,
      color: colors.muted,
      fontSize: 15,
      lineHeight: 23,
      marginTop: 10,
      textAlign: "center",
    },
    suggestions: { marginTop: 38, gap: 6, paddingHorizontal: 6 },
    eyebrow: {
      fontFamily: systemFont,
      fontSize: 10,
      letterSpacing: 1.7,
      color: colors.muted,
      marginBottom: 14,
    },
    suggestion: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      paddingVertical: 12,
    },
    suggestionIcon: {
      width: 42,
      height: 42,
      backgroundColor: "#f0f1e9",
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    suggestionCopy: { flex: 1 },
    suggestionTitle: {
      fontFamily: systemFont,
      color: colors.ink,
      fontSize: 14,
      fontWeight: "500",
      lineHeight: 21,
    },
    suggestionDetail: {
      fontFamily: systemFont,
      color: colors.muted,
      fontSize: 13,
      lineHeight: 20,
      marginTop: 2,
    },
  });
}
