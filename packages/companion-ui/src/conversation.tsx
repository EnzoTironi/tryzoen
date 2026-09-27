import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type {
  EveMessage,
  EveMessageInputRequest,
  EveMessagePart,
  UseEveAgentStatus,
} from "eve/react";
import type { InputResponse } from "eve/client";
import { AssistantMarkdown } from "./markdown";
import { ActionButton } from "./button";
import { Composer } from "./composer";
import { colors } from "./theme";
import { isSafeWebLink } from "./links";
import { MessageActions } from "./message-actions";
import {
  readReplyMessage,
  replyMessage,
  type MessageReply,
} from "./session/reply";

export function Conversation({
  messages,
  status,
  error,
  onSend,
  onRespond,
  onCancel,
  onLoadOlder,
  loadingOlder = false,
  onCopyText,
}: {
  readonly messages: readonly EveMessage[];
  readonly status: UseEveAgentStatus;
  readonly error?: string;
  readonly onSend: (text: string) => Promise<void>;
  readonly onRespond: (responses: readonly InputResponse[]) => Promise<void>;
  readonly onCancel: () => void;
  readonly onLoadOlder?: () => void;
  readonly loadingOlder?: boolean;
  readonly onCopyText?: (text: string) => Promise<void>;
}) {
  const [reply, setReply] = useState<MessageReply>();
  const scroll = useRef<FlatList<EveMessage>>(null);
  const nearBottom = useRef(true);
  const positioned = useRef(false);
  const busy = status === "streaming" || status === "submitted";
  const canRespond = status === "ready" || status === "error";
  useEffect(() => {
    if (messages.length === 0 || positioned.current) return undefined;
    const frame = requestAnimationFrame(() => {
      scroll.current?.scrollToEnd({ animated: false });
      positioned.current = true;
      nearBottom.current = true;
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [messages.length]);
  return (
    <View style={styles.root}>
      <FlatList
        ref={scroll}
        data={messages}
        keyExtractor={(message) => message.id}
        contentContainerStyle={[styles.messages, styles.column]}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={7}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        scrollEventThrottle={100}
        onLayout={() => {
          if (nearBottom.current && messages.length > 0)
            scroll.current?.scrollToEnd({ animated: false });
        }}
        onScrollBeginDrag={() => {
          positioned.current = true;
        }}
        onScroll={({ nativeEvent }) => {
          const atBottom =
            nativeEvent.contentSize.height -
              nativeEvent.contentOffset.y -
              nativeEvent.layoutMeasurement.height <
            100;
          // Initial list measurements can report the top before history is positioned.
          if (atBottom && nativeEvent.contentOffset.y > 0)
            positioned.current = true;
          if (positioned.current) nearBottom.current = atBottom;
        }}
        onContentSizeChange={() => {
          if (nearBottom.current)
            scroll.current?.scrollToEnd({ animated: false });
        }}
        ListHeaderComponent={
          onLoadOlder ? (
            <ActionButton
              quiet
              disabled={loadingOlder}
              onPress={() => {
                nearBottom.current = false;
                onLoadOlder();
              }}
            >
              {loadingOlder ? "Loading…" : "Earlier messages"}
            </ActionButton>
          ) : null
        }
        renderItem={({ item: message }) => (
          <View
            style={
              message.role === "user" ? styles.userGroup : styles.assistantGroup
            }
          >
            <View
              style={[
                styles.message,
                message.role === "user" ? styles.user : styles.assistant,
              ]}
            >
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
              {message.metadata?.status === "failed" && (
                <Text style={styles.error}>Message not delivered.</Text>
              )}
            </View>
            <MessageActions
              message={message}
              onCopy={onCopyText}
              onReply={setReply}
            />
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
            onSend={async (text) => {
              await onSend(replyMessage(text, reply));
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
  if (!quoted)
    return (
      <Text selectable style={styles.text}>
        {text}
      </Text>
    );
  return (
    <View style={styles.quotedMessage}>
      <View style={styles.quote}>
        <Text style={styles.caption}>
          {quoted.role === "assistant" ? "Replying to Zoen" : "Replying to you"}
        </Text>
        <Text selectable numberOfLines={4} style={styles.caption}>
          {quoted.quote}
        </Text>
      </View>
      <Text selectable style={styles.text}>
        {quoted.text}
      </Text>
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
    return isUser ? (
      <UserMessage text={part.text} />
    ) : (
      <AssistantMarkdown text={part.text} />
    );
  }
  if (part.type === "dynamic-tool") {
    const request = part.toolMetadata?.eve?.inputRequest;
    const response = part.toolMetadata?.eve?.inputResponse;
    if (request && !response)
      return (
        <InputRequest
          key={request.requestId}
          request={request}
          enabled={canRespond}
          onRespond={onRespond}
        />
      );
    if (request && response)
      return (
        <View style={styles.request}>
          <Text style={styles.author}>
            {request.kind === "tool-approval" ? "Your decision" : "Your answer"}
          </Text>
          <Text selectable style={styles.text}>
            {request.prompt}
          </Text>
          <Text selectable style={styles.caption}>
            {request.options?.find((option) => option.id === response.optionId)
              ?.label ??
              response.text ??
              response.optionId}
          </Text>
          {part.state === "output-error" && (
            <Text style={styles.error}>
              The action failed after your response.
            </Text>
          )}
        </View>
      );
    return (
      <Text style={styles.caption}>
        {part.toolName.replaceAll("_", " ")} ·{" "}
        {part.state === "output-error"
          ? "Failed"
          : part.state === "output-available"
            ? "Complete"
            : part.state === "output-denied"
              ? "Declined"
              : "In progress"}
      </Text>
    );
  }
  if (part.type === "authorization") {
    const url = part.authorization?.url;
    return (
      <View style={styles.request}>
        <Text style={styles.text}>{part.displayName}</Text>
        <Text style={styles.caption}>
          {part.state === "completed" ? part.outcome : part.description}
        </Text>
        {part.authorization?.userCode && (
          <Text selectable style={styles.text}>
            {part.authorization.userCode}
          </Text>
        )}
        {part.state === "required" && url && (
          <WebLink url={url} label="Connect account" />
        )}
      </View>
    );
  }
  if (part.type === "file")
    return part.url ? (
      <WebLink url={part.url} label={part.filename ?? "Attachment"} />
    ) : (
      <Text style={styles.caption}>{part.filename ?? "Attachment"}</Text>
    );
  return null;
}

function WebLink({
  url,
  label,
}: {
  readonly url: string;
  readonly label: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!isSafeWebLink(url)) return <Text style={styles.caption}>{label}</Text>;
  return (
    <View style={styles.request}>
      <ActionButton
        quiet
        onPress={() => {
          setFailed(false);
          void Linking.openURL(url).catch(() => {
            setFailed(true);
          });
        }}
      >
        {label}
      </ActionButton>
      {failed && (
        <Text style={styles.error}>This link couldn’t be opened.</Text>
      )}
    </View>
  );
}

function InputRequest({
  request,
  enabled,
  onRespond,
}: {
  readonly request: EveMessageInputRequest;
  readonly enabled: boolean;
  readonly onRespond: (responses: readonly InputResponse[]) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  async function respond(response: InputResponse) {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailed(false);
    try {
      await onRespond([response]);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
      inFlight.current = false;
    }
  }
  return (
    <View style={styles.request}>
      <Text style={styles.author}>
        {request.kind === "tool-approval"
          ? "Your permission is needed"
          : "A quick question"}
      </Text>
      <Text style={styles.text}>{request.prompt}</Text>
      <View style={styles.options}>
        {request.options?.map((option) => (
          <ActionButton
            key={option.id}
            quiet={option.style !== "danger"}
            disabled={!enabled || pending}
            onPress={() => {
              void respond({
                requestId: request.requestId,
                optionId: option.id,
              });
            }}
          >
            {option.label}
          </ActionButton>
        ))}
      </View>
      {((request.allowFreeform ?? false) || !request.options?.length) && (
        <View style={styles.request}>
          <TextInput
            accessibilityLabel="Your answer"
            placeholder="Your answer"
            value={text}
            onChangeText={setText}
            editable={enabled && !pending}
            style={styles.answer}
          />
          <ActionButton
            disabled={!enabled || pending || !text.trim()}
            onPress={() => {
              void respond({ requestId: request.requestId, text: text.trim() });
            }}
          >
            Send answer
          </ActionButton>
        </View>
      )}
      {failed && (
        <Text accessibilityRole="alert" style={styles.error}>
          Your answer wasn’t accepted. Please try again.
        </Text>
      )}
    </View>
  );
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
  request: { gap: 12, paddingVertical: 8 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  answer: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 12,
    color: colors.ink,
  },
  progress: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    paddingVertical: 20,
  },
  error: { color: colors.danger, fontSize: 13, lineHeight: 21 },
  composer: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16 },
});
