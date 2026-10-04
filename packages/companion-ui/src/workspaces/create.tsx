import { useEffect, useRef, useState } from "react";
import { Text, TextInput } from "react-native";
import { ActionButton } from "../button";
import { useI18n } from "../i18n";
import { usePageStyles } from "../page";
import { CompanionSheet } from "../sheet";

export function WorkspaceCreation({
  onCreate,
  onCreated,
  onClose,
}: {
  readonly onCreate: (name: string) => Promise<string>;
  readonly onCreated: (workspaceId: string) => void;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const styles = usePageStyles();
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "pending" | "failed">("idle");
  const submitting = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const create = async () => {
    const title = name.trim();
    if (!title || title.length > 80 || submitting.current) return;
    submitting.current = true;
    setStatus("pending");
    try {
      const workspaceId = await onCreate(title);
      if (alive.current) onCreated(workspaceId);
    } catch {
      if (alive.current) setStatus("failed");
    } finally {
      submitting.current = false;
    }
  };
  const pending = status === "pending";
  const close = () => {
    if (!submitting.current) onClose();
  };
  return (
    <CompanionSheet title={t("Criar espaço")} onClose={close}>
      <Text style={styles.copy}>{t("Um espaço para sua equipe.")}</Text>
      <TextInput
        accessibilityLabel={t("Nome da equipe")}
        placeholder={t("Nome da equipe")}
        value={name}
        onChangeText={(value) => {
          setName(value);
          setStatus("idle");
        }}
        editable={!pending}
        maxLength={80}
        returnKeyType="done"
        onSubmitEditing={() => {
          void create();
        }}
        style={styles.field}
      />
      {status === "failed" && (
        <Text accessibilityRole="alert" style={styles.copy}>
          {t("Não foi possível criar o espaço. Tente novamente.")}
        </Text>
      )}
      <ActionButton
        disabled={!name.trim() || pending}
        onPress={() => {
          void create();
        }}
      >
        {pending ? t("Criando…") : t("Criar espaço")}
      </ActionButton>
      <ActionButton quiet disabled={pending} onPress={close}>
        {t("Cancelar")}
      </ActionButton>
    </CompanionSheet>
  );
}
