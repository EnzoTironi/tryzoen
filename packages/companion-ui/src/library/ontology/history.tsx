import { useState } from "react";
import type { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock } from "lucide-react-native";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { OntologyReadSchema } from "./schema";
import type { OntologyData } from "./collection";
import { ontologyReadOptions } from "./query";
import { CompanionSheet } from "../../sheet";
import { ActionButton } from "../../button";
import { pageStyles } from "../../page";
import { colors } from "../../theme";

export function OntologyHistory({
  data,
  view,
  onApply,
  onClose,
}: {
  readonly data: OntologyData;
  readonly view: z.output<typeof OntologyReadSchema>;
  readonly onApply: (value: z.output<typeof OntologyReadSchema>) => void;
  readonly onClose: () => void;
}) {
  const [revision, setRevision] = useState(view.revision);
  const [date, setDate] = useState(view.validOn ?? "");
  const cache = useQueryClient();
  const apply = useMutation({
    mutationFn: async (next: z.output<typeof OntologyReadSchema>) => {
      // Resolve before closing so a new view never relabels the old records or
      // replaces the collection with a loading screen. Cached views open locally.
      await cache.query(ontologyReadOptions(data, next));
      onApply(next);
    },
  });
  const history = useQuery({
    queryKey: [...data.cacheKey, "history"],
    queryFn: data.history,
    staleTime: 15_000,
  });
  const input = OntologyReadSchema.safeParse({
    revision,
    validOn: date.trim() || undefined,
  });
  const entries = history.isError ? undefined : history.data;
  return (
    <CompanionSheet title="Knowledge history" onClose={onClose}>
      <Text style={pageStyles.copy}>
        Choose what was recorded, then optionally filter the facts by when they
        held in the world. These are separate dates.
      </Text>
      <Text style={pageStyles.rowTitle}>Facts valid on</Text>
      <TextInput
        accessibilityLabel="Knowledge validity date"
        placeholder="YYYY-MM-DD"
        value={date}
        onChangeText={setDate}
        maxLength={10}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!apply.isPending}
        style={pageStyles.field}
      />
      {Boolean(date.trim()) && !input.success && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          Enter a valid date such as 2026-09-29.
        </Text>
      )}
      <Text style={pageStyles.copy}>
        Leave the date blank to show all facts. Unknown validity remains
        visible. The end date of an interval is exclusive. Historical views
        cannot change records.
      </Text>
      <ActionButton
        disabled={!input.success || apply.isPending}
        onPress={() => {
          if (input.success) apply.mutate(input.data);
        }}
      >
        {apply.isPending ? "Opening view…" : "Apply view"}
      </ActionButton>
      {apply.isError && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          This view could not be opened. Check your access and try again.
        </Text>
      )}
      <Text accessibilityRole="header" style={pageStyles.rowTitle}>
        Recorded versions
      </Text>
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel="Current knowledge"
        accessibilityState={{ checked: revision === undefined }}
        disabled={apply.isPending}
        onPress={() => {
          setRevision(undefined);
        }}
        style={styles.version}
      >
        <Clock size={20} color={colors.muted} />
        <Text style={[pageStyles.rowTitle, styles.title]}>
          Current knowledge
        </Text>
        {revision === undefined && <Check size={20} color={colors.ink} />}
      </Pressable>
      {history.isPending && (
        <Text style={pageStyles.copy}>Loading recorded versions…</Text>
      )}
      {history.isError && (
        <View style={styles.detail}>
          <Text accessibilityRole="alert" style={pageStyles.copy}>
            Recorded versions could not be loaded. Your access may have changed.
          </Text>
          <ActionButton
            quiet
            onPress={() => {
              void history.refetch();
            }}
          >
            Try history again
          </ActionButton>
        </View>
      )}
      {entries?.map((entry) => (
        <Pressable
          key={entry.revision}
          accessibilityRole="radio"
          accessibilityLabel={`Recorded version ${entry.revision.slice(0, 8)}`}
          accessibilityState={{ checked: entry.revision === revision }}
          disabled={apply.isPending}
          onPress={() => {
            setRevision(entry.revision);
          }}
          style={styles.version}
        >
          <View style={[styles.detail, styles.title]}>
            <Text style={pageStyles.rowTitle}>{entry.date}</Text>
            <Text style={pageStyles.copy}>
              {entry.source === "knowledge-publication"
                ? "Reviewed change"
                : "Record update"}
              {" · "}
              {entry.revision.slice(0, 8)}
            </Text>
          </View>
          {entry.revision === revision && (
            <Check size={20} color={colors.ink} />
          )}
        </Pressable>
      ))}
      {entries?.length === 0 && (
        <Text style={pageStyles.copy}>
          History begins with the first published records.
        </Text>
      )}
      {entries?.length === 50 && (
        <Text style={pageStyles.copy}>
          Showing the 50 most recent recorded versions.
        </Text>
      )}
    </CompanionSheet>
  );
}

const styles = StyleSheet.create({
  version: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 52,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  detail: { gap: 5 },
  title: { flex: 1 },
});
