import { useI18n, Translated } from "./../i18n";

import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import { MemoryCard } from "../cards/memory";
import { usePageStyles } from "../page";
import { LearnedClaimSearchInputSchema } from "./schema";
import { LearnedClaimProvenance } from "./provenance";
import type { LearnedNotesData } from "./data";

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
  data,
  claimId,
  cacheScope,
  onClose,
}: {
  readonly data: Pick<LearnedNotesData, "search" | "history">;
  readonly claimId?: string;
  readonly cacheScope: string;
  readonly onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const pageStyles = usePageStyles();
  const [query, setQuery] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [validOn, setValidOn] = useState("");
  const [validation, setValidation] = useState<string>();
  const [versionLimit, setVersionLimit] = useState(20);
  const search = useMutation({ mutationFn: data.search });
  const versions = useQuery({
    queryKey: ["companion-claim-history", cacheScope, claimId],
    enabled: Boolean(claimId),
    queryFn: () => {
      if (!claimId)
        throw new Error(t("Select a memory to inspect its recorded versions."));
      return data.history({ claimId });
    },
  });
  const asOf = localInstant(date, time);
  const timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const visible =
    search.isSuccess &&
    search.variables.query === query.trim() &&
    search.variables.view?.asOf === asOf &&
    search.variables.validOn === (validOn || undefined);
  if (claimId)
    return (
      <CompanionSheet title={t("Recorded memory versions")} onClose={onClose}>
        <Text style={pageStyles.copy}>
          {t(
            "These are recorded versions, including corrections and removal. They do not replace current automatic recall."
          )}
        </Text>
        {versions.isPending && (
          <Text style={pageStyles.copy}>{t("Loading recorded versions…")}</Text>
        )}
        {versions.isError && (
          <Text accessibilityRole="alert" style={pageStyles.copy}>
            {t("Recorded versions are unavailable under your current access.")}
          </Text>
        )}
        {!versions.isError &&
          versions.data?.versions.slice(0, versionLimit).map((claim) => (
            <MemoryCard
              key={`${claim.file.id}:${claim.revision}`}
              document={{
                title:
                  claim.file.state.kind === "tombstone"
                    ? t("Removed memory")
                    : t("Recorded memory"),
                text:
                  claim.file.state.kind === "active"
                    ? claim.file.state.body.text
                    : t("Removed from automatic recall."),
                updated: "",
              }}
            >
              <LearnedClaimProvenance claim={claim} />
            </MemoryCard>
          ))}
        {!versions.isError &&
          versions.data &&
          !versions.data.versions.length && (
            <Text style={pageStyles.copy}>
              {t("No recorded versions are available.")}
            </Text>
          )}
        {!versions.isError &&
          versions.data &&
          versions.data.versions.length > versionLimit && (
            <ActionButton
              quiet
              onPress={() => {
                setVersionLimit(versionLimit + 20);
              }}
            >
              {t("Show 20 more versions")}
            </ActionButton>
          )}
      </CompanionSheet>
    );
  return (
    <CompanionSheet title={t("Memory history")} onClose={onClose}>
      <Text style={pageStyles.copy}>
        {t(
          "Find what claims said at a recorded moment. Recorded time and world-valid dates are separate. A previously removed fact can appear in an earlier audit snapshot."
        )}
      </Text>
      <TextInput
        accessibilityLabel={t("Search memory history")}
        value={query}
        onChangeText={setQuery}
        placeholder={t("A topic, name or phrase")}
        maxLength={8000}
        style={pageStyles.field}
      />
      <View style={styles.row}>
        <View style={styles.field}>
          <Text style={pageStyles.rowTitle}>{t("Recorded date")}</Text>
          <TextInput
            accessibilityLabel={t("Memory recorded date")}
            value={date}
            onChangeText={setDate}
            placeholder={t("YYYY-MM-DD")}
            maxLength={10}
            autoCapitalize="none"
            style={pageStyles.field}
          />
        </View>
        <View style={styles.field}>
          <Text style={pageStyles.rowTitle}>{t("Recorded time")}</Text>
          <TextInput
            accessibilityLabel={t("Memory recorded time")}
            value={time}
            onChangeText={setTime}
            placeholder="14:30"
            maxLength={8}
            autoCapitalize="none"
            style={pageStyles.field}
          />
        </View>
      </View>
      <Text style={pageStyles.copy}>
        <Translated
          message="Your local recorded time · {value1}"
          values={{ value1: timezone }}
        />
      </Text>
      <TextInput
        accessibilityLabel={t("Optional world-valid date")}
        value={validOn}
        onChangeText={setValidOn}
        placeholder={t("World-valid date, optional · YYYY-MM-DD")}
        maxLength={10}
        autoCapitalize="none"
        style={pageStyles.field}
      />
      {Boolean(date && time) && !asOf && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          {t("Enter a valid recorded date and time.")}
        </Text>
      )}
      <ActionButton
        disabled={!query.trim() || !asOf || search.isPending}
        onPress={() => {
          if (!asOf) return;
          const parsed = LearnedClaimSearchInputSchema.safeParse({
            query: query.trim(),
            view: { asOf },
            ...(validOn ? { validOn } : {}),
          });
          if (!parsed.success) {
            setValidation(
              parsed.error.issues[0]?.message ??
                t("Review your query and dates.")
            );
            return;
          }
          setValidation(undefined);
          search.mutate(parsed.data);
        }}
      >
        {search.isPending ? t("Searching…") : t("Search this recorded moment")}
      </ActionButton>
      {validation && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          {validation}
        </Text>
      )}
      {search.isError && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          {t(
            "History is unavailable under current access. Personal pause does not prevent authorized historical review."
          )}
        </Text>
      )}
      {visible && (
        <View style={styles.results}>
          <Text accessibilityRole="header" style={pageStyles.heading}>
            <Translated
              message="Memory recorded by {value1}"
              values={{
                value1: asOf
                  ? new Date(asOf).toLocaleString(locale)
                  : t("the selected moment"),
              }}
            />
          </Text>
          <Text selectable style={pageStyles.copy}>
            <Translated
              message="Snapshot revision: {value1}"
              values={{ value1: search.data.revision ?? t("empty memory") }}
            />
          </Text>
          {!search.data.matches.length && (
            <Text style={pageStyles.copy}>
              {t("No matching claims were recorded at this moment.")}
            </Text>
          )}
          {search.data.matches.map(({ claim, validity }) => (
            <MemoryCard
              key={`${claim.file.id}:${claim.revision}`}
              document={{
                title: t("Historical memory"),
                text:
                  claim.file.state.kind === "active"
                    ? claim.file.state.body.text
                    : t("Removed from automatic recall."),
                updated: "",
              }}
            >
              <Text style={pageStyles.copy}>
                <Translated
                  message="World-valid filter: {value1}"
                  values={{
                    value1:
                      validity === "unknown"
                        ? t("unknown dates")
                        : validity === "in-range"
                          ? t("in range")
                          : t("not applied"),
                  }}
                />
              </Text>
              <LearnedClaimProvenance claim={claim} />
            </MemoryCard>
          ))}
          {search.data.hasMore && (
            <Text style={pageStyles.copy}>
              {t(
                "More matching claims exist. Refine the query; each result is bounded to eight matches."
              )}
            </Text>
          )}
          <Text style={pageStyles.copy}>
            {t(
              "This is an audit view, including retained prior facts where applicable. It does not restore removed memories or change current recall."
            )}
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
