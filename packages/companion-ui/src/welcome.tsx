import { useI18n } from "./i18n";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
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
import {
  elevation,
  radius,
  space,
  systemFont,
  useTypeScale,
  useColors,
  type TypeScale,
} from "./theme";
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
  const type = useTypeScale();
  const styles = useMemo(() => createStyles(colors, type), [colors, type]);
  const wide = useWindowDimensions().width >= 1024;
  const [hovered, setHovered] = useState<string>();
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
          <View style={[styles.suggestionList, wide && styles.suggestionGrid]}>
            {suggestions.map(({ title, detail, prompt, icon: Icon }) => (
              <Pressable
                key={title}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={t(title)}
                onHoverIn={() => {
                  setHovered(title);
                }}
                onHoverOut={() => {
                  setHovered(undefined);
                }}
                onPress={() => {
                  setSuggestion((current) => ({
                    draft: { ...current.draft, text: t(prompt) },
                    revision: current.revision + 1,
                  }));
                }}
                style={({ pressed }) => [
                  styles.suggestion,
                  wide && styles.suggestionCard,
                  hovered === title &&
                    (wide
                      ? styles.suggestionCardHover
                      : styles.suggestionHover),
                  pressed && styles.suggestionPressed,
                ]}
              >
                <View style={styles.suggestionIcon}>
                  <Icon size={19} strokeWidth={1.7} color={colors.accent} />
                </View>
                <View style={styles.suggestionCopy}>
                  <Text style={styles.suggestionTitle}>{t(title)}</Text>
                  <Text style={styles.suggestionDetail}>{t(detail)}</Text>
                </View>
                {!wide && (
                  <ArrowUpRight
                    size={17}
                    color={hovered === title ? colors.ink : colors.muted}
                    strokeWidth={1.6}
                  />
                )}
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function createStyles(colors: ReturnType<typeof useColors>, type: TypeScale) {
  const web = Platform.OS === "web";
  return StyleSheet.create({
    scroll: {
      flexGrow: 1,
      paddingHorizontal: space.xl,
      paddingTop: space.xxl,
      paddingBottom: space.xxxl + space.sm,
      justifyContent: "center",
    },
    page: { width: "100%", maxWidth: 720, alignSelf: "center" },
    greeting: { alignItems: "center", marginBottom: space.xxl + space.sm },
    avatar: {
      width: 88,
      height: 88,
      borderRadius: 44,
      marginBottom: space.xl,
      borderWidth: 3,
      borderColor: colors.surface,
      ...(web
        ? {
            boxShadow: `0 0 0 1px ${colors.line}, 0 12px 32px -10px rgba(16,24,40,0.35)`,
          }
        : {}),
    },
    monogram: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: space.xl,
    },
    monogramText: {
      fontFamily: systemFont,
      fontSize: 44,
      fontWeight: "500",
      letterSpacing: -4,
      color: colors.accent,
    },
    heading: {
      fontFamily: systemFont,
      ...type.largeTitle,
      fontSize: 34,
      lineHeight: 40,
      letterSpacing: -1.1,
      color: colors.ink,
      textAlign: "center",
    },
    subtitle: {
      fontFamily: systemFont,
      ...type.body,
      fontSize: 16,
      lineHeight: 24,
      color: colors.muted,
      marginTop: space.sm,
      textAlign: "center",
    },
    suggestions: { marginTop: space.xxl + space.sm },
    eyebrow: {
      fontFamily: systemFont,
      ...type.eyebrow,
      color: colors.muted,
      marginBottom: space.md,
      paddingHorizontal: space.xs,
    },
    suggestionList: { gap: space.xxs },
    suggestionGrid: { flexDirection: "row", gap: space.md },
    suggestion: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.md + 2,
      paddingVertical: space.md,
      paddingHorizontal: space.sm,
      borderRadius: radius.md,
      ...(web
        ? {
            transitionProperty: "background-color, box-shadow, transform",
            transitionDuration: "180ms",
            transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
          }
        : {}),
    },
    suggestionCard: {
      flex: 1,
      flexDirection: "column",
      alignItems: "flex-start",
      gap: space.md,
      padding: space.lg,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      ...(web
        ? { boxShadow: elevation.card }
        : { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line }),
    },
    suggestionHover: { backgroundColor: colors.wash },
    suggestionCardHover: {
      transform: [{ translateY: -2 }],
      ...(web ? { boxShadow: elevation.raised } : {}),
    },
    suggestionPressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
    suggestionIcon: {
      width: 38,
      height: 38,
      backgroundColor: colors.accentSoft,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
    },
    suggestionCopy: { flex: 1, gap: space.xxs },
    suggestionTitle: {
      fontFamily: systemFont,
      ...type.callout,
      fontSize: 15,
      fontWeight: "600",
      color: colors.ink,
    },
    suggestionDetail: {
      fontFamily: systemFont,
      ...type.footnote,
      color: colors.muted,
    },
  });
}
