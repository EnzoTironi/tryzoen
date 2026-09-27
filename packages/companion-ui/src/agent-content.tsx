import { useState, type ComponentProps, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Client } from "eve/client";
import { PersonalMemory } from "./personal-memory";
import { Upcoming, type UpcomingItem } from "./upcoming";
import { ActionButton } from "./button";
import { ConversationReview } from "./conversation-review";
import type { AgentPanelTab } from "./agent-panel";
import { AgentIdentity } from "./agent-identity";
import { UpcomingHistory, type ScheduleHistoryPage } from "./upcoming-history";
import type { DocumentHistoryData } from "./document-history";

/** Authenticated platform adapter. Data is already mapped for the shared views. */
export interface AgentPanelData {
  documentHistory: (path: string, cacheScope: string) => DocumentHistoryData;
  identity: () => Promise<{
    name: string;
    revision: string | null;
    canEdit: boolean;
    documents: readonly {
      path: string;
      title: string;
      text: string;
      saved: boolean;
    }[];
  }>;
  newOperationId: () => string;
  saveIdentity: (input: {
    path: string;
    content: string;
    expectedRevision: string | null;
    operationId: string;
  }) => Promise<void>;
  memory: () => Promise<
    Pick<
      ComponentProps<typeof PersonalMemory>,
      "profile" | "documents" | "unresolved"
    >
  >;
  saveNote: ComponentProps<typeof PersonalMemory>["onSave"];
  schedules: () => Promise<{
    items: readonly (UpcomingItem & { revision: number })[];
    hasMore: boolean;
  }>;
  scheduleHistory: (
    id: string,
    cursor?: string
  ) => Promise<ScheduleHistoryPage>;
  setScheduleActive: (
    id: string,
    revision: number,
    active: boolean
  ) => Promise<void>;
}

export function AgentPanelContent({
  tab,
  data,
  cacheScope,
  client,
  onPrompt,
  onConversation,
  renderConversations,
}: {
  readonly tab: AgentPanelTab;
  readonly data: AgentPanelData;
  readonly cacheScope: string;
  readonly client: Client;
  readonly onPrompt: (text: string) => void;
  readonly onConversation: (id: string) => void;
  readonly renderConversations: (props: {
    title: string;
    intro: string;
    allowCreate: boolean;
    onConversation: (id?: string) => void;
  }) => ReactNode;
}) {
  if (tab === "identity")
    return (
      <AgentIdentity
        data={data}
        cacheScope={cacheScope}
        renderPersonalNotes={() => (
          <PersonalMemorySection
            data={data}
            cacheScope={cacheScope}
            onPrompt={onPrompt}
          />
        )}
      />
    );
  if (tab === "upcoming")
    return (
      <UpcomingSection
        data={data}
        cacheScope={cacheScope}
        onPrompt={onPrompt}
        onConversation={onConversation}
      />
    );
  return (
    <ActivitySection
      key={tab}
      approvals={tab === "approvals"}
      client={client}
      renderConversations={renderConversations}
    />
  );
}

function ActivitySection({
  approvals,
  client,
  renderConversations,
}: Pick<
  ComponentProps<typeof AgentPanelContent>,
  "client" | "renderConversations"
> & { readonly approvals: boolean }) {
  const [selected, setSelected] = useState<string>();
  if (!selected)
    return renderConversations({
      title: approvals ? "Approval history" : "Activity",
      intro: approvals
        ? "Choose a conversation to review its permission requests and decisions."
        : "Open a conversation to see its tools and completed work.",
      allowCreate: false,
      onConversation: setSelected,
    });
  return (
    <>
      <ActionButton
        quiet
        onPress={() => {
          setSelected(undefined);
        }}
      >
        All conversations
      </ActionButton>
      <ConversationReview
        client={client}
        sessionId={selected}
        approvals={approvals}
      />
    </>
  );
}

function UpcomingSection({
  data,
  cacheScope,
  onPrompt,
  onConversation,
}: Pick<
  ComponentProps<typeof AgentPanelContent>,
  "data" | "cacheScope" | "onPrompt" | "onConversation"
>) {
  const schedules = useQuery({
    queryKey: ["companion-schedules", cacheScope],
    queryFn: data.schedules,
  });
  const update = useMutation({
    mutationFn: async (id: string) => {
      const item = schedules.data?.items.find(
        (candidate) => candidate.id === id
      );
      if (!item) throw new Error("Refresh to see the current schedule.");
      await data.setScheduleActive(id, item.revision, item.status !== "active");
    },
    onSuccess: async () => {
      await schedules.refetch();
    },
  });
  return (
    <Upcoming
      renderHistory={(id) => (
        <UpcomingHistory id={id} data={data} cacheScope={cacheScope} />
      )}
      items={schedules.data?.items ?? []}
      hasMore={schedules.data?.hasMore}
      loading={schedules.isPending}
      error={
        schedules.error
          ? "Schedules couldn’t be loaded. Try again."
          : update.error
            ? "This schedule could not be changed. Refresh to see its current state."
            : undefined
      }
      pendingId={update.isPending ? update.variables : undefined}
      onRetry={() => {
        update.reset();
        void schedules.refetch();
      }}
      onToggle={(id) => {
        if (!update.isPending) update.mutate(id);
      }}
      onConversation={onConversation}
      onCreate={() => {
        onPrompt(
          "Help me schedule a task. Ask what to do, how often, and in which timezone, then confirm the schedule before saving it."
        );
      }}
    />
  );
}

export function PersonalMemorySection({
  data,
  cacheScope,
  onPrompt,
}: Pick<
  ComponentProps<typeof AgentPanelContent>,
  "data" | "cacheScope" | "onPrompt"
>) {
  const memory = useQuery({
    queryKey: ["companion-personal-memory", cacheScope],
    queryFn: data.memory,
  });
  return (
    <PersonalMemory
      profile={memory.data?.profile ?? []}
      documents={memory.data?.documents ?? []}
      unresolved={memory.data?.unresolved ?? true}
      loading={memory.isPending}
      error={
        memory.error
          ? "Your personal memory couldn’t be loaded. Try again."
          : undefined
      }
      onRetry={() => {
        void memory.refetch();
      }}
      onSave={async (expectedVersion, content) => {
        await data.saveNote(expectedVersion, content);
        await memory.refetch();
      }}
      onCorrectProfile={() => {
        onPrompt(
          "Help me review and update my saved personal profile. Ask which details I want to change, and save only the changes I confirm."
        );
      }}
    />
  );
}
