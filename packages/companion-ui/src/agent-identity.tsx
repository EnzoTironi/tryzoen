import { useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Client } from "eve/client";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Heart, Pencil, Zap } from "lucide-react-native";
import type { AgentPanelData } from "./agent-content";
import { CompanionPage, usePageStyles } from "./page";
import { ActionButton } from "./button";
import { DocumentEditor } from "./document-editor";
import { systemFont, useColors } from "./theme";
import { SheetSurface } from "./sheet";

function useIdentity(data: AgentPanelData, cacheScope: string) {
  return useQuery({
    queryKey: ["companion-identity", cacheScope],
    queryFn: data.identity,
    staleTime: 30_000,
  });
}

export function AgentName({
  data,
  cacheScope,
}: {
  readonly data: AgentPanelData;
  readonly cacheScope: string;
}) {
  return useIdentity(data, cacheScope).data?.name ?? "Zoen";
}

export function AgentPresence({
  data,
  cacheScope,
  client,
  avatarUri,
  onEdit,
}: {
  readonly data: AgentPanelData;
  readonly cacheScope: string;
  readonly client: Client;
  readonly avatarUri: string;
  readonly onEdit: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const identity = useIdentity(data, cacheScope);
  const health = useQuery({
    queryKey: ["companion-health", cacheScope],
    queryFn: () => client.health(),
    staleTime: 30_000,
    retry: false,
  });
  return (
    <View style={styles.presence}>
      <View>
        <Image source={{ uri: avatarUri }} style={styles.avatar} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit agent identity"
          onPress={onEdit}
          style={styles.editAvatar}
        >
          <Pencil size={19} color={colors.ink} />
        </Pressable>
      </View>
      <Text numberOfLines={1} style={styles.name}>
        {identity.data?.name ?? "Zoen"}
      </Text>
      <View accessibilityRole="text" style={styles.connection}>
        <Zap size={17} color={health.isSuccess ? "#15803d" : colors.muted} />
        <Text style={styles.connectionText}>
          {health.isPending
            ? "Connecting…"
            : health.isError
              ? "Unavailable"
              : "Connected"}
        </Text>
      </View>
      {health.isError && (
        <ActionButton
          quiet
          onPress={() => {
            void health.refetch();
          }}
        >
          Reconnect
        </ActionButton>
      )}
    </View>
  );
}

export function AgentIdentity({
  data,
  cacheScope,
  renderPersonalNotes,
}: {
  readonly data: AgentPanelData;
  readonly cacheScope: string;
  readonly renderPersonalNotes: (onBack: () => void) => ReactNode;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
  const identity = useIdentity(data, cacheScope);
  const [personal, setPersonal] = useState(false);
  const [editing, setEditing] = useState<{
    document: Awaited<
      ReturnType<AgentPanelData["identity"]>
    >["documents"][number];
    revision: string | null;
  }>();
  const operation = useRef<{ content: string; id: string } | undefined>(
    undefined
  );
  const profile = identity.data?.documents.find(
    (document) => document.title === "Identity"
  );
  const open = (document: NonNullable<typeof profile>) => {
    operation.current = undefined;
    setEditing({ document, revision: identity.data?.revision ?? null });
  };
  return (
    <CompanionPage
      title="Identity"
      hideTitle
      loading={identity.isPending}
      error={
        identity.error
          ? "Agent identity couldn’t be loaded. Try again."
          : undefined
      }
      onRetry={() => {
        void identity.refetch();
      }}
    >
      {profile && (
        <View style={styles.profile}>
          <Text style={styles.profileName}>{identity.data?.name}</Text>
          <Text numberOfLines={4} style={styles.summary}>
            {profile.text.replace(/^#.*\n|^Name:.*\n/gm, "").trim()}
          </Text>
          <Text style={pageStyles.copy}>
            {profile.saved ? "Workspace identity" : "Not customized yet"}
          </Text>
          <ActionButton
            quiet
            onPress={() => {
              open(profile);
            }}
          >
            {identity.data?.canEdit ? "Edit identity" : "View identity"}
          </ActionButton>
        </View>
      )}
      <View style={styles.documents}>
        {identity.data?.documents
          .filter((document) => document.title !== "Identity")
          .map((document) => (
            <Pressable
              key={document.path}
              accessibilityRole="button"
              accessibilityLabel={`Open ${document.title}`}
              onPress={() => {
                open(document);
              }}
              style={[
                styles.document,
                document.title === "Soul" ? styles.soul : styles.memory,
              ]}
            >
              <Text style={styles.documentTitle}>
                {document.title.toUpperCase()}
              </Text>
              <Text style={styles.documentSubtitle}>HANDLE WITH CARE</Text>
              <View style={styles.documentFoot}>
                <Text style={styles.documentStatus}>
                  {document.saved ? "Workspace document" : "Not customized"}
                </Text>
                <Heart size={22} fill="#ffffff80" color="#ffffff80" />
              </View>
            </Pressable>
          ))}
      </View>
      <View style={pageStyles.section}>
        <Text style={pageStyles.copy}>
          These documents shape your agent in this workspace.
        </Text>
        <View style={styles.personal}>
          <ActionButton
            quiet
            onPress={() => {
              setPersonal(true);
            }}
          >
            Your personal notes
          </ActionButton>
        </View>
      </View>
      {personal && (
        <SheetSurface
          title="Personal memory"
          onClose={() => {
            setPersonal(false);
          }}
          panelStyle={{ height: "85%", maxHeight: 780 }}
        >
          <View style={{ flex: 1, minHeight: 0 }}>
            {renderPersonalNotes(() => {
              setPersonal(false);
            })}
          </View>
        </SheetSurface>
      )}
      {editing && (
        <DocumentEditor
          markdown
          history={data.documentHistory(editing.document.path, cacheScope)}
          title={
            editing.document.path.split("/").at(-1) ?? editing.document.title
          }
          label={`${editing.document.title} document`}
          initialText={editing.document.text}
          maxLength={262144}
          description="This document guides your agent in this workspace. Changes apply to its next response."
          readOnly={!identity.data?.canEdit}
          allowUnchanged={!editing.document.saved}
          onClose={() => {
            setEditing(undefined);
          }}
          onSave={async (content) => {
            if (!operation.current || operation.current.content !== content)
              operation.current = { content, id: data.newOperationId() };
            try {
              await data.saveIdentity({
                path: editing.document.path,
                content,
                expectedRevision: editing.revision,
                operationId: operation.current.id,
              });
            } finally {
              // Refresh the next editor without replacing this draft or its base revision.
              await identity.refetch();
            }
          }}
        />
      )}
    </CompanionPage>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    presence: {
      alignItems: "center",
      paddingTop: 12,
      paddingBottom: 20,
      paddingHorizontal: 16,
      gap: 8,
    },
    avatar: {
      width: 112,
      height: 112,
      borderRadius: 56,
      borderWidth: 1,
      borderColor: colors.line,
    },
    editAvatar: {
      position: "absolute",
      right: -4,
      bottom: -4,
      width: 42,
      height: 42,
      borderRadius: 24,
      backgroundColor: colors.wash,
      borderWidth: 4,
      borderColor: colors.canvas,
      alignItems: "center",
      justifyContent: "center",
    },
    name: {
      fontFamily: systemFont,
      fontSize: 26,
      fontWeight: "600",
      color: colors.ink,
      marginTop: 8,
    },
    connection: { flexDirection: "row", alignItems: "center", gap: 5 },
    connectionText: {
      fontFamily: systemFont,
      fontSize: 18,
      color: colors.muted,
    },
    profile: {
      backgroundColor: "#f3f3f4",
      borderRadius: 28,
      padding: 20,
      gap: 14,
    },
    summary: {
      fontFamily: systemFont,
      fontSize: 16,
      lineHeight: 24,
      color: colors.ink,
    },
    profileName: {
      fontFamily: systemFont,
      fontSize: 18,
      fontWeight: "600",
      color: colors.ink,
    },
    documents: { flexDirection: "row", gap: 16, marginTop: 24 },
    document: {
      flex: 1,
      minWidth: 0,
      minHeight: 180,
      borderRadius: 28,
      padding: 18,
    },
    soul: {
      backgroundColor: "#bc1935",
      boxShadow: "inset 0 -20px 60px rgba(80,0,30,0.16)",
    },
    memory: {
      backgroundColor: "#383fb5",
      boxShadow: "inset 0 -20px 60px rgba(20,0,90,0.16)",
    },
    documentTitle: {
      fontFamily: systemFont,
      color: colors.surface,
      fontSize: 20,
      fontWeight: "500",
    },
    documentSubtitle: {
      fontFamily: systemFont,
      color: "#ffffffb3",
      fontSize: 10,
      letterSpacing: 0.5,
      marginTop: 6,
    },
    documentFoot: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: 4,
      flex: 1,
      paddingTop: 32,
    },
    documentStatus: {
      fontFamily: systemFont,
      color: "#ffffffb3",
      fontSize: 12,
      flexShrink: 1,
    },
    personal: { marginTop: 16 },
  });
}
