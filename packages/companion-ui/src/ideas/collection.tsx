import { useI18n } from "./../i18n";
import { useMemo, useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import { Ellipsis, Sparkles } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CompanionPage, usePageStyles } from "../page";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import { IconButton } from "../icon-button";
import { systemFont, useColors } from "../theme";
import { IdeaDetail } from "./detail";
import {
  ideaStatusLabels,
  type ideaCursorSchema,
  type ideaFeedbackInputSchema,
  type ideaPageSchema,
} from "./schema";

export interface IdeasData {
  list: (
    cursor?: z.infer<typeof ideaCursorSchema> | null
  ) => Promise<z.infer<typeof ideaPageSchema>>;
  feedback: (input: z.infer<typeof ideaFeedbackInputSchema>) => Promise<void>;
  start: (id: string) => Promise<string>;
}

export function IdeaCollection({
  data,
  cacheScope,
  onPrompt,
  onConversation,
}: {
  readonly data: IdeasData;
  readonly cacheScope: string;
  readonly onPrompt: (prompt: string) => void;
  readonly onConversation: (id: string) => void;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
  const [selection, setSelection] = useState<{
    id: string;
    feedbackOnly: boolean;
  }>();
  const ideas = useInfiniteQuery({
    queryKey: ["personal-ideas", cacheScope],
    initialPageParam: null as z.infer<typeof ideaCursorSchema> | null,
    queryFn: ({ pageParam }) => data.list(pageParam),
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.items.some(
          (item) => item.status === "starting" || item.status === "running"
        )
      )
        ? 5000
        : false,
  });
  const feedback = useMutation({
    mutationFn: data.feedback,
    onSuccess: async (_result, input) => {
      if (input.feedback === "dismissed") setSelection(undefined);
      await ideas.refetch();
    },
  });
  const start = useMutation({
    mutationFn: data.start,
    onSuccess: (id) => {
      onConversation(id);
    },
  });
  const items = ideas.data?.pages.flatMap((page) => page.items) ?? [];
  const selected = items.find((item) => item.id === selection?.id);
  const categories = [...new Set(items.map((item) => item.category))];
  const pending = start.isPending || feedback.isPending;
  const error = start.error?.message ?? feedback.error?.message;
  const ask = () => {
    onPrompt(
      t(
        "Suggest up to five useful personal ideas based on what I have actually shared. Read my saved ideas and feedback first, explain why each fits, and save the proposals in Ideas without executing them. If you need context, ask me one focused question."
      )
    );
  };
  return (
    <>
      <CompanionPage
        title={t("Ideas")}
        loading={ideas.isPending}
        error={ideas.error?.message}
        onRetry={() => {
          void ideas.refetch();
        }}
        actions={
          <IconButton
            label={t("Ask for new ideas")}
            icon={Sparkles}
            onPress={ask}
          />
        }
      >
        {!ideas.isPending && !ideas.isError && items.length === 0 && (
          <View style={pageStyles.empty}>
            <Text style={pageStyles.heading}>
              {t("What could I take off your plate?")}
            </Text>
            <Text style={pageStyles.copy}>
              {t(
                "Share what you’re working toward. Your personal suggestions will appear here, ready when you are."
              )}
            </Text>
            <ActionButton onPress={ask}>{t("Ask for ideas")}</ActionButton>
          </View>
        )}
        {categories.map((category, index) => (
          <View key={category} style={index > 0 && pageStyles.section}>
            <Text accessibilityRole="header" style={pageStyles.heading}>
              {category}
            </Text>
            {items
              .filter((item) => item.category === category)
              .map((item) => (
                <View key={item.id} style={styles.row}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={item.title}
                    style={styles.idea}
                    onPress={() => {
                      start.reset();
                      feedback.reset();
                      setSelection({ id: item.id, feedbackOnly: false });
                    }}
                  >
                    <Text style={styles.emoji}>{item.emoji}</Text>
                    <View style={pageStyles.rowCopy}>
                      <Text style={pageStyles.rowTitle}>{item.title}</Text>
                      <Text style={pageStyles.copy}>{item.description}</Text>
                      {item.status !== "suggested" && (
                        <Text style={styles.status}>
                          {t(ideaStatusLabels[item.status])}
                        </Text>
                      )}
                      {item.feedback === "more" && (
                        <Text style={pageStyles.copy}>
                          {t("More like this · saved")}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                  <IconButton
                    label={t("Feedback for {value1}", { value1: item.title })}
                    icon={Ellipsis}
                    onPress={() => {
                      start.reset();
                      feedback.reset();
                      setSelection({ id: item.id, feedbackOnly: true });
                    }}
                  />
                </View>
              ))}
          </View>
        ))}
        {ideas.hasNextPage && (
          <ActionButton
            quiet
            disabled={ideas.isFetchingNextPage}
            onPress={() => {
              void ideas.fetchNextPage();
            }}
          >
            {t("Show more")}
          </ActionButton>
        )}
      </CompanionPage>
      {selected && (
        <CompanionSheet
          title={selection?.feedbackOnly ? t("Idea feedback") : selected.title}
          onClose={() => {
            if (!pending) setSelection(undefined);
          }}
        >
          <IdeaDetail
            idea={selected}
            feedbackOnly={selection?.feedbackOnly ?? false}
            pending={pending}
            error={error}
            onStart={() => {
              if (selected.sessionId) onConversation(selected.sessionId);
              else start.mutate(selected.id);
            }}
            onFeedback={(value) => {
              feedback.mutate({ id: selected.id, feedback: value });
            }}
          />
        </CompanionSheet>
      )}
    </>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.line,
      paddingVertical: 12,
    },
    idea: {
      flex: 1,
      flexDirection: "row",
      gap: 14,
      paddingVertical: 4,
      paddingRight: 4,
    },
    emoji: { fontFamily: systemFont, fontSize: 28, width: 38, lineHeight: 38 },
    status: {
      fontFamily: systemFont,
      color: colors.accent,
      fontSize: 13,
      marginTop: 5,
    },
  });
}
