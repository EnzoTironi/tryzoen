import { useRef, useState } from "react";
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

export function Conversation({
  messages,
  status,
  error,
  onSend,
  onRespond,
  onCancel,
  onLoadOlder,
  loadingOlder = false,
}: {
  readonly messages: readonly EveMessage[];
  readonly status: UseEveAgentStatus;
  readonly error?: string;
  readonly onSend: (text: string) => Promise<void>;
  readonly onRespond: (responses: readonly InputResponse[]) => Promise<void>;
  readonly onCancel: () => void;
  readonly onLoadOlder?: () => void;
  readonly loadingOlder?: boolean;
}) {
  const scroll = useRef<FlatList<EveMessage>>(null);
  const nearBottom = useRef(true);
  const busy = status === "streaming" || status === "submitted";
  const canRespond = status === "ready" || status === "error";
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
        onScroll={({ nativeEvent }) => {
          nearBottom.current =
            nativeEvent.contentSize.height -
              nativeEvent.contentOffset.y -
              nativeEvent.layoutMeasurement.height <
            100;
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
            style={[styles.message, message.role === "user" && styles.user]}
          >
            {message.role === "assistant" && (
              <Text style={styles.author}>Zoen</Text>
            )}
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
            onSend={onSend}
            onCancel={onCancel}
            busy={busy}
            disabled={status === "resuming"}
          />
        </View>
      </View>
    </View>
  );
}

function MessagePart({
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
      <Text selectable style={styles.text}>
        {part.text}
      </Text>
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
  root: { flex: 1, minHeight: 0 },
  messages: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 30 },
  column: { width: "100%", maxWidth: 740, alignSelf: "center" },
  message: { gap: 12, paddingVertical: 20 },
  user: {
    alignSelf: "flex-end",
    maxWidth: "88%",
    backgroundColor: colors.wash,
    borderRadius: 22,
    paddingHorizontal: 20,
    marginVertical: 10,
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
  composer: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 },
});
