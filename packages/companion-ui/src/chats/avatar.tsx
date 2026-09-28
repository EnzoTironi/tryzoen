import { Image, StyleSheet, Text, View } from "react-native";
import { Users } from "lucide-react-native";
import { colors } from "../theme";

export function ConversationAvatar({
  name,
  uri,
  group = false,
  size = 44,
}: {
  readonly name: string;
  readonly uri?: string;
  readonly group?: boolean;
  readonly size?: number;
}) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
        group && styles.group,
      ]}
    >
      {uri ? (
        <Image
          accessibilityIgnoresInvertColors
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
        />
      ) : group ? (
        <Users size={size / 2} color="#497a6b" />
      ) : (
        <Text style={styles.letter}>
          {name.trim().slice(0, 1).toUpperCase()}
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e5ecfb",
    flexShrink: 0,
  },
  group: { backgroundColor: "#e6f0e9" },
  letter: { color: colors.accent, fontSize: 19, fontWeight: "600" },
});
