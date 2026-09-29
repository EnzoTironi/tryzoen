import { MessageDelivery } from "./conversation/delivery";
import { useConversationScroll } from "./conversation/scroll";
import { Puzzle, ShieldCheck } from "lucide-react-native";
import { ResourceCard } from "./cards/resource";
import { InputRequestCard } from "./conversation/input-request";
import { LinkCard, MessageLinks } from "./cards/link";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from "react-native";
import type { EveMessage, EveMessagePart, UseEveAgentStatus } from "eve/react";
import type { InputResponse } from "eve/client";
import { AssistantMarkdown } from "./markdown";
import { ActionButton } from "./button";
import { Composer } from "./composer";
import { colors } from "./theme";
import { MessageActions } from "./message-actions";
import { AttachmentCard } from "./attachments/card";
import { messageContent, type ConversationDraft } from "./session/input";
import type { ChatAgent } from "./session/types";
import {
  messageText,
  readReplyMessage,
  replyMessage,
  type MessageReply,
} from "./session/reply";

export function Conversation({
  messages,
  status,
  error,
  onSend,
  onRetrySend,
  onRespond,
  onCancel,
  onLoadOlder,
  loadingOlder = false,
  olderError,
  onCopyText,
  initialDraft,
  onDraftChange,
  reactions,
  onReact,
  onVisibleMessagesChange,
}: {
  readonly messages: readonly EveMessage[];
  readonly status: UseEveAgentStatus;
  readonly error?: string;
  readonly onSend: ChatAgent["send"];
  readonly onRetrySend?: (id: string) => void;
  readonly onRespond: (responses: readonly InputResponse[]) => Promise<void>;
  readonly onCancel: () => void;
  readonly onLoadOlder?: () => Promise<void>;
  readonly loadingOlder?: boolean;
  readonly olderError?: string;
  readonly onCopyText?: (text: string) => Promise<void>;
  readonly initialDraft?: ConversationDraft;
  readonly onDraftChange?: (draft: ConversationDraft) => void;
  readonly reactions?: ReadonlyMap<string, string | null>;
  readonly onReact?: (messageId: string, emoji: string | null) => Promise<void>;
  readonly onVisibleMessagesChange?: (ids: string[]) => void;
}) {
  const staged = readReplyMessage(initialDraft?.text ?? "");
  const [reply, setReply] = useState<MessageReply | undefined>(() =>
    staged
      ? { id: staged.id, role: staged.role, text: staged.quote }
      : undefined
  );
  const {
    ref: listRef,
    retry: retryHistory,
    onLayout: layoutHistory,
    onScrollBeginDrag: dragHistory,
    onScroll: scrollHistory,
    onContentSizeChange: resizeHistory,
  } = useConversationScroll({
    messages,
    loadingOlder,
    olderError,
    onLoadOlder,
  });
  const busy = status === "streaming" || status === "submitted";
  const canRespond = status === "ready" || status === "error";
  const reportVisible = useRef(onVisibleMessagesChange);
  useEffect(() => {
    reportVisible.current = onVisibleMessagesChange;
  }, [onVisibleMessagesChange]);
  // FlatList requires this callback's identity to survive renders and refreshes.
  const [onViewableItemsChanged] = useState(
    () =>
      ({ viewableItems }: { viewableItems: ViewToken<EveMessage>[] }) => {
        reportVisible.current?.(
          viewableItems
            .filter(({ item }) => !item.metadata?.optimistic)
            .map(({ item }) => item.id)
        );
      }
  );
  return (
    <View style={styles.root}>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(message) => message.id}
        contentContainerStyle={[styles.messages, styles.column]}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={7}
        onViewableItemsChanged={onViewableItemsChanged}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        scrollEventThrottle={100}
        onLayout={layoutHistory}
        onScrollBeginDrag={dragHistory}
        onScroll={scrollHistory}
        onContentSizeChange={resizeHistory}
        ListHeaderComponent={
          loadingOlder ? (
            <ActivityIndicator accessibilityLabel="Loading earlier messages" />
          ) : olderError ? (
            <View>
              <Text accessibilityRole="alert">
                Earlier messages couldn’t be loaded.
              </Text>
              <ActionButton quiet onPress={retryHistory}>
                Try again
              </ActionButton>
            </View>
          ) : null
        }
        renderItem={({ item: message }) => (
          <View
            testID="agent-message"
            style={
              message.role === "user" ? styles.userGroup : styles.assistantGroup
            }
          >
            <View style={{ gap: 6, maxWidth: "100%" }}>
              {message.parts.map((part, index) => (
                <MessagePart
                  // oxlint-disable-next-line react/no-array-index-key -- Eve parts are append-only; their text changes while streaming.
                  key={`${message.id}:${index}`}
                  part={part}
                  isUser={message.role === "user"}
                  canRespond={canRespond}
                  onRespond={onRespond}
                />
              ))}
              {message.metadata?.status === "failed" &&
                !message.metadata.optimistic && (
                  <Text style={styles.error}>
                    A resposta não pôde ser concluída.
                  </Text>
                )}
            </View>
            <View style={{ minHeight: 44, justifyContent: "center" }}>
              {message.metadata?.optimistic ? (
                <MessageDelivery
                  status={
                    message.metadata.status === "failed" ? "failed" : "sending"
                  }
                  failureText="Envio não confirmado. Verifique a conversa antes de reenviar."
                  onRetry={
                    onRetrySend
                      ? () => {
                          onRetrySend(message.id);
                        }
                      : undefined
                  }
                />
              ) : (
                <MessageActions
                  text={messageText(message)}
                  outgoing={message.role === "user"}
                  onCopy={onCopyText}
                  onReply={() => {
                    setReply({
                      id: message.id,
                      role: message.role,
                      text: messageText(message),
                    });
                  }}
                  reaction={reactions?.get(message.id)}
                  onReact={
                    onReact ? (emoji) => onReact(message.id, emoji) : undefined
                  }
                />
              )}
            </View>
          </View>
        )}
        ListFooterComponent={
          <View>
            {(busy || status === "resuming") && (
              <View
                accessibilityRole="progressbar"
                accessibilityLabel={
                  status === "resuming" ? "Reconnecting" : "Working"
                }
                style={styles.progress}
              >
                <ActivityIndicator size="small" color={colors.muted} />
                <Text style={styles.caption}>
                  {status === "resuming"
                    ? "Reconnecting to your conversation…"
                    : "Working on it…"}
                </Text>
              </View>
            )}
            {error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            )}
          </View>
        }
      />
      <View style={styles.composer}>
        <View style={styles.column}>
          <Composer
            initialDraft={{
              text: staged?.text ?? initialDraft?.text ?? "",
              files: initialDraft?.files ?? [],
            }}
            onDraftChange={
              onDraftChange
                ? (draft) => {
                    onDraftChange({
                      ...draft,
                      text: replyMessage(draft.text, reply),
                    });
                  }
                : undefined
            }
            onSend={async (message) => {
              await onSend(
                messageContent({
                  ...message,
                  text: replyMessage(message.text, reply),
                })
              );
              setReply((current) =>
                current?.id === reply?.id ? undefined : current
              );
            }}
            reply={reply}
            onRemoveReply={() => {
              setReply(undefined);
            }}
            onCancel={onCancel}
            busy={busy}
            disabled={status === "resuming"}
          />
        </View>
      </View>
    </View>
  );
}

