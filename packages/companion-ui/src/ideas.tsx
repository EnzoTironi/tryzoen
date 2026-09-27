import {
  useWindowDimensions,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CompanionPage, pageStyles } from "./page";
import { colors } from "./theme";

export function Ideas({
  items,
  onChoose,
}: {
  readonly items: readonly {
    id: string;
    title: string;
    description: string;
    category: string;
    prompt: string;
    imageUri?: string;
  }[];
  readonly onChoose: (prompt: string) => void;
}) {
  const compact = useWindowDimensions().width < 720;
  const categories = [...new Set(items.map((item) => item.category))];
  return (
    <CompanionPage title="Ideas">
      {categories.map((category, index) => (
        <View key={category} style={index > 0 && pageStyles.section}>
          {category !== "Featured" && (
            <Text accessibilityRole="header" style={pageStyles.heading}>
              {category}
            </Text>
          )}
          {items
            .filter((item) => item.category === category)
            .map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.title}
                onPress={() => {
                  onChoose(item.prompt);
                }}
                style={({ pressed }) => [
                  styles.idea,
                  pressed && styles.pressed,
                ]}
              >
                {item.imageUri && (
                  <Image source={{ uri: item.imageUri }} style={styles.art} />
                )}
                <View style={pageStyles.rowCopy}>
                  <Text style={pageStyles.rowTitle}>{item.title}</Text>
                  <Text
                    numberOfLines={compact ? 4 : undefined}
                    style={pageStyles.copy}
                  >
                    {item.description}
                  </Text>
                </View>
              </Pressable>
            ))}
        </View>
      ))}
    </CompanionPage>
  );
}
const styles = StyleSheet.create({
  idea: {
    flexDirection: "row",
    gap: 16,
    paddingVertical: 14,
    marginBottom: 8,
    alignItems: "flex-start",
  },
  art: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.wash,
  },
  pressed: { opacity: 0.6 },
});
