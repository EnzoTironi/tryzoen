import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { systemFont, useColors } from "../theme";
import { localeNames, localeSchema, type Locale } from "./locale";
import { useI18n } from "./context";

export function LanguageOptions({
  onChange,
}: {
  readonly onChange: (locale: Locale) => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const colors = useColors();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <Text
        accessibilityRole="header"
        style={{
          fontFamily: systemFont,
          fontSize: 15,
          fontWeight: "600",
          color: colors.ink,
        }}
      >
        {t("Idioma")}
      </Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("Idioma")}
        style={{ gap: 4 }}
      >
        {localeSchema.options.map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            aria-checked={value === locale}
            aria-disabled={pending}
            accessibilityState={{
              checked: value === locale,
              disabled: pending,
            }}
            disabled={pending}
            onPress={() => {
              if (value === locale) return;
              setPending(true);
              setFailed(false);
              void onChange(value)
                .catch(() => {
                  setFailed(true);
                })
                .finally(() => {
                  setPending(false);
                });
            }}
            style={{
              minHeight: 44,
              paddingHorizontal: 12,
              borderRadius: 10,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: value === locale ? colors.wash : colors.surface,
            }}
          >
            <Text
              style={{
                fontFamily: systemFont,
                color: colors.ink,
                fontSize: 15,
              }}
            >
              {localeNames[value]}
            </Text>
            {value === locale && (
              <View
                accessible={false}
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Check size={18} color={colors.accent} />
              </View>
            )}
          </Pressable>
        ))}
      </View>
      {failed && (
        <Text
          accessibilityRole="alert"
          style={{ fontFamily: systemFont, color: colors.danger }}
        >
          {t("Não foi possível salvar o idioma. Tente novamente.")}
        </Text>
      )}
    </View>
  );
}