function UserMessage({ text }: { readonly text: string }) {
  const quoted = readReplyMessage(text);
  if (!quoted) return <AssistantMarkdown text={text} compact />;
  return (
    <View style={styles.quotedMessage}>
      <View style={styles.quote}>
        <Text style={styles.caption}>
          {quoted.id.startsWith("feed:")
            ? "Discussing a Feed post"
            : quoted.role === "assistant"
              ? "Replying to Zoen"
              : "Replying to you"}
        </Text>
        <Text selectable numberOfLines={4} style={styles.caption}>
          {quoted.quote}
        </Text>
      </View>
      <AssistantMarkdown text={quoted.text} compact />
    </View>
  );
}

export function MessagePart({
  part,
  isUser,
  canRespond,
  onRespond,
}: {
  readonly part: EveMessagePart;
  readonly isUser: boolean;
  readonly canRespond: boolean;
  readonly onRespond: (responses: readonly InputResponse[]) => Promise<void>;
}) {
  if (part.type === "text") {
    return (
      <>
        <View style={[styles.message, isUser ? styles.user : styles.assistant]}>
          {isUser ? (
            <UserMessage text={part.text} />
          ) : (
            <AssistantMarkdown text={part.text} compact />
          )}
        </View>
        <MessageLinks text={readReplyMessage(part.text)?.text ?? part.text} />
      </>
    );
  }
  if (part.type === "dynamic-tool") {
    const request = part.toolMetadata?.eve?.inputRequest;
    if (request)
      return (
        <InputRequestCard
          key={request.requestId}
          part={part}
          enabled={canRespond}
          onRespond={onRespond}
        />
      );
    return (
      <ResourceCard
        title={part.toolName.replaceAll("_", " ")}
        icon={Puzzle}
        tint="#8673c8"
        detail={
          part.state === "output-error"
            ? "Falhou"
            : part.state === "output-available"
              ? "Concluído"
              : part.state === "output-denied"
                ? "Não autorizado"
                : "Em andamento"
        }
      />
    );
  }

  if (part.type === "authorization") {
    const url = part.authorization?.url;
    return (
      <ResourceCard
        title={part.displayName}
        icon={ShieldCheck}
        tint="#4c9984"
        detail={part.state === "completed" ? part.outcome : part.description}
      >
        {part.authorization?.userCode && (
          <Text selectable style={styles.text}>
            {part.authorization.userCode}
          </Text>
        )}
        {part.state === "required" && url && (
          <LinkCard url={url} title="Connect account" />
        )}
      </ResourceCard>
    );
  }
  if (part.type === "file")
    return part.url?.startsWith("data:") ? (
      <AttachmentCard
        file={{
          type: "file",
          url: part.url,
          filename: part.filename,
          mediaType: part.mediaType,
        }}
      />
    ) : part.url ? (
      <LinkCard url={part.url} title={part.filename ?? "Attachment"} />
    ) : (
      <Text style={styles.caption}>{part.filename ?? "Attachment"}</Text>
    );
  return null;
}

