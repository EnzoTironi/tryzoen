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
import { useState, type ComponentProps } from "react";
import { Composer } from "./composer";
import { colors } from "./theme";

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
  initialDraft = "",
  avatarUri,
  onSend,
  disabled = false,
}: Pick<ComponentProps<typeof Composer>, "onSend" | "disabled"> & {
  readonly name?: string;
  readonly initialDraft?: string;
  readonly avatarUri?: string;
}) {
  const [suggestion, setSuggestion] = useState({
    draft: initialDraft,
    revision: 0,
  });
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
              <Text style={styles.monogramText}>z.</Text>
            </View>
          )}
          <Text accessibilityRole="header" style={styles.heading}>
            {name
              ? `A little space for you, ${name}.`
              : "A little space for you."}
          </Text>
          <Text style={styles.subtitle}>
            Big plans, small errands, and everything in between.
          </Text>
        </View>
        <Composer
          key={suggestion.revision}
          initialDraft={suggestion.draft}
          onSend={onSend}
          disabled={disabled}
        />
        <View style={styles.suggestions}>
          <Text style={styles.eyebrow}>SOMEWHERE TO START</Text>
          {suggestions.map(({ title, detail, prompt, icon: Icon }) => (
            <Pressable
              key={title}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={title}
              onPress={() => {
                setSuggestion((current) => ({
                  draft: prompt,
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
                <Text style={styles.suggestionTitle}>{title}</Text>
                <Text style={styles.suggestionDetail}>{detail}</Text>
              </View>
              <ArrowUpRight size={17} color={colors.muted} strokeWidth={1.5} />
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
    fontSize: 48,
    fontWeight: "500",
    letterSpacing: -5,
    color: colors.accent,
  },
  heading: {
    color: colors.ink,
    fontSize: 32,
    fontWeight: "500",
    lineHeight: 41,
    letterSpacing: -1.3,
    textAlign: "center",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 23,
    marginTop: 10,
    textAlign: "center",
  },
  suggestions: { marginTop: 38, gap: 6, paddingHorizontal: 6 },
  eyebrow: {
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
    color: colors.ink,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 21,
  },
  suggestionDetail: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 2,
  },
});
