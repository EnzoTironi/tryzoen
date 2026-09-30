import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Text, TextInput } from "react-native";
import { OntologyReadSchema } from "./schema";
import type { OntologyData } from "./collection";
import { ontologyReadOptions } from "./query";
import { localRecordedMinute, parseRecordedMinute } from "./time-input";
import { OntologyVersions } from "./versions";
import { CompanionSheet } from "../../sheet";
import { ActionButton } from "../../button";
import { usePageStyles } from "../../page";

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
  const pageStyles = usePageStyles();
  const [revision, setRevision] = useState(view.revision);
  const [time, setTime] = useState(
    view.asOf ? localRecordedMinute(view.asOf) : ""
  );
  const [date, setDate] = useState(view.validOn ?? "");
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const cache = useQueryClient();
  const apply = useMutation({
    mutationFn: async (next: z.output<typeof OntologyReadSchema>) => {
      // Resolve before closing so a new view never relabels the old records or
      // replaces the collection with a loading screen. Cached views open locally.
      await cache.query(ontologyReadOptions(data, next));
      if (open.current) onApply(next);
    },
  });
  const hasTime = Boolean(time.trim());
  const asOf = hasTime ? parseRecordedMinute(time) : undefined;
  const input = OntologyReadSchema.safeParse({
    revision,
    asOf,
    validOn: date.trim() || undefined,
  });
  return (
    <CompanionSheet title="Knowledge history" onClose={onClose}>
      <Text style={pageStyles.copy}>
        Choose what was recorded, then optionally filter the facts by when they
        held in the world. These are separate dates.
      </Text>
      <Text style={pageStyles.rowTitle}>Recorded on or before</Text>
      <TextInput
        accessibilityLabel="Knowledge recorded time"
        placeholder="YYYY-MM-DD HH:mm"
        value={time}
        onChangeText={(value) => {
          setTime(value);
          setRevision(undefined);
        }}
        maxLength={16}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!apply.isPending}
        style={pageStyles.field}
      />
      <Text style={pageStyles.copy}>
        Time zone: {new Intl.DateTimeFormat().resolvedOptions().timeZone}. Leave
        blank to use a version below. If your clock repeats an hour, choose a
        recorded version.
      </Text>
      {hasTime && asOf === null && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          Enter a valid local day and time, such as 2026-09-30 10:30.
        </Text>
      )}
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
      {Boolean(date.trim()) &&
        !OntologyReadSchema.shape.validOn.safeParse(date.trim()).success && (
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
      <OntologyVersions
        data={data}
        revision={revision}
        hasTime={hasTime}
        disabled={apply.isPending}
        onSelect={(value) => {
          setRevision(value);
          setTime("");
        }}
      />
    </CompanionSheet>
  );
}
