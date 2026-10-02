import { useI18n } from "./../i18n";
import { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Archive, ArrowLeft, Plus, Ellipsis, X } from "lucide-react-native";
import { usePageStyles } from "../page";
import { IconButton } from "../icon-button";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { systemFont, useColors } from "../theme";

export function ConversationToolbar({
  title,
  intro,
  query,
  onQuery,
  archived,
  onToggleArchive,
  onCreate,
  panel,
}: {
  readonly title: string;
  readonly intro?: string;
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly archived: boolean;
  readonly onToggleArchive: () => void;
  readonly onCreate?: () => void;
  readonly panel?: {
    readonly onClose: () => void;
  };
}) {
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
  const [options, setOptions] = useState(false);
  const showArchive = () => {
    onToggleArchive();
    setOptions(false);
  };
  const search = (
    <TextInput
      accessibilityLabel={t("Search conversations")}
      placeholder={t("Search conversations")}
      value={query}
      onChangeText={onQuery}
      maxLength={200}
      style={[pageStyles.field, panel && styles.panelSearch]}
    />
  );
  return (
    <>
      {panel && (
        <View style={styles.searchRow}>
          {search}
          <IconButton
            icon={archived ? ArrowLeft : Ellipsis}
            label={
              archived
                ? t("Back to conversations")
                : t("Conversation panel options")
            }
            onPress={
              archived
                ? showArchive
                : () => {
                    setOptions(true);
                  }
            }
          />
        </View>
      )}
      <View style={[styles.header, panel && styles.panelHeader]}>
        <Text
          accessibilityRole="header"
          numberOfLines={panel ? 1 : undefined}
          style={[styles.title, panel && styles.panelTitle]}
        >
          {archived ? t("Archived conversations") : title}
        </Text>
        <View style={styles.actions}>
          {!panel && (
            <IconButton
              icon={archived ? ArrowLeft : Archive}
              label={
                archived
                  ? t("Back to conversations")
                  : t("Show archived conversations")
              }
              onPress={showArchive}
            />
          )}
          {!archived && onCreate && (
            <IconButton
              icon={Plus}
              label={t("New conversation")}
              onPress={onCreate}
            />
          )}
          {panel && (
            <IconButton
              icon={X}
              label={t("Close conversations")}
              onPress={panel.onClose}
            />
          )}
        </View>
      </View>
      {intro && !archived && <Text style={pageStyles.copy}>{intro}</Text>}
      {!panel && search}

      {options && (
        <CompanionSheet
          title={t("Conversation panel options")}
          onClose={() => {
            setOptions(false);
          }}
        >
          <ActionButton quiet onPress={showArchive}>
            {t("Show archived conversations")}
          </ActionButton>
        </CompanionSheet>
      )}
    </>
  );
}
function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      marginBottom: 16,
    },
    title: {
      fontFamily: systemFont,
      fontSize: 34,
      lineHeight: 40,
      fontWeight: "600",
      letterSpacing: -1.1,
      color: colors.ink,
      flexShrink: 1,
      minWidth: 0,
    },
    panelTitle: {
      fontFamily: systemFont,
      fontSize: 14,
      lineHeight: 20,
      letterSpacing: 0,
      paddingLeft: 8,
    },
    panelSearch: {
      fontFamily: systemFont,
      flex: 1,
      minWidth: 0,
      fontSize: 14,
      padding: 10,
      marginBottom: 0,
      borderRadius: 22,
    },
    searchRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
    panelHeader: { marginBottom: 4, gap: 0 },
    actions: { flexDirection: "row" },
  });
}
