import { useEffect, useRef, useState } from "react";
import { AppState, Text, View } from "react-native";
import { ActionButton } from "../button";
import { usePageStyles } from "../page";
import type { VaultData } from "./data";
import type { VaultCreateItem, VaultItem } from "./schema";
import { VaultItemForm } from "./form";

/** Deliberate, abortable read; decrypted values live only in this mounted editor. */
export function VaultItemEditor({
  item,
  data,
  onDone,
}: {
  readonly item: VaultItem;
  readonly data: VaultData;
  readonly onDone: () => void;
}) {
  const pageStyles = usePageStyles();
  const [value, setValue] = useState<VaultCreateItem | null>();
  const [failed, setFailed] = useState(false);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  useEffect(() => {
    const controller = new AbortController();
    const close = () => {
      controller.abort();
      done.current();
    };
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") close();
    });
    const timer = setTimeout(close, 5 * 60_000);
    void data
      .read({ id: item.id, updatedAt: item.updatedAt }, controller.signal)
      .then(
        (result) => {
          if (!controller.signal.aborted) setValue(result);
        },
        () => {
          if (!controller.signal.aborted) setFailed(true);
        }
      );
    return () => {
      controller.abort();
      listener.remove();
      clearTimeout(timer);
    };
  }, [data, item.id, item.updatedAt]);
  return (
    <View style={{ gap: 16 }}>
      <Text accessibilityRole="header" style={pageStyles.heading}>
        Edit {item.label}
      </Text>
      {value && (value.kind === "login" || value.kind === "payment") ? (
        <VaultItemForm
          kind={value.kind}
          onSave={(input) => data.update({ item, value: input })}
          initialValue={value}
          onDone={onDone}
        />
      ) : (
        <>
          <Text
            accessibilityRole={failed || value === null ? "alert" : undefined}
          >
            {failed || value === null
              ? "This item changed or could not be opened. Return to saved items and try again."
              : "Opening saved item…"}
          </Text>
          <ActionButton quiet onPress={onDone}>
            Back to item
          </ActionButton>
        </>
      )}
      <Text style={pageStyles.copy}>
        This editor closes when you leave the app or after five minutes.
      </Text>
    </View>
  );
}
