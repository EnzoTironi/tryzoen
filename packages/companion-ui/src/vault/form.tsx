import { useEffect, useRef, useState } from "react";
import { ZodError } from "zod";
import { AppState, Text, TextInput, View } from "react-native";
import { ActionButton } from "../button";
import { pageStyles } from "../page";
import {
  createVaultFormItem,
  loginFormSchema,
  paymentCardFormSchema,
} from "./forms";
import type { VaultData } from "./data";

/** Secret draft never enters query/mutation caches or persistent storage. */
export function VaultCreationForm({
  kind,
  data,
  onDone,
  initialLabel = "",
  initialOrigin = "",
  initialIdentifierType = "email",
}: {
  readonly kind: "login" | "payment";
  readonly data: Pick<VaultData, "create">;
  readonly onDone: () => void;
  readonly initialLabel?: string;
  readonly initialOrigin?: string;
  readonly initialIdentifierType?: "email" | "phone" | "username";
}) {
  const [values, setValues] = useState({
    nickname: initialLabel,
    origin: initialOrigin,
    identifierType: initialIdentifierType,
    identifier: "",
    password: "",
    cardholderName: "",
    cardNumber: "",
    expiration: "",
    cvc: "",
    billingPostalCode: "",
  });
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
    try {
      await data.create(input);
      if (alive.current) done.current();
    } catch {
      if (alive.current) {
        setValues((current) => ({
          ...current,
          password: "",
          cardNumber: "",
          cvc: "",
        }));
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
          Could not confirm the save. Sensitive fields were cleared. Check saved
          items before creating it again.
        </Text>
        <ActionButton onPress={onDone}>Check saved items</ActionButton>
      </View>
    );
  const fields: readonly (readonly [keyof typeof values, string, boolean?])[] =
    kind === "login"
      ? [
          ["nickname", "Name"],
          ["origin", "Website"],
          ["identifier", "Sign-in identifier"],
          ["password", "Password", true],
        ]
      : [
          ["nickname", "Nickname (optional)"],
          ["cardholderName", "Name on card"],
          ["cardNumber", "Card number", true],
          ["expiration", "Expiration (MM / YY)"],
          ["cvc", "CVC", true],
          ["billingPostalCode", "Billing ZIP / postal"],
        ];
  return (
    <View style={{ gap: 16 }}>
      <Text style={pageStyles.copy}>
        {kind === "login"
          ? "Saved credentials stay in your vault. Saving does not grant Zoen permission to use them."
          : "Save card details in your vault. This does not connect a payment provider or authorize purchases."}
      </Text>
      {kind === "login" && (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["email", "phone", "username"] as const).map((value) => (
            <ActionButton
              key={value}
              quiet
              disabled={pending || values.identifierType === value}
              onPress={() => {
                setValues((current) => ({ ...current, identifierType: value }));
              }}
            >
              {value}
            </ActionButton>
          ))}
        </View>
      )}
      {fields.map(([field, label, secret]) => (
        <View key={field} style={{ gap: 6 }}>
          <Text>{label}</Text>
          <TextInput
            accessibilityLabel={label}
            value={values[field]}
            editable={!pending}
            secureTextEntry={secret}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            maxLength={field === "password" ? 20_000 : 2048}
            onChangeText={(value) => {
              setValues((current) => ({ ...current, [field]: value }));
            }}
            style={{
              borderRadius: 12,
              backgroundColor: "#f1f1f2",
              padding: 12,
              color: "#171717",
              fontSize: 16,
            }}
          />
        </View>
      ))}
      {localError && <Text accessibilityRole="alert">{localError}</Text>}
      {attempted && !result.success && (
        <Text accessibilityRole="alert">
          {result.error.issues[0]?.message ?? "Complete the required details."}
        </Text>
      )}
      <ActionButton
        disabled={pending}
        onPress={() => {
          void submit();
        }}
      >
        {pending ? "Saving…" : kind === "login" ? "Save login" : "Save card"}
      </ActionButton>
      <ActionButton quiet disabled={pending} onPress={onDone}>
        Cancel
      </ActionButton>
    </View>
  );
}
