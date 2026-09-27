import type { ComponentProps } from "react";
import { MessageCircle, SlidersHorizontal } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CompanionPage, pageStyles } from "./page";
import { IconButton } from "./icon-button";
import { ActionButton } from "./button";
import { AssistantMarkdown } from "./markdown";
import { colors } from "./theme";
export function Feed({
  items,
  onDiscuss,
  onCustomize,
  onLoadMore,
  ...state
}: Omit<ComponentProps<typeof CompanionPage>, "title" | "children"> & {
  readonly items: readonly {
    id: string;
    title: string;
    content: string;
    date: string;
  }[];
  readonly onDiscuss: (id: string) => void;
  readonly onCustomize: () => void;
  readonly onLoadMore?: () => void;
}) {
  return (
    <CompanionPage
      title="Feed"
      actions={
        <IconButton
          label="Customize feed"
          icon={SlidersHorizontal}
          onPress={onCustomize}
        />
      }
      {...state}
    >
      {items.map((item) => (
        <View key={item.id} style={styles.edition}>
          <Text accessibilityRole="header" style={pageStyles.heading}>
            {item.date}
          </Text>
          <Text style={pageStyles.rowTitle}>{item.title}</Text>
          <AssistantMarkdown text={item.content} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Discuss ${item.title}`}
            onPress={() => {
              onDiscuss(item.id);
            }}
            style={pageStyles.row}
          >
            <MessageCircle size={21} color={colors.ink} />
            <Text style={pageStyles.copy}>Discuss</Text>
          </Pressable>
        </View>
      ))}
      {!state.loading && !state.error && items.length === 0 && (
        <View style={pageStyles.empty}>
          <Text style={pageStyles.heading}>A feed shaped around you</Text>
          <Text style={pageStyles.copy}>
            Your completed briefings and scheduled updates appear here. Tell
            Zoen what you care about and when you want to hear about it.
          </Text>
          <ActionButton onPress={onCustomize}>Set up my feed</ActionButton>
        </View>
      )}
      {onLoadMore && (
        <ActionButton quiet onPress={onLoadMore}>
          Load more
        </ActionButton>
      )}
    </CompanionPage>
  );
}
const styles = StyleSheet.create({ edition: { gap: 12, paddingBottom: 40 } });
