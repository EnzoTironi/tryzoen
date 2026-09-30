import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { ActionButton } from "../button";
import { usePageStyles } from "../page";
import type { VaultData } from "./data";
import type { VaultItem } from "./schema";
import { VaultItemEditor } from "./editor";

export function VaultItemDetails({
  item,
  data,
  onChanged,
  mayManage,
  pending,
  onRemove,
  onBack,
  renderPermission,
}: {
  readonly item: VaultItem;
  readonly data: VaultData;
  readonly onChanged: () => void;
  readonly mayManage: boolean;
  readonly pending: boolean;
  readonly onRemove: () => void;
  readonly onBack: () => void;
  readonly renderPermission?: (id: string) => ReactNode;
}) {
  const pageStyles = usePageStyles();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (editing && mayManage)
    return (
      <VaultItemEditor
        item={item}
        data={data}
        onDone={() => {
          setEditing(false);
          onChanged();
        }}
      />
    );
  return (
    <View style={{ gap: 16 }}>
      <Text accessibilityRole="header" style={pageStyles.heading}>
        {item.label}
      </Text>
      <Text style={pageStyles.copy}>{item.account}</Text>
      <Text style={pageStyles.copy}>
        Saved {new Date(item.createdAt).toLocaleDateString()}. Secrets are not
        displayed here.
      </Text>
      {mayManage && item.hasSecret && !confirming && (
        <ActionButton
          onPress={() => {
            setEditing(true);
          }}
        >
          Edit saved item
        </ActionButton>
      )}
      {item.hasSecret && renderPermission?.(item.id)}
      {mayManage &&
        (confirming ? (
          <>
            <Text>
              Remove this saved item and revoke its existing grants? This cannot
              be undone.
            </Text>
            <ActionButton
              disabled={pending}
              onPress={() => {
                onRemove();
              }}
            >
              {pending ? "Removing…" : "Confirm removal"}
            </ActionButton>
            <ActionButton
              quiet
              disabled={pending}
              onPress={() => {
                setConfirming(false);
              }}
            >
              Keep item
            </ActionButton>
          </>
        ) : (
          <ActionButton
            quiet
            onPress={() => {
              setConfirming(true);
            }}
          >
            Remove saved item
          </ActionButton>
        ))}
      <ActionButton
        quiet
        disabled={pending}
        onPress={() => {
          onBack();
        }}
      >
        Back to saved items
      </ActionButton>
    </View>
  );
}
