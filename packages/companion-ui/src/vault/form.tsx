import { useI18n } from "./../i18n";
import { useEffect, useRef, useState } from "react";
import { ZodError } from "zod";
import { AppState, Text, View } from "react-native";
import { ActionButton } from "../button";
import { usePageStyles } from "../page";
import {
  createVaultFormItem,
  loginFormSchema,
  paymentCardFormSchema,
  vaultFormValues,
  type VaultFormDraft,
} from "./forms";
import type { VaultCreateItem } from "./schema";
import { VaultFields } from "./fields";

/** Secret draft never enters query/mutation caches or persistent storage. */
export function VaultItemForm({
  kind,
  onSave,
  onDone,
  initialValue,
  initialLabel = "",
  initialOrigin = "",
  initialIdentifierType = "email",
}: {
  readonly kind: "login" | "payment";
  readonly onSave: (value: VaultCreateItem) => Promise<void | boolean>;
  readonly onDone: () => void;
  readonly initialValue?: VaultCreateItem;
  readonly initialLabel?: string;
  readonly initialOrigin?: string;
  readonly initialIdentifierType?: "email" | "phone" | "username";
}) {
  const { t } = useI18n();
  const pageStyles = usePageStyles();
  const [values, setValues] = useState<VaultFormDraft>({
    nickname: initialLabel,
    origin: initialOrigin,
    identifierType: initialIdentifierType,
    identifier: "",
    password: "",
    totp: "",
    cardholderName: "",
    cardNumber: "",
    expiration: "",
    cvc: "",
    billingPostalCode: "",
    ...(initialValue ? vaultFormValues(initialValue) : {}),
  });
  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [localError, setLocalError] = useState<string>();
  const alive = useRef(true);
  const submitting = useRef(false);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  useEffect(() => {
    alive.current = true;
    const listener = AppState.addEventListener("change", (status) => {
      if (status !== "active") done.current();
    });
    return () => {
      alive.current = false;
      listener.remove();
    };
  }, []);
  useEffect(() => {
    if (!revealed) return undefined;
    const timer = setTimeout(() => {
      setRevealed(false);
    }, 30_000);
    return () => {
      clearTimeout(timer);
    };
  }, [revealed]);
  const result = (
    kind === "login" ? loginFormSchema : paymentCardFormSchema
  ).safeParse(values);
  const submit = async () => {
    setAttempted(true);
    if (!result.success || submitting.current) return;
    let input: ReturnType<typeof createVaultFormItem>;
    try {
      input = createVaultFormItem(kind, values);
    } catch (error) {
      setLocalError(
        error instanceof ZodError
          ? (error.issues[0]?.message ?? "Check the saved details.")
          : "Check the saved details."
      );
      return;
    }
    setLocalError(undefined);
    submitting.current = true;
    setPending(true);
    let conflict = false;
    try {
      conflict = (await onSave(input)) === false;
      if (conflict) throw new Error(t("The saved item changed"));
      if (alive.current) done.current();
    } catch {
      if (alive.current) {
        setValues((current) => ({
          ...current,
          password: "",
          totp: "",
          cardNumber: "",
          cvc: "",
        }));
        setRevealed(false);
        setLocalError(
          conflict
            ? "This saved item changed or was removed. Reopen it before editing again."
            : undefined
        );
        setFailed(true);
      }
    } finally {
      submitting.current = false;
      if (alive.current) setPending(false);
    }
  };
  if (failed)
    return (
      <View style={{ gap: 16 }}>
        <Text accessibilityRole="alert">
          {localError ??
            t(
              "Could not confirm the save. Sensitive fields were cleared. Check saved items before trying again."
            )}
        </Text>
        <ActionButton onPress={onDone}>
          {initialValue ? t("Review saved item") : t("Check saved items")}
        </ActionButton>
      </View>
    );
  return (
    <View style={{ gap: 16 }}>
      <Text style={pageStyles.copy}>
        {initialValue
          ? t(
              "Changes revoke existing access for Zoen. Grant permission again after saving if needed."
            )
          : kind === "login"
            ? t(
                "Saved credentials stay in your vault. Saving does not grant Zoen permission to use them."
              )
            : t(
                "Save card details in your vault. This does not connect a payment provider or authorize purchases."
              )}
      </Text>
      <VaultFields
        kind={kind}
        values={values}
        pending={pending}
        revealed={revealed}
        onChange={(field, value) => {
          setValues((current) => ({ ...current, [field]: value }));
        }}
      />
      <ActionButton
        quiet
        disabled={pending}
        onPress={() => {
          setRevealed((value) => !value);
        }}
      >
        {revealed ? t("Hide sensitive fields") : t("Show sensitive fields")}
      </ActionButton>
      <Text style={pageStyles.copy}>
        {t("Sensitive fields hide again after 30 seconds.")}
      </Text>
      {localError && <Text accessibilityRole="alert">{localError}</Text>}
      {attempted && !result.success && (
        <Text accessibilityRole="alert">
          {result.error.issues[0]?.message ??
            t("Complete the required details.")}
        </Text>
      )}
      <ActionButton
        disabled={pending}
        onPress={() => {
          void submit();
        }}
      >
        {pending
          ? t("Saving…")
          : initialValue
            ? t("Save changes")
            : kind === "login"
              ? t("Save login")
              : t("Save card")}
      </ActionButton>
      <ActionButton quiet disabled={pending} onPress={onDone}>
        {t("Cancel")}
      </ActionButton>
    </View>
  );
}
