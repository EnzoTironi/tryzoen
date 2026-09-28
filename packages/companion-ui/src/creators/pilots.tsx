import { useState } from "react";
import { Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { CreatorStudioData } from "./studio";
import { CreatorPilot } from "./pilot";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { pageStyles } from "../page";

export function CreatorPilots({
  data,
  cacheScope,
}: {
  readonly data: CreatorStudioData;
  readonly cacheScope: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionButton
        quiet
        onPress={() => {
          setOpen(true);
        }}
      >
        Private pilots
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
  const [selected, setSelected] = useState<string>();
  const [ending, setEnding] = useState<string>();
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
    <CompanionSheet title="Private pilots" onClose={onClose}>
      <Text style={pageStyles.copy}>
        Try an explicitly shared version of a creator’s AI. Accepting shares no
        conversations or personal memory. Your questions, answers and reviews
        stay private to you. Access ends if either person withdraws or leaves
        this workspace.
      </Text>
      {pilots.isPending && <Text style={pageStyles.copy}>Loading pilots…</Text>}
      {pilots.isError && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          Pilots could not be loaded.
        </Text>
      )}
      <ActionButton
        quiet
        onPress={() => {
          void pilots.refetch();
        }}
      >
        Refresh pilots
      </ActionButton>
      {action.error && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          {action.error.message}
        </Text>
      )}
      {!pilots.isError &&
        pilots.data?.map((pilot) => (
          <View key={pilot.id} style={{ gap: 8, paddingVertical: 12 }}>
            <Text style={pageStyles.rowTitle}>{pilot.title} · AI</Text>
            <Text style={pageStyles.copy}>
              {pilot.isCreator
                ? `For ${pilot.recipientName}`
                : `From ${pilot.creatorName}`}{" "}
              · {pilot.status}
            </Text>
            <Text style={pageStyles.copy}>{pilot.description}</Text>
            {pilot.status === "pending" && !pilot.isCreator && (
              <>
                <Text style={pageStyles.copy}>
                  If you accept, the selected teaching and each question you
                  submit will be processed by your chosen model. Previous
                  conversations are not included.
                </Text>
                <ActionButton
                  disabled={action.isPending}
                  onPress={() => {
                    action.mutate({ id: pilot.id, action: "accept" });
                  }}
                >
                  Accept private pilot
                </ActionButton>
                <ActionButton
                  quiet
                  disabled={action.isPending}
                  onPress={() => {
                    action.mutate({ id: pilot.id, action: "decline" });
                  }}
                >
                  Decline invitation
                </ActionButton>
              </>
            )}
            {pilot.status === "active" && !pilot.isCreator && (
              <ActionButton
                onPress={() => {
                  setSelected(pilot.id);
                }}
              >
                Open pilot
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
                End access
              </ActionButton>
            )}
          </View>
        ))}
      {pilots.data?.length === 0 && (
        <Text style={pageStyles.copy}>
          No pilots yet. Invite someone from an approved version, or accept an
          invitation here.
        </Text>
      )}
      {ending && (
        <CompanionSheet
          title="End pilot access?"
          onClose={() => {
            if (!action.isPending) setEnding(undefined);
          }}
        >
          <Text style={pageStyles.copy}>
            The participant will no longer be able to open the teaching, read
            saved pilot results or start new runs. A result still being
            generated will not be saved after withdrawal. Copies already read or
            exported cannot be recalled.
          </Text>
          <ActionButton
            disabled={action.isPending}
            onPress={() => {
              action.mutate({ id: ending, action: "withdraw" });
            }}
          >
            End this pilot
          </ActionButton>
          {action.error && (
            <Text accessibilityRole="alert" style={pageStyles.copy}>
              {action.error.message}
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
    </CompanionSheet>
  );
}
