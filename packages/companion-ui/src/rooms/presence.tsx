import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { z } from "zod";
import { systemFont, useColors } from "../theme";
import type { roomPresenceSchema } from "./schema";

export function PresenceIndicator({
  state,
}: {
  readonly state?: z.infer<typeof roomPresenceSchema>["state"];
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (!state || state === "offline") return null;
  return (
    <View style={styles.status}>
      <View
        style={[
          styles.dot,
          { backgroundColor: state === "online" ? "#248a3d" : "#a36b00" },
        ]}
      />
      <Text style={styles.caption}>
        {state === "online" ? "Online" : "Ausente"}
      </Text>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    caption: {
      fontFamily: systemFont,
      fontSize: 13,
      lineHeight: 18,
      color: colors.muted,
    },
    status: { flexDirection: "row", alignItems: "center", gap: 5 },
    dot: { width: 7, height: 7, borderRadius: 4 },
  });
}
