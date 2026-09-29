import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import { MemoryCard } from "../cards/memory";
import { pageStyles } from "../page";
import type { LearnedNotesData } from "./notes";

function localInstant(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(:\d{2})?$/.test(time))
    return null;
  const value = new Date(`${date}T${time}`);
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second = 0] = time.split(":").map(Number);
  if (
    !Number.isFinite(value.getTime()) ||
    value.getFullYear() !== year ||
    value.getMonth() + 1 !== month ||
    value.getDate() !== day ||
    value.getHours() !== hour ||
    value.getMinutes() !== minute ||
    value.getSeconds() !== second
  )
    return null;
  return value.toISOString();
}

export function MemoryHistory({
  load,
  onClose,
}: {
  readonly load: LearnedNotesData["history"];
  readonly onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const search = useMutation({ mutationFn: load });
  const asOf = localInstant(date, time);
  const timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const visible =
    search.isSuccess &&
    search.variables.query === query.trim() &&
    search.variables.asOf === asOf;
  return (
    <CompanionSheet title="Memory history" onClose={onClose}>
      <Text style={pageStyles.copy}>
        Find what your learned notes said at a past moment. Dates describe when
        Zoen recorded a version, not when a fact happened in the world.
      </Text>
      <Text style={pageStyles.rowTitle}>Search your notes</Text>
      <TextInput
        accessibilityLabel="Search memory history"
        value={query}
        onChangeText={setQuery}
        placeholder="A topic, name or phrase"
        maxLength={8000}
        style={pageStyles.field}
      />
      <View style={styles.row}>
        <View style={styles.field}>
          <Text style={pageStyles.rowTitle}>Date</Text>
          <TextInput
            accessibilityLabel="Memory history date"
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            maxLength={10}
            autoCapitalize="none"
            style={pageStyles.field}
          />
        </View>
        <View style={styles.field}>
          <Text style={pageStyles.rowTitle}>Time</Text>
          <TextInput
            accessibilityLabel="Memory history time"
            value={time}
            onChangeText={setTime}
            placeholder="14:30"
            maxLength={8}
            autoCapitalize="none"
            style={pageStyles.field}
          />
        </View>
      </View>
      <Text style={pageStyles.copy}>Your local time · {timezone}</Text>
      {Boolean(date && time) && !asOf && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          Enter a valid date and time, for example 2026-09-28 and 14:30.
        </Text>
      )}
      <ActionButton
        disabled={!query.trim() || !asOf || search.isPending}
        onPress={() => {
          if (asOf) search.mutate({ query: query.trim(), asOf });
        }}
      >
        {search.isPending ? "Searching…" : "Search this moment"}
      </ActionButton>
      {search.isError && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          History is unavailable. Check that memory is active and any unfinished
          update has been reviewed, then try again.
        </Text>
      )}
      {visible && (
        <View style={styles.results}>
          <Text accessibilityRole="header" style={pageStyles.heading}>
            Memory at {new Date(search.data.asOf).toLocaleString()}
          </Text>
          {search.data.hits.length === 0 && (
            <Text style={pageStyles.copy}>
              No matching notes were recorded at this moment.
            </Text>
          )}
          {search.data.hits.map((hit) => (
            <MemoryCard
              key={hit.versionId}
              document={{ title: hit.title, text: hit.excerpt, updated: "" }}
            >
              <Text style={pageStyles.copy}>Historical excerpt</Text>
            </MemoryCard>
          ))}
          <Text style={pageStyles.copy}>
            These are matching excerpts from saved versions. They do not replace
            your current notes. Removed notes are excluded.
          </Text>
        </View>
      )}
    </CompanionSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 16 },
  field: { flex: 1, gap: 8 },
  results: { gap: 16, marginTop: 16 },
});
