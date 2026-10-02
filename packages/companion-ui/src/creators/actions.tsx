import { useI18n } from "./../i18n";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import { ActionButton } from "../button";
import { usePageStyles } from "../page";
import type { creatorDraftSchema } from "./schema";
import type { CreatorStudioData } from "./studio";

export function CreatorDraftActions({
  draft,
  data,
  onChanged,
}: {
  readonly draft: z.infer<typeof creatorDraftSchema>;
  readonly data: CreatorStudioData;
  readonly onChanged: (draft: z.infer<typeof creatorDraftSchema>) => void;
}) {
  const { t } = useI18n();
  const pageStyles = usePageStyles();
  const archive = useMutation({
    mutationFn: () =>
      data.archive({
        id: draft.id,
        expectedRevision: draft.revision,
        archived: !draft.archivedAt,
      }),
    onSuccess: onChanged,
  });
  const download = useMutation({
    mutationFn: () => data.exportDraft(draft.id),
  });
  const busy = archive.isPending || download.isPending;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <ActionButton
          quiet
          disabled={busy}
          onPress={() => {
            download.mutate();
          }}
        >
          {download.isPending ? t("Preparing export…") : t("Export draft")}
        </ActionButton>
        <ActionButton
          quiet
          disabled={busy}
          onPress={() => {
            archive.mutate();
          }}
        >
          {archive.isPending
            ? t("Updating…")
            : draft.archivedAt
              ? t("Restore draft")
              : t("Archive draft")}
        </ActionButton>
      </View>
      <Text style={pageStyles.copy}>
        {t(
          "Archiving a draft does not end access to an approved pilot. Manage shared access in Private pilots."
        )}
      </Text>
      {(archive.error ?? download.error) && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          {archive.error?.message ??
            download.error?.message ??
            t("This draft could not be updated. Try again.")}
        </Text>
      )}
      {download.isSuccess && (
        <Text accessibilityLiveRegion="polite" style={pageStyles.copy}>
          {t("Your draft export is ready.")}
        </Text>
      )}
    </View>
  );
}
