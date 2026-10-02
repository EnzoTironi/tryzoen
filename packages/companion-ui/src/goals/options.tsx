import { useI18n } from "./../i18n";
import type { z } from "zod";
import { ChevronRight } from "lucide-react-native";
import { Pressable, Switch, Text, View } from "react-native";
import { CompanionSheet } from "../sheet";
import { usePageStyles } from "../page";
import { useColors } from "../theme";
import type {
  goalPreferencesSchema,
  goalPreferenceChangeSchema,
} from "./preferences";

export function GoalOptions({
  preferences,
  pending,
  error,
  onChange,
  onCompleted,
  onClose,
}: {
  readonly preferences: z.infer<typeof goalPreferencesSchema>;
  readonly pending: boolean;
  readonly error?: string;
  readonly onChange: (
    change: z.infer<typeof goalPreferenceChangeSchema>
  ) => void;
  readonly onCompleted: () => void;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const pageStyles = usePageStyles();
  return (
    <CompanionSheet title={t("Goal options")} onClose={onClose}>
      {(
        [
          ["showSubtitles", t("Show subtitles")],
          ["sortAutomatically", t("Sort automatically")],
        ] as const
      ).map(([key, label]) => (
        <View key={key} style={pageStyles.row}>
          <Text style={[pageStyles.rowTitle, { flex: 1 }]}>{label}</Text>
          <Switch
            accessibilityLabel={label}
            value={preferences[key]}
            disabled={pending}
            onValueChange={(value) => {
              onChange({ key, value });
            }}
            trackColor={{ true: colors.accent }}
          />
        </View>
      ))}
      <Text style={pageStyles.copy}>
        {t(
          "Automatic sorting puts recent activity first. Turn it off to sort by name."
        )}
      </Text>
      {error && (
        <Text accessibilityRole="alert" style={{ color: colors.danger }}>
          {error}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={onCompleted}
        style={pageStyles.row}
      >
        <Text style={[pageStyles.rowTitle, { flex: 1 }]}>
          {t("Completed goals")}
        </Text>
        <ChevronRight size={20} color={colors.muted} />
      </Pressable>
    </CompanionSheet>
  );
}
