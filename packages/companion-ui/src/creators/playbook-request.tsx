import { useI18n, Translated } from "./../i18n";

import { useRef, useState } from "react";
import { Text, TextInput } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import type { creatorDraftSchema } from "./schema";
import type { CreatorStudioData } from "./studio";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { usePageStyles } from "../page";

export function CreatorPlaybookRequest({
  draft,
  data,
  disabled,
  onRefresh,
}: {
  readonly draft: z.infer<typeof creatorDraftSchema>;
  readonly data: CreatorStudioData;
  readonly disabled: boolean;
  readonly onRefresh: () => Promise<unknown>;
}) {
  const { t, errorText } = useI18n();
  const pageStyles = usePageStyles();
  const [open, setOpen] = useState(false);
  const [guidance, setGuidance] = useState(
    "Turn these examples into a playbook of useful strategies, the context each needs, alternatives and limits. Credit the examples and flag what still needs validation."
  );
  const requestId = useRef<string | undefined>(undefined);
  const generate = useMutation({
    mutationFn: () => {
      requestId.current ??= data.newId();
      return data.preview({
        id: requestId.current,
        draftId: draft.id,
        revision: draft.revision,
        kind: "playbook",
        question: guidance,
      });
    },
    onSuccess: () => {
      requestId.current = undefined;
      setOpen(false);
    },
    onSettled: () => {
      void onRefresh();
    },
  });
  return (
    <>
      <ActionButton
        quiet
        disabled={disabled || !draft.content.examples.length}
        onPress={() => {
          setOpen(true);
        }}
      >
        {t("Draft a playbook from my examples")}
      </ActionButton>
      {!draft.content.examples.length && (
        <Text style={pageStyles.copy}>
          {t("Add an authored example to draft a playbook.")}
        </Text>
      )}
      {open && (
        <CompanionSheet
          title={t("Draft a playbook")}
          onClose={() => {
            if (!generate.isPending) setOpen(false);
          }}
        >
          <Text style={pageStyles.copy}>
            {t(
              "Your selected model will use the examples listed below and your guidance. It receives no existing playbook, evaluation cases, personal memory, conversations or tools. Review and edit the proposal before choosing to replace your playbook."
            )}
          </Text>
          {draft.content.examples.map((example) => (
            <Text key={example.id} style={pageStyles.copy}>
              {example.title} · {example.source}
            </Text>
          ))}
          <TextInput
            accessibilityLabel={t("Playbook guidance")}
            multiline
            maxLength={4000}
            value={guidance}
            editable={!generate.isPending}
            style={[pageStyles.field, { minHeight: 140 }]}
            onChangeText={(value) => {
              setGuidance(value);
              requestId.current = undefined;
            }}
          />
          <ActionButton
            disabled={generate.isPending || !guidance.trim() || disabled}
            onPress={() => {
              generate.mutate();
            }}
          >
            {generate.isPending
              ? t("Starting proposal…")
              : t("Generate private proposal")}
          </ActionButton>
          {generate.error && (
            <Text accessibilityRole="alert" style={pageStyles.copy}>
              <Translated
                message="{value1} Any accepted proposal will appear in the saved results."
                values={{ value1: errorText(generate.error.message) }}
              />
            </Text>
          )}
        </CompanionSheet>
      )}
    </>
  );
}
