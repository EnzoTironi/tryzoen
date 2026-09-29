import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { colors } from "../theme";
import type { VaultFormDraft } from "./forms";

const autofill: Partial<
  Record<keyof VaultFormDraft, TextInputProps["autoComplete"]>
> = {
  password: "new-password",
  cardholderName: "cc-name",
  cardNumber: "cc-number",
  expiration: "cc-exp",
  cvc: "cc-csc",
};

export function VaultFields({
  kind,
  values,
  pending,
  revealed,
  onChange,
}: {
  readonly kind: "login" | "payment";
  readonly values: VaultFormDraft;
  readonly pending: boolean;
  readonly revealed: boolean;
  readonly onChange: (field: keyof VaultFormDraft, value: string) => void;
}) {
  const fields: readonly (readonly [keyof VaultFormDraft, string, boolean?])[] =
    kind === "login"
      ? [
          ["nickname", "Name"],
          ["origin", "Website"],
          ["identifier", "Sign-in identifier"],
          ["password", "Password", true],
          ["totp", "Authenticator key (optional)", true],
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
    <View style={{ gap: 14 }}>
      {kind === "login" && (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Sign-in identifier type"
          style={styles.picker}
        >
          {(["email", "phone", "username"] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityLabel={value}
              accessibilityState={{
                checked: values.identifierType === value,
                disabled: pending,
              }}
              disabled={pending}
              onPress={() => {
                onChange("identifierType", value);
              }}
              style={({ pressed }) => [
                styles.option,
                values.identifierType === value && styles.selected,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={styles.optionText}>{value}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {fields.map(([field, label, secret]) => (
        <View key={field} style={{ gap: 6 }}>
          <Text style={styles.label}>{label}</Text>
          <TextInput
            accessibilityLabel={label}
            nativeID={`vault-${field}`}
            value={values[field]}
            editable={!pending}
            secureTextEntry={secret && !revealed}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={autofill[field] ?? "off"}
            maxLength={field === "password" ? 20_000 : 2048}
            onChangeText={(value) => {
              onChange(field, value);
            }}
            style={styles.input}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  picker: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 15,
    backgroundColor: colors.wash,
  },
  option: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
  },
  selected: {
    backgroundColor: colors.surface,
    boxShadow: "0 1px 4px rgba(0,0,0,0.10)",
  },
  optionText: { color: colors.ink, fontSize: 14, fontWeight: "500" },
  label: { color: colors.ink, fontSize: 14 },
  input: {
    borderRadius: 12,
    backgroundColor: colors.wash,
    padding: 12,
    color: colors.ink,
    fontSize: 16,
  },
});
