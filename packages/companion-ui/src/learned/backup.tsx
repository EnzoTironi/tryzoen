import { useMutation } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { ActionButton } from "../button";
import { pageStyles } from "../page";

export function MemoryBackup({
  disabled,
  onBackup,
}: {
  readonly disabled: boolean;
  readonly onBackup: () => Promise<void>;
}) {
  const backup = useMutation({ mutationFn: onBackup });
  return (
    <View style={pageStyles.section}>
      <Text accessibilityRole="header" style={pageStyles.heading}>
        Keep a copy
      </Text>
      <Text style={pageStyles.copy}>
        Download your learned notes, relationships and history for this
        workspace. Conversations, profile and workspace files are exported
        separately. The copy can include older versions and previously removed
        notes.
      </Text>
      <ActionButton
        quiet
        disabled={backup.isPending || disabled}
        onPress={() => {
          backup.mutate();
        }}
      >
        {backup.isPending ? "Preparing backup…" : "Download memory backup"}
      </ActionButton>
      {backup.error && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          The backup couldn’t be downloaded. Check your connection and try
          again.
        </Text>
      )}
    </View>
  );
}
