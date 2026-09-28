import type { ComposerEditorHandle } from "../composer/editor";
import {
  useEffect,
  useMemo,
  useState,
  type RefObject,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  AtSign,
  FileText,
  Paperclip,
  Sparkles,
  Zap,
  X,
} from "lucide-react-native";
import { useComposerReferences } from "./provider";
import { referenceAt, insertReference } from "./schema";
import { IconButton } from "../icon-button";
import { colors } from "../theme";

export function useComposerSheet({
  text,
  reference,
  change,
  input,
  roomId: roomOverride,
  disabled,
  onPick,
}: {
  text: string;
  reference?: ReturnType<typeof referenceAt>;
  change: (text: string) => void;
  input: RefObject<ComposerEditorHandle | null>;
  roomId?: string;
  disabled: boolean;
  onPick?: () => void;
}) {
  const source = useComposerReferences();
  const roomId = roomOverride ?? source?.roomId;
  const [caret, setCaret] = useState(text.length);
  const [insertion, setInsertion] =
    useState<ReturnType<typeof insertReference>>();
  const selection = useMemo(
    () =>
      insertion?.text === text
        ? { start: insertion.caret, end: insertion.caret }
        : undefined,
    [insertion, text]
  );
  useEffect(() => {
    const target = input.current;
    if (
      Platform.OS === "web" &&
      selection &&
      target instanceof HTMLTextAreaElement
    ) {
      // React restores the DOM selection after a controlled value changes.
      // Apply the insertion caret after that commit; native uses the selection prop.
      const frame = requestAnimationFrame(() => {
        target.setSelectionRange(selection.start, selection.end);
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }
    return undefined;
  }, [input, selection]);
  const [menu, setMenu] = useState(false);
  const [dismissed, setDismissed] = useState<string>();
  const [selected, setSelected] = useState(0);
  const token = reference === undefined ? referenceAt(text, caret) : reference;
  const identity = token
    ? `${token.start}:${token.trigger}:${token.query}`
    : "";
  const visible = !disabled && !!source && !!token && dismissed !== identity;
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(token?.query ?? "");
    }, 150);
    return () => {
      clearTimeout(timer);
    };
  }, [token?.query]);
  const results = useQuery({
    queryKey: [
      "composer-references",
      source?.cacheScope,
      roomId,
      token?.trigger,
      query,
    ],
    queryFn: () => {
      if (!source || !token)
        throw new Error("No reference source is available.");
      return source.search({ trigger: token.trigger, query, roomId });
    },
    enabled: visible && query === token.query,
    staleTime: 15_000,
  });
  const items = query === token?.query ? (results.data ?? []) : [];
  const searching = query !== token?.query || results.isFetching;
  const active = Math.min(selected, Math.max(0, items.length - 1));
  const close = () => {
    setMenu(false);
    setDismissed(identity);
    input.current?.focus();
  };
  const insert = (value: string, start = caret, end = caret) => {
    const next = insertReference(text, start, end, value);
    change(next.text);
    setCaret(next.caret);
    setMenu(false);
    setDismissed(undefined);
    input.current?.focus();
    setInsertion(next);
  };
  const choose = (index: number) => {
    const item = items[index];
    if (item && token) {
      if (input.current?.insertReference) {
        input.current.insertReference(item);
        setMenu(false);
        setDismissed(identity);
        return;
      }
      insert(item.token, token.start, token.end);
    }
  };
  return {
    source: !!source,
    changeText: (value: string) => {
      setInsertion(undefined);
      change(value);
    },
    selection,
    setCaret,
    open: () => {
      setMenu(!menu);
      setDismissed(identity);
    },
    close,
    key: (key: string) => {
      if (!visible && !menu) return false;
      if (key === "Escape") {
        close();
        return true;
      }
      if (!visible) return false;
      if (key === "ArrowDown" || key === "ArrowUp") {
        setSelected(
          (active +
            (key === "ArrowDown" ? 1 : -1) +
            Math.max(1, items.length)) %
            Math.max(1, items.length)
        );
        return true;
      }
      if (key === "Enter" || key === "Tab") {
        choose(active);
        return true;
      }
      return false;
    },
    content:
      !disabled && (menu || visible) ? (
        <ComposerSheet
          title={
            visible
              ? token.trigger === "$"
                ? "Skills"
                : token.trigger === "/"
                  ? "Rotinas"
                  : "Pessoas e arquivos"
              : "Adicionar"
          }
          onClose={close}
        >
          {visible ? (
            <>
              {searching && (
                <ActivityIndicator accessibilityLabel="Buscando referências" />
              )}
              {results.isError ? (
                <Text accessibilityRole="alert" style={styles.empty}>
                  Não foi possível buscar. Feche e tente novamente.
                </Text>
              ) : !searching && items.length === 0 ? (
                <Text style={styles.empty}>
                  Nenhum resultado nesta conversa.
                </Text>
              ) : null}
              {items.map((item, index) => (
                <Pressable
                  key={`${item.kind}:${item.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}, ${item.detail}`}
                  accessibilityState={{ selected: active === index }}
                  onPress={() => {
                    choose(index);
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    active === index && styles.active,
                    pressed && styles.pressed,
                  ]}
                >
                  {item.kind === "person" || item.kind === "bot" ? (
                    <AtSign size={21} color={colors.accent} />
                  ) : item.kind === "skill" ? (
                    <Sparkles size={21} color={colors.accent} />
                  ) : item.kind === "routine" ? (
                    <Zap size={21} color={colors.accent} />
                  ) : (
                    <FileText size={21} color={colors.accent} />
                  )}
                  <View style={styles.copy}>
                    <Text numberOfLines={1} style={styles.label}>
                      {item.title}
                      {item.kind === "bot" ? " · IA" : ""}
                    </Text>
                    <Text numberOfLines={1} style={styles.detail}>
                      {item.detail}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </>
          ) : (
            <>
              {onPick && (
                <SheetAction
                  icon={Paperclip}
                  title="Arquivos e mídia"
                  detail="Fotos, vídeos, áudio e documentos · até 3 MiB"
                  onPress={() => {
                    close();
                    onPick();
                  }}
                />
              )}
              {source &&
                [
                  {
                    trigger: "@",
                    title: "Pessoas e arquivos",
                    detail: "Referenciar algo na conversa",
                    icon: AtSign,
                  },
                  {
                    trigger: "$",
                    title: "Skills",
                    detail: "Escolher uma habilidade",
                    icon: Sparkles,
                  },
                  {
                    trigger: "/",
                    title: "Rotinas",
                    detail: "Referenciar uma rotina",
                    icon: Zap,
                  },
                ].map((item) => (
                  <SheetAction
                    key={item.trigger}
                    {...item}
                    onPress={() => {
                      if (input.current?.insertText) {
                        input.current.insertText(` ${item.trigger}`);
                        setMenu(false);
                        setDismissed(undefined);
                        setSelected(0);
                        return;
                      }
                      const prefix =
                        caret > 0 && !/\s/u.test(text[caret - 1] ?? "")
                          ? " "
                          : "";
                      const next =
                        text.slice(0, caret) +
                        prefix +
                        item.trigger +
                        text.slice(caret);
                      change(next);
                      setCaret(caret + prefix.length + 1);
                      setInsertion({
                        text: next,
                        caret: caret + prefix.length + 1,
                      });
                      setMenu(false);
                      setDismissed(undefined);
                      setSelected(0);
                      input.current?.focus();
                    }}
                  />
                ))}
            </>
          )}
        </ComposerSheet>
      ) : null,
  };
}

function SheetAction({
  icon: Icon,
  title,
  detail,
  onPress,
}: {
  icon: typeof Paperclip;
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Icon size={22} color={colors.ink} />
      <View style={styles.copy}>
        <Text style={styles.label}>{title}</Text>
        <Text style={styles.detail}>{detail}</Text>
      </View>
    </Pressable>
  );
}

function ComposerSheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  return (
    <View
      accessibilityLabel={title}
      style={[
        styles.sheet,
        { maxHeight: Math.max(160, Math.min(360, height * 0.42)) },
      ]}
    >
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.heading}>
          {title}
        </Text>
        <IconButton
          icon={X}
          label="Fechar menu de adicionar"
          onPress={onClose}
        />
      </View>
      <ScrollView
        keyboardShouldPersistTaps="always"
        contentContainerStyle={styles.content}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    bottom: "100%",
    marginBottom: 10,
    left: 0,
    right: 0,
    zIndex: 20,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    boxShadow: "0 8px 36px rgba(0,0,0,0.12)",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 20,
    paddingRight: 6,
  },
  heading: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  content: { paddingHorizontal: 8, paddingBottom: 8 },
  row: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 14,
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  label: { fontSize: 16, color: colors.ink },
  detail: { fontSize: 13, color: colors.muted },
  active: { backgroundColor: "#eaf2ff" },
  pressed: { backgroundColor: colors.wash },
  empty: { padding: 16, fontSize: 14, color: colors.muted },
});
