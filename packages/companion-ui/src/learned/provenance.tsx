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
        {open ? "Hide evidence and dates" : "Evidence and dates"}
      </ActionButton>
      {open && (
        <View style={{ gap: 8 }}>
          <Text selectable style={styles.copy}>
            Recorded: {claim.recordedAt}
          </Text>
          <Text selectable style={styles.copy}>
            Revision: {claim.revision}
          </Text>
          <Text selectable style={styles.copy}>
            Attributed to: {claim.authorUserId}
          </Text>
          {state.kind === "tombstone" ? (
            <Text style={styles.copy}>
              Removed from automatic recall. This recorded version remains in
              the audit history.
            </Text>
          ) : (
            <>
              <Text style={styles.copy}>
                {state.body.validTime
                  ? `World-valid dates: ${state.body.validTime.from ?? "unknown start"} to ${state.body.validTime.until ?? "unknown end"} (end excluded).`
                  : "World-valid dates: unknown."}
              </Text>
              {!state.body.sources.length && (
                <Text style={styles.copy}>No cited evidence.</Text>
              )}
              {state.body.sources.map((source) => (
                <View key={JSON.stringify(source)} style={{ gap: 4 }}>
                  <Text selectable style={styles.copy}>
                    {source.kind === "file"
                      ? `File: ${source.path} · ${source.revision}`
                      : `Conversation: ${source.sessionId} · event ${source.eventId} · SHA-256 ${source.sha256}`}
                  </Text>
                  <Text selectable style={styles.copy}>
                    {source.excerpt}
                  </Text>
                </View>
              ))}
              {!!state.body.sources.length && (
                <Text style={styles.copy}>
                  Citations identify verified references. They do not prove that
                  a claim is true.
                </Text>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}
