import { useI18n, Translated } from "./../i18n";

import { useState } from "react";
import { Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { CreatorStudioData } from "./studio";
import { CreatorPilot } from "./pilot";
import { CreatorPilotFeedback } from "./pilot-feedback";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { usePageStyles } from "../page";

export function CreatorPilots({
  data,
  cacheScope,
}: {
  readonly data: CreatorStudioData;
  readonly cacheScope: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionButton
        quiet
        onPress={() => {
          setOpen(true);
        }}
      >
        {t("Private pilots")}
      </ActionButton>
      {open && (
        <PilotInvitations
          data={data}
          cacheScope={cacheScope}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function PilotInvitations({
  data,
  cacheScope,
  onClose,
}: {
  readonly data: CreatorStudioData;
  readonly cacheScope: string;
  readonly onClose: () => void;
}) {
  const { t, errorText } = useI18n();
  const pageStyles = usePageStyles();
  const [selected, setSelected] = useState<string>();
  const [ending, setEnding] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const pilots = useQuery({
    queryKey: ["creator-pilots", cacheScope],
    queryFn: data.pilots,
  });
  const action = useMutation({
    mutationFn: data.actOnPilot,
    onSuccess: () => {
      setEnding(undefined);
    },
    onSettled: () => {
      void pilots.refetch();
    },
  });
  return (
    <CompanionSheet title={t("Private pilots")} onClose={onClose}>
      <Text style={pageStyles.copy}>
        {t(
          "Try an explicitly shared version of a creator’s AI. Accepting shares no conversations or personal memory. Your questions, answers and reviews stay private to you. Access ends if either person withdraws or leaves this workspace."
        )}
      </Text>
      {pilots.isPending && (
        <Text style={pageStyles.copy}>{t("Loading pilots…")}</Text>
      )}
      {pilots.isError && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          {t("Pilots could not be loaded.")}
        </Text>
      )}
      <ActionButton
        quiet
        onPress={() => {
          void pilots.refetch();
        }}
      >
        {t("Refresh pilots")}
      </ActionButton>
      {action.error && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          {errorText(action.error.message)}
        </Text>
      )}
      {!pilots.isError &&
        pilots.data?.map((pilot) => (
          <View key={pilot.id} style={{ gap: 8, paddingVertical: 12 }}>
            <Text style={pageStyles.rowTitle}>
              <Translated
                message="{value1} · AI"
                values={{ value1: pilot.title }}
              />
            </Text>
            <Text style={pageStyles.copy}>
              {pilot.isCreator
                ? t("For {value1}", { value1: pilot.recipientName })
                : t("From {value1}", { value1: pilot.creatorName })}{" "}
              · {t(pilot.status)}
            </Text>
            <Text style={pageStyles.copy}>{pilot.description}</Text>
            {pilot.status === "pending" && !pilot.isCreator && (
              <>
                <Text style={pageStyles.copy}>
                  {t(
                    "If you accept, the selected teaching and each question you submit will be processed by your chosen model. Previous conversations are not included."
                  )}
                </Text>
                <ActionButton
                  disabled={action.isPending}
                  onPress={() => {
                    action.mutate({ id: pilot.id, action: "accept" });
                  }}
                >
                  {t("Accept private pilot")}
                </ActionButton>
                <ActionButton
                  quiet
                  disabled={action.isPending}
                  onPress={() => {
                    action.mutate({ id: pilot.id, action: "decline" });
                  }}
                >
                  {t("Decline invitation")}
                </ActionButton>
              </>
            )}
            {pilot.status === "active" && !pilot.isCreator && (
              <ActionButton
                onPress={() => {
                  setSelected(pilot.id);
                }}
              >
                {t("Open pilot")}
              </ActionButton>
            )}
            {(pilot.status === "active" || pilot.status === "withdrawn") && (
              <ActionButton
                quiet
                onPress={() => {
                  setFeedback(pilot.id);
                }}
              >
                {t("Feedback shared with creator")}
              </ActionButton>
            )}
            {(pilot.status === "pending" || pilot.status === "active") && (
              <ActionButton
                quiet
                disabled={action.isPending}
                onPress={() => {
                  setEnding(pilot.id);
                }}
              >
                {t("End access")}
              </ActionButton>
            )}
          </View>
        ))}
      {pilots.data?.length === 0 && (
        <Text style={pageStyles.copy}>
          {t(
            "No pilots yet. Invite someone from an approved version, or accept an invitation here."
          )}
        </Text>
      )}
      {ending && (
        <CompanionSheet
          title={t("End pilot access?")}
          onClose={() => {
            if (!action.isPending) setEnding(undefined);
          }}
        >
          <Text style={pageStyles.copy}>
            {t(
              "The participant will no longer be able to open the teaching, read saved pilot results or start new runs. A result still being generated will not be saved after withdrawal. Copies already read or exported cannot be recalled. Feedback you explicitly submitted to the creator remains readable while both people stay in this workspace."
            )}
          </Text>
          <ActionButton
            disabled={action.isPending}
            onPress={() => {
              action.mutate({ id: ending, action: "withdraw" });
            }}
          >
            {t("End this pilot")}
          </ActionButton>
          {action.error && (
            <Text accessibilityRole="alert" style={pageStyles.copy}>
              {errorText(action.error.message)}
            </Text>
          )}
        </CompanionSheet>
      )}
      {selected && (
        <CreatorPilot
          id={selected}
          data={data}
          cacheScope={cacheScope}
          onClose={() => {
            setSelected(undefined);
            void pilots.refetch();
          }}
        />
      )}
      {feedback && (
        <CreatorPilotFeedback
          id={feedback}
          data={data}
          cacheScope={cacheScope}
          onClose={() => {
            setFeedback(undefined);
          }}
        />
      )}
    </CompanionSheet>
  );
}