const styles = StyleSheet.create({
  quotedMessage: { gap: 12 },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: colors.muted,
    paddingLeft: 12,
    gap: 4,
  },
  root: { flex: 1, minHeight: 0 },
  messages: {
    flexGrow: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 30,
  },
  column: { width: "100%", maxWidth: 900, alignSelf: "center" },
  message: {
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginVertical: 3,
    borderRadius: 24,
  },
  assistant: {
    backgroundColor: "#e9e9eb",
  },
  user: {
    backgroundColor: "#cbe5ff",
    borderRadius: 22,
    paddingHorizontal: 20,
    marginVertical: 10,
  },
  userGroup: {
    alignSelf: "flex-end",
    maxWidth: "88%",
    alignItems: "flex-end",
    marginBottom: 12,
  },
  assistantGroup: {
    alignSelf: "flex-start",
    maxWidth: "90%",
    marginBottom: 12,
  },
  author: { fontSize: 13, fontWeight: "600", color: colors.ink },
  text: { fontSize: 16, lineHeight: 25, color: colors.ink },
  caption: { fontSize: 13, lineHeight: 21, color: colors.muted },
  progress: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    paddingVertical: 20,
  },
  error: { color: colors.danger, fontSize: 13, lineHeight: 21 },
  composer: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16 },
});
