import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import type {
  LearnedClaimChangeSchema,
  LearnedClaimSetEnabledInputSchema,
} from "./schema";
import { CompanionPage, usePageStyles } from "../page";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { MemoryHistory } from "./history";
import { MemoryRelations } from "./relations";
import { MemoryCard } from "../cards/memory";
import { IconButton } from "../icon-button";
import { MemoryBackup } from "./backup";
import { LearnedClaimEditor } from "./editor";
import { LearnedClaimProvenance } from "./provenance";
import { createLearnedClaimEdit, type LearnedClaimEdit } from "./draft";
import { isLearnedMemoryConflict, type LearnedNotesData } from "./data";
export type { LearnedNotesData } from "./data";

export function LearnedNotes({
  data,
  cacheScope,
}: {
  readonly data: LearnedNotesData;
  readonly cacheScope: string;
}) {
  const pageStyles = usePageStyles();
  const memory = useQuery({
    queryKey: ["companion-learned-memory", cacheScope],
    queryFn: () => data.read(),
  });
  const cache = useQueryClient();
  const refresh = async () => {
    await Promise.all([
      cache.invalidateQueries({
        queryKey: ["companion-learned-memory", cacheScope],
      }),
      cache.invalidateQueries({
        queryKey: ["companion-claim-history", cacheScope],
      }),
    ]);
  };
  const [history, setHistory] = useState<{ claimId?: string }>();
  const [relating, setRelating] = useState<string>();
  const [editing, setEditing] = useState<LearnedClaimEdit>();
  const [removing, setRemoving] =
    useState<
      Extract<
        z.output<typeof LearnedClaimChangeSchema>,
        { action: "clear" | "tombstone" }
      >
    >();
  const [preference, setPreference] =
    useState<z.output<typeof LearnedClaimSetEnabledInputSchema>>();
  const mutation = useMutation({
    mutationFn: (action: () => Promise<void>) => action(),
    onSettled: refresh,
  });
  const actionsDisabled =
    mutation.isPending || memory.isFetching || memory.isError || !memory.data;
  const claims = memory.isError
    ? []
    : (memory.data?.snapshot.claims.flatMap((claim) =>
        claim.file.state.kind === "active"
          ? [{ claim, body: claim.file.state.body }]
          : []
      ) ?? []);
  return (
    <CompanionPage
      title="Learned memories"
      loading={memory.isPending}
      error={
        memory.error
          ? "Your saved memories couldn’t be loaded. Access must be restored before viewing or editing them."
          : mutation.error
            ? isLearnedMemoryConflict(mutation.error)
              ? "Memory changed. Your request is retained; review the current revision before retrying."
              : "Your change couldn’t be confirmed. Review the saved memory before retrying."
            : undefined
      }
      onRetry={() => {
        void memory.refetch();
      }}
    >
      <Text style={pageStyles.copy}>
        Private to you in this workspace. Review what Zoen remembers, correct a
        note, or pause learning.
      </Text>
      <View style={styles.actions}>
        <ActionButton
          quiet
          disabled={actionsDisabled}
          onPress={() => {
            setHistory({});
          }}
        >
          Search memory history
        </ActionButton>
        <ActionButton
          disabled={actionsDisabled || !memory.data.automaticEnabled}
          onPress={() => {
            if (memory.data)
              setEditing(
                createLearnedClaimEdit(memory.data, data.newOperationId)
              );
          }}
        >
          Remember something
        </ActionButton>
        <ActionButton
          quiet
          disabled={actionsDisabled}
          onPress={() => {
            if (!memory.data) return;
            const command = preference ?? {
              enabled: !memory.data.enabled,
              expectedPreferenceRevision: memory.data.preferenceRevision,
              operationId: data.newOperationId(),
            };
            setPreference(command);
            mutation.mutate(async () => {
              await data.setEnabled(command);
              setPreference(undefined);
            });
          }}
        >
          {preference
            ? "Retry preference change"
            : memory.data?.enabled === false
              ? "Resume memory"
              : "Pause memory"}
        </ActionButton>
      </View>
      {preference && mutation.error && (
        <View style={pageStyles.section}>
          <Text accessibilityRole="alert" style={pageStyles.copy}>
            The preference change was not confirmed. Your current personal
            preference is {memory.data?.enabled ? "active" : "paused"}.
            Workspace enablement is separate.
          </Text>
          <ActionButton
            quiet
            disabled={actionsDisabled}
            onPress={() => {
              setPreference(undefined);
              mutation.reset();
            }}
          >
            Use the current reviewed preference
          </ActionButton>
        </View>
      )}
      {memory.data?.enabled === false && (
        <Text style={pageStyles.copy}>
          Learning and recall are paused. Review, correction and removal remain
          available.
        </Text>
      )}
      {memory.data?.workspaceEnabled === false && (
        <Text style={pageStyles.copy}>
          Automatic memory is disabled in this workspace. Your personal
          preference is unchanged; review, correction and removal remain
          available.
        </Text>
      )}
      {claims.map(({ claim, body }) => (
        <MemoryCard
          key={claim.file.id}
          document={{ title: "Learned memory", text: body.text, updated: "" }}
          action={
            <IconButton
              label="Edit note"
              icon={Pencil}
              disabled={actionsDisabled}
              onPress={() => {
                if (memory.data)
                  setEditing(
                    createLearnedClaimEdit(
                      memory.data,
                      data.newOperationId,
                      claim
                    )
                  );
              }}
            />
          }
        >
          <LearnedClaimProvenance claim={claim} />
          <View style={styles.noteActions}>
            <ActionButton
              quiet
              disabled={actionsDisabled}
              onPress={() => {
                setRelating(claim.file.id);
              }}
            >{`Relationships (${body.relations.length})`}</ActionButton>
            <ActionButton
              quiet
              disabled={actionsDisabled}
              onPress={() => {
                setHistory({ claimId: claim.file.id });
              }}
            >
              Recorded versions
            </ActionButton>
            <IconButton
              label="Remove note"
              icon={Trash2}
              disabled={actionsDisabled}
              onPress={() => {
                if (memory.data)
                  setRemoving({
                    action: "tombstone",
                    claimId: claim.file.id,
                    operationId: data.newOperationId(),
                    expectedRevision: memory.data.snapshot.revision,
                  });
              }}
            />
          </View>
        </MemoryCard>
      ))}
      {!memory.isError && memory.data && !claims.length && (
        <Text style={pageStyles.copy}>
          Things you ask Zoen to remember will appear here.
        </Text>
      )}
      {memory.data && !memory.isError && (
        <MemoryBackup
          disabled={actionsDisabled}
          data={data.archives}
          onRestored={refresh}
        />
      )}
      {!!claims.length && (
        <View style={pageStyles.section}>
          <ActionButton
            quiet
            disabled={actionsDisabled}
            onPress={() => {
              if (memory.data)
                setRemoving({
                  action: "clear",
                  expectedRevision: memory.data.snapshot.revision,
                  operationId: data.newOperationId(),
                });
            }}
          >
            Remove all learned notes
          </ActionButton>
        </View>
      )}
      <Text style={[pageStyles.copy, pageStyles.section]}>
        Removal stops automatic recall. Earlier recorded claim versions and
        immutable conversation journals remain available through their separate
        review and archive actions.
      </Text>
      {editing && (
        <LearnedClaimEditor
          key={editing.claimId}
          initialDraft={editing}
          data={data}
          onSaved={refresh}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      )}
      {history && (
        <MemoryHistory
          data={data}
          cacheScope={cacheScope}
          claimId={history.claimId}
          onClose={() => {
            setHistory(undefined);
          }}
        />
      )}
      {relating && memory.data && (
        <MemoryRelations
          key={relating}
          claimId={relating}
          memory={memory.data}
          data={data}
          onSaved={refresh}
          onClose={() => {
            setRelating(undefined);
          }}
        />
      )}
      {removing && (
        <CompanionSheet
          title="Remove learned memory"
          onClose={() => {
            if (!mutation.isPending) setRemoving(undefined);
          }}
        >
          <Text accessibilityRole="header" style={pageStyles.heading}>
            {removing.action === "tombstone"
              ? "Remove this note?"
              : "Remove all current learned notes?"}
          </Text>
          <Text style={pageStyles.copy}>
            Zoen will stop recalling these claims. Recorded history and
            immutable journals are retained. No archive or erasure authority is
            reset.
          </Text>
          {mutation.error && (
            <>
              <Text accessibilityRole="alert" style={pageStyles.copy}>
                The removal was not confirmed. Your request is retained. Review
                the current memory before retrying.
              </Text>
              <Text selectable style={pageStyles.copy}>
                Current head: {memory.data?.snapshot.revision ?? "empty memory"}
              </Text>
              {claims
                .filter(
                  ({ claim }) =>
                    removing.action === "clear" ||
                    claim.file.id === removing.claimId
                )
                .map(({ claim, body }) => (
                  <Text selectable key={claim.file.id} style={pageStyles.copy}>
                    {body.text}
                  </Text>
                ))}
              <ActionButton
                quiet
                disabled={actionsDisabled}
                onPress={() => {
                  if (memory.data) {
                    setRemoving({
                      ...removing,
                      expectedRevision: memory.data.snapshot.revision,
                      operationId: data.newOperationId(),
                    });
                    mutation.reset();
                  }
                }}
              >
                Use this reviewed revision
              </ActionButton>
            </>
          )}
          <View style={styles.actions}>
            <ActionButton
              quiet
              disabled={mutation.isPending}
              onPress={() => {
                setRemoving(undefined);
              }}
            >
              Keep notes
            </ActionButton>
            <ActionButton
              disabled={actionsDisabled}
              onPress={() => {
                mutation.mutate(async () => {
                  await data.change(removing);
                  setRemoving(undefined);
                });
              }}
            >
              {mutation.isPending ? "Removing…" : "Remove"}
            </ActionButton>
          </View>
        </CompanionSheet>
      )}
    </CompanionPage>
  );
}
const styles = StyleSheet.create({
  noteActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginVertical: 18,
  },
});
