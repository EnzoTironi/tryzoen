import { useI18n, Translated } from "./../i18n";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { ActionButton } from "../button";
import { usePageStyles } from "../page";
import type { LearnedNotesData, MemoryArchiveReview } from "./data";

export function MemoryBackup({
  disabled,
  data,
  onRestored,
}: {
  readonly disabled: boolean;
  readonly data: LearnedNotesData["archives"];
  readonly onRestored: () => Promise<void>;
}) {
  const { t, locale, errorText } = useI18n();
  const pageStyles = usePageStyles();
  const [review, setReview] = useState<MemoryArchiveReview>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(
    () => () => {
      void review?.dispose().catch(() => {
        console.warn("Could not remove a temporary private memory archive.");
      });
    },
    [review]
  );
  const backup = useMutation({ mutationFn: data.backup });
  const inspect = useMutation({
    mutationFn: data.inspect,
    onSuccess: async (selected) => {
      if (!selected) return;
      if (!mounted.current) await selected.dispose();
      else setReview(selected);
    },
  });
  const restore = useMutation({
    mutationFn: async () => {
      if (!review) throw new Error(t("Inspect an archive before applying it."));
      return review.apply();
    },
    onSuccess: async () => {
      await onRestored();
      setReview(undefined);
    },
  });
  const busy = backup.isPending || inspect.isPending || restore.isPending;
  return (
    <View style={pageStyles.section}>
      <Text accessibilityRole="header" style={pageStyles.heading}>
        {t("Keep a copy")}
      </Text>
      <Text style={pageStyles.copy}>
        {t(
          "The complete private-memory archive includes retained claim history and every delivered conversation journal event in this private workspace, including uncited events. Profile, authored notes, workspace files, creator records, account/session authority, allocator state and erasure receipts are separate."
        )}
      </Text>
      <ActionButton
        quiet
        disabled={busy || disabled}
        onPress={() => {
          backup.mutate();
        }}
      >
        {backup.isPending
          ? t("Preparing backup…")
          : t("Download complete private-memory archive")}
      </ActionButton>
      <ActionButton
        quiet
        disabled={busy || disabled || Boolean(review)}
        onPress={() => {
          restore.reset();
          inspect.mutate();
        }}
      >
        {inspect.isPending
          ? t("Inspecting archive…")
          : t("Choose an archive to inspect")}
      </ActionButton>
      {(backup.error ?? inspect.error) && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          {(backup.error ?? inspect.error) instanceof Error
            ? (backup.error ?? inspect.error)?.message
            : t("The archive could not be transferred or inspected.")}
        </Text>
      )}
      {review && (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={pageStyles.heading}>
            {t("Review before applying")}
          </Text>
          <Text style={pageStyles.copy}>
            <Translated
              message="{value1} · version {value2}"
              values={{
                value1:
                  review.preview.coverage === "complete-journal"
                    ? t("Complete delivered journal and retained claims")
                    : t("Retained claims and cited journal events only"),
                value2: review.preview.version,
              }}
            />
          </Text>
          <Text selectable style={pageStyles.copy}>
            <Translated
              message="Workspace: {value1}"
              values={{ value1: review.preview.scope.workspaceId }}
            />
          </Text>
          <Text selectable style={pageStyles.copy}>
            <Translated
              message="Owner: {value1}"
              values={{ value1: review.preview.scope.userId }}
            />
          </Text>
          <Text selectable style={pageStyles.copy}>
            <Translated
              message="Namespace generation: {value1}"
              values={{ value1: review.preview.namespaceId }}
            />
          </Text>
          <Text selectable style={pageStyles.copy}>
            <Translated
              message="Archive revision: {value1}"
              values={{ value1: review.preview.revision ?? t("empty memory") }}
            />
          </Text>
          <Text selectable style={pageStyles.copy}>
            <Translated
              message="Reviewed current head: {value1}"
              values={{
                value1: review.preview.expectedRevision ?? t("empty memory"),
              }}
            />
          </Text>
          <Text selectable style={pageStyles.copy}>
            <Translated
              message="SHA-256: {value1}"
              values={{ value1: review.preview.archiveDigest }}
            />
          </Text>
          <Text style={pageStyles.copy}>
            <Translated
              message="{value1} claim identities · {value2} journal events · {value3} source bytes · retained history included"
              values={{
                value1: review.preview.claimCount,
                value2: review.preview.sourceEvents,
                value3: review.preview.sourceBytes.toLocaleString(locale),
              }}
            />
          </Text>
          {review.preview.version === 3 && (
            <Text style={pageStyles.copy}>
              <Translated
                message="Captured through sequence: {value1}"
                values={{
                  value1:
                    review.preview.capturedThrough ?? t("no delivered events"),
                }}
              />
            </Text>
          )}
          <Text style={pageStyles.copy}>
            {t(
              "Applying uses this exact inspected file, hash and current head. It cannot recover account/session ownership, allocator authority or erasure receipts, or resurrect a later removal."
            )}
          </Text>
          <ActionButton
            disabled={busy || disabled}
            onPress={() => {
              restore.mutate();
            }}
          >
            {restore.isPending
              ? t("Applying reviewed archive…")
              : t("Apply this reviewed archive")}
          </ActionButton>
          <ActionButton
            quiet
            disabled={busy}
            onPress={() => {
              setReview(undefined);
              restore.reset();
            }}
          >
            {t("Cancel archive review")}
          </ActionButton>
          {restore.error && (
            <Text accessibilityRole="alert" style={pageStyles.copy}>
              <Translated
                message="{value1} The inspected file is retained. If the head changed, cancel and inspect again before applying; nothing is silently rebased."
                values={{
                  value1:
                    restore.error instanceof Error
                      ? errorText(restore.error.message)
                      : t("The archive was not applied."),
                }}
              />
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
