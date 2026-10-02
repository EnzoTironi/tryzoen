import { useI18n } from "./../i18n";
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Flag, CheckCircle2 } from "lucide-react-native";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { z } from "zod";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import { systemFont, useColors } from "../theme";
import type { RoomData, roomMessageSchema } from "./schema";

const reasons = [
  "Spam ou golpe",
  "Assédio",
  "Conteúdo perigoso",
  "Outro motivo",
];

export function ReportRoomMessage({
  data,
  roomId,
  item,
  onClose,
}: {
  readonly data: Pick<RoomData, "reportMessage">;
  readonly roomId: string;
  readonly item: z.infer<typeof roomMessageSchema>;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [category, setCategory] = useState<string>();
  const [details, setDetails] = useState("");
  const report = useMutation({
    retry: false,
    networkMode: "always",
    mutationFn: () =>
      data.reportMessage({
        id: roomId,
        messageId: item.id,
        expectedRevision: item.editId ?? item.id,
        reason: `${category ?? ""}${details.trim() ? `: ${details.trim()}` : ""}`,
      }),
  });
  const status = report.data?.status;
  const feedback =
    status &&
    {
      submitted:
        "Sua denúncia foi recebida para análise. A mensagem continua na conversa; denunciar não bloqueia a pessoa.",
      uncertain:
        "Não foi possível confirmar o recebimento. Para evitar duplicação, esta denúncia não será reenviada automaticamente.",
      limited:
        "Você atingiu o limite de denúncias nas últimas 24 horas. Tente novamente mais tarde.",
      changed:
        "A mensagem foi alterada. Feche este painel e confira a versão atual antes de denunciar.",
    }[status];
  return (
    <CompanionSheet
      title={t("Denunciar mensagem")}
      maxWidth={480}
      onClose={onClose}
    >
      {feedback ? (
        <View style={styles.content}>
          {status === "submitted" ? (
            <CheckCircle2 size={28} color={"#248a3d"} />
          ) : (
            <Flag size={28} color={colors.muted} />
          )}
          <Text accessibilityLiveRegion="polite" style={styles.description}>
            {feedback}
          </Text>
          <ActionButton onPress={onClose}>{t("Concluir")}</ActionButton>
        </View>
      ) : (
        <View style={styles.content}>
          <View style={styles.preview}>
            <Text style={styles.author}>{item.sender}</Text>
            <Text numberOfLines={4} style={styles.previewText}>
              {item.text.trim()
                ? item.text
                : (item.media?.filename ?? t("Anexo"))}
            </Text>
          </View>
          <Text style={styles.description}>
            {t(
              "A mensagem selecionada, sua autoria e o motivo serão enviados à moderação do serviço. Nenhuma outra mensagem será anexada."
            )}
          </Text>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={t("Motivo da denúncia")}
            style={styles.reasons}
          >
            {reasons.map((reason) => (
              <Pressable
                key={reason}
                accessibilityRole="radio"
                aria-checked={category === reason}
                onPress={() => {
                  setCategory(reason);
                }}
                disabled={report.isPending}
                style={[styles.reason, category === reason && styles.selected]}
              >
                <Text
                  style={[
                    styles.reasonText,
                    category === reason && styles.selectedText,
                  ]}
                >
                  {reason}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            accessibilityLabel={t("Detalhes da denúncia")}
            placeholder={t("Conte mais (opcional)")}
            placeholderTextColor={colors.muted}
            multiline
            maxLength={1500}
            value={details}
            onChangeText={setDetails}
            editable={!report.isPending}
            style={styles.input}
          />
          {report.isError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {t(
                "Não foi possível confirmar o envio. Você pode tentar novamente; denúncias já iniciadas não são duplicadas."
              )}
            </Text>
          )}
          <ActionButton
            disabled={
              !category ||
              report.isPending ||
              (category === "Outro motivo" && !details.trim())
            }
            onPress={() => {
              if (category && !report.isPending) report.mutate();
            }}
          >
            {report.isPending ? t("Enviando…") : t("Enviar denúncia")}
          </ActionButton>
          <ActionButton quiet onPress={onClose}>
            {t("Cancelar")}
          </ActionButton>
        </View>
      )}
    </CompanionSheet>
  );
}
function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    content: { gap: 16 },
    preview: {
      gap: 6,
      padding: 14,
      backgroundColor: colors.wash,
      borderRadius: 18,
    },
    author: {
      fontFamily: systemFont,
      fontSize: 13,
      fontWeight: "600",
      color: colors.ink,
    },
    previewText: {
      fontFamily: systemFont,
      fontSize: 14,
      lineHeight: 20,
      color: colors.muted,
    },
    description: {
      fontFamily: systemFont,
      fontSize: 14,
      lineHeight: 20,
      color: colors.muted,
    },
    reasons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    reason: {
      paddingHorizontal: 14,
      minHeight: 44,
      justifyContent: "center",
      borderRadius: 22,
      backgroundColor: colors.wash,
    },
    selected: { backgroundColor: colors.ink },
    reasonText: { fontFamily: systemFont, fontSize: 14, color: colors.ink },
    selectedText: { color: colors.surface },
    input: {
      fontFamily: systemFont,
      minHeight: 88,
      padding: 14,
      borderRadius: 18,
      backgroundColor: colors.wash,
      color: colors.ink,
      fontSize: 15,
      textAlignVertical: "top",
    },
    error: {
      fontFamily: systemFont,
      fontSize: 13,
      lineHeight: 18,
      color: colors.danger,
    },
  });
}
