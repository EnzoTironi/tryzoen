import { useI18n } from "./../i18n";
import { useMemo, useState, type ReactNode, type ComponentProps } from "react";
import type { GoalRow } from "./row";
import { Ellipsis, X } from "lucide-react-native";
import {
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { IconButton } from "../icon-button";
import { SheetSurface } from "../sheet";
import { usePageStyles } from "../page";
import { systemFont, useColors } from "../theme";
import type { GoalsData } from "./collection";
import { GoalActions } from "./actions";
import { GoalActivity } from "./activity";

export function GoalDetail({
  goal,
  subgoals,
  data,
  cacheScope,
  onChanged,
  onClose,
  onPrompt,
}: {
  readonly goal: ComponentProps<typeof GoalRow>["item"] & {
    revision: number;
    objective: string;
    notes: string;
    reference: string;
  };
  readonly subgoals: readonly ReactNode[] | undefined;
  readonly data: GoalsData;
  readonly cacheScope: string;
  readonly onChanged: () => Promise<void>;
  readonly onClose: () => void;
  readonly onPrompt: (prompt: string) => void;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
  const [menu, setMenu] = useState(false);
  const compact = useWindowDimensions().width < 720;
  return (
    <SheetSurface
      title={goal.title}
      onClose={onClose}
      panelStyle={compact && styles.compactSheet}
    >
      <View style={[styles.header, compact && styles.compactHeader]}>
        <Text
          accessibilityRole="header"
          style={[styles.heading, compact && styles.compactHeading]}
        >
          {goal.title}
        </Text>
        <View style={styles.roundControl}>
          <IconButton
            label={t("Goal actions")}
            icon={Ellipsis}
            onPress={() => {
              setMenu(true);
            }}
          />
        </View>
        <View style={styles.roundControl}>
          <IconButton
            label={t("Close goal details")}
            icon={X}
            onPress={onClose}
          />
        </View>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.objective, compact && styles.compactObjective]}>
          {goal.objective}
        </Text>
        {Boolean(subgoals?.length) && (
          <View>
            <Text style={pageStyles.heading}>{t("Subgoals")}</Text>
            {subgoals}
          </View>
        )}
        <GoalActivity
          data={data}
          id={goal.id}
          revision={goal.revision}
          cacheScope={cacheScope}
        />
      </ScrollView>
      {menu && (
        <GoalActions
          goal={goal}
          data={data}
          onChanged={onChanged}
          onClose={() => {
            setMenu(false);
          }}
          onPrompt={(prompt) => {
            onClose();
            onPrompt(prompt);
          }}
        />
      )}
    </SheetSurface>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "center",
      padding: 24,
      gap: 12,
    },
    heading: {
      fontFamily: systemFont,
      flex: 1,
      color: colors.ink,
      fontSize: 22,
      lineHeight: 29,
      fontWeight: "600",
    },
    content: { padding: 24, paddingTop: 0, gap: 20 },
    objective: {
      fontFamily: systemFont,
      color: colors.muted,
      fontSize: 16,
      lineHeight: 23,
      marginBottom: 8,
    },
    roundControl: {
      borderRadius: 22,
      backgroundColor: colors.surface,
      boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
    },
    compactSheet: { maxHeight: "83%" },
    compactHeader: {
      alignItems: "flex-start",
      paddingTop: 12,
      paddingBottom: 12,
    },
    compactHeading: {
      fontFamily: systemFont,
      fontSize: 18,
      lineHeight: 26,
      paddingTop: 6,
    },
    compactObjective: { fontFamily: systemFont, fontSize: 14, lineHeight: 20 },
  });
}
