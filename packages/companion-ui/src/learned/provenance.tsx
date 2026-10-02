import { useI18n, Translated } from "./../i18n";

import { useState } from "react";
import { Text, View } from "react-native";
import type { z } from "zod";
import type { LearnedClaimVersionSchema } from "./schema";
import { ActionButton } from "../button";
import { usePageStyles } from "../page";

export function LearnedClaimProvenance({
  claim,
  initiallyOpen = false,
}: {
  readonly claim: z.output<typeof LearnedClaimVersionSchema>;
  readonly initiallyOpen?: boolean;
}) {
  const { t } = useI18n();
  const styles = usePageStyles();
  const [open, setOpen] = useState(initiallyOpen);
  const state = claim.file.state;
  return (
    <View>
      <ActionButton
        quiet
        onPress={() => {
          setOpen(!open);
        }}
      >
        {open ? t("Hide evidence and dates") : t("Evidence and dates")}
      </ActionButton>
      {open && (
        <View style={{ gap: 8 }}>
          <Text selectable style={styles.copy}>
            <Translated
              message="Recorded: {value1}"
              values={{ value1: claim.recordedAt }}
            />
          </Text>
          <Text selectable style={styles.copy}>
            <Translated
              message="Revision: {value1}"
              values={{ value1: claim.revision }}
            />
          </Text>
          <Text selectable style={styles.copy}>
            <Translated
              message="Attributed to: {value1}"
              values={{ value1: claim.authorUserId }}
            />
          </Text>
          {state.kind === "tombstone" ? (
            <Text style={styles.copy}>
              {t(
                "Removed from automatic recall. This recorded version remains in the audit history."
              )}
            </Text>
          ) : (
            <>
              <Text style={styles.copy}>
                {state.body.validTime
                  ? t(
                      "World-valid dates: {value1} to {value2} (end excluded).",
                      {
                        value1: state.body.validTime.from ?? t("unknown start"),
                        value2: state.body.validTime.until ?? t("unknown end"),
                      }
                    )
                  : t("World-valid dates: unknown.")}
              </Text>
              {!state.body.sources.length && (
                <Text style={styles.copy}>{t("No cited evidence.")}</Text>
              )}
              {state.body.sources.map((source) => (
                <View key={JSON.stringify(source)} style={{ gap: 4 }}>
                  <Text selectable style={styles.copy}>
                    {source.kind === "file"
                      ? t("File: {value1} · {value2}", {
                          value1: source.path,
                          value2: source.revision,
                        })
                      : t(
                          "Conversation: {value1} · event {value2} · SHA-256 {value3}",
                          {
                            value1: source.sessionId,
                            value2: source.eventId,
                            value3: source.sha256,
                          }
                        )}
                  </Text>
                  <Text selectable style={styles.copy}>
                    {source.excerpt}
                  </Text>
                </View>
              ))}
              {!!state.body.sources.length && (
                <Text style={styles.copy}>
                  {t(
                    "Citations identify verified references. They do not prove that a claim is true."
                  )}
                </Text>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}
