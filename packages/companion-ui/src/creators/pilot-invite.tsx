import { Toggle } from "../controls";
import { useI18n } from "./../i18n";
import { useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import type { creatorReleaseSchema } from "./schema";
import type { CreatorStudioData } from "./studio";
import { CreatorReleaseEvidence } from "./release-evidence";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { usePageStyles } from "../page";

export function CreatorPilotInvite({
  release,
  data,
  onClose,
}: {
  readonly release: z.infer<typeof creatorReleaseSchema>;
  readonly data: CreatorStudioData;
  readonly onClose: () => void;
}) {
  const { t, errorText } = useI18n();
  const pageStyles = usePageStyles();
  const [username, setUsername] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const requestId = useRef<string | undefined>(undefined);
  const invite = useMutation({
    mutationFn: () => {
      if (!confirmed)
        throw new Error(t("Confirm permission to share this teaching."));
      requestId.current ??= data.newId();
      return data.invitePilot({
        id: requestId.current,
        releaseId: release.id,
        username,
        shareTeaching: true,
      });
    },
  });
  return (
    <CompanionSheet
      title={t("Invite to a private pilot")}
      onClose={() => {
        if (!invite.isPending) onClose();
      }}
    >
      <Text style={pageStyles.copy}>
        {t(
          "Choose a person already in this workspace. If they accept, they can read this exact playbook and its examples and try the AI using their selected model. Evaluation cases and approval notes remain private."
        )}
      </Text>
      <Text style={pageStyles.copy}>
        {t(
          "Their questions, responses and reviews remain private to them. Either person can end access. Copies already read or exported cannot be recalled. This pilot does not grant access to personal memory, other conversations or tools."
        )}
      </Text>
      <CreatorReleaseEvidence content={release.content} />
      <TextInput
        accessibilityLabel={t("Pilot participant username")}
        placeholder={t("Their username, without @")}
        autoCapitalize="none"
        maxLength={30}
        value={username}
        editable={!invite.isPending && !invite.isSuccess}
        style={pageStyles.field}
        onChangeText={(value) => {
          setUsername(value.trim().toLowerCase());
          requestId.current = undefined;
        }}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Toggle
          accessibilityLabel={t(
            "I have permission to share this playbook and every listed example with this person"
          )}
          value={confirmed}
          disabled={invite.isPending || invite.isSuccess}
          onValueChange={setConfirmed}
        />
        <Text style={[pageStyles.copy, { flex: 1 }]}>
          {t(
            "I have permission to share this playbook and every listed example with this person."
          )}
        </Text>
      </View>
      <ActionButton
        disabled={
          !confirmed ||
          !/^[a-z][a-z0-9_]{2,29}$/.test(username) ||
          invite.isPending ||
          invite.isSuccess
        }
        onPress={() => {
          invite.mutate();
        }}
      >
        {invite.isPending
          ? t("Saving invitation…")
          : t("Invite to this approved version")}
      </ActionButton>
      {invite.isSuccess && (
        <Text accessibilityLiveRegion="polite" style={pageStyles.copy}>
          {t(
            "Invitation saved. They can accept it in Creator studio → Private pilots. No email or message was sent."
          )}
        </Text>
      )}
      {invite.error && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          {errorText(invite.error.message)}
        </Text>
      )}
    </CompanionSheet>
  );
}
