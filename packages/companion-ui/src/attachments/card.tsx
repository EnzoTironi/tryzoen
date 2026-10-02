import { useMemo, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Download, FileText } from "lucide-react-native";
import type { FileUIPart } from "ai";
import { useAttachments } from "./provider";
import { inlineAttachmentSchema } from "./schema";
import { systemFont, useColors } from "../theme";
import { IconButton } from "../icon-button";
import { ResourceCard } from "../cards/resource";
import { CompanionSheet } from "../sheet";

export function AttachmentCard({ file }: { readonly file: FileUIPart }) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const attachments = useAttachments();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [ratio, setRatio] = useState(4 / 3);
  const valid = inlineAttachmentSchema.safeParse(file).success;
  const preview =
    valid &&
    !previewFailed &&
    /^image\/(?:png|jpeg|webp|gif)$/u.test(file.mediaType);
  const player =
    valid && /^(audio|video)\//u.test(file.mediaType)
      ? attachments?.renderMedia?.(file)
      : null;
  const save =
    valid && attachments ? (
      <IconButton
        icon={Download}
        label={`Save ${file.filename ?? "attachment"}`}
        disabled={saving}
        onPress={() => {
          setSaving(true);
          setFailed(false);
          void attachments
            .save(file)
            .catch(() => {
              setFailed(true);
            })
            .finally(() => {
              setSaving(false);
            });
        }}
      />
    ) : null;
  return (
    <View style={styles.container}>
      {preview || player ? (
        <View style={styles.mediaRow}>
          <View
            style={[
              styles.media,
              !!player && file.mediaType.startsWith("audio/") && styles.audio,
            ]}
          >
            {preview ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Ampliar ${file.filename ?? "imagem"}`}
                onPress={() => {
                  setExpanded(true);
                }}
              >
                <Image
                  source={{ uri: file.url }}
                  accessibilityLabel={file.filename ?? "Attached image"}
                  style={{ width: "100%", aspectRatio: ratio }}
                  resizeMode="contain"
                  onLoad={(event) => {
                    const updateRatio = (width: number, height: number) => {
                      if (width > 0 && height > 0)
                        setRatio(Math.max(0.6, Math.min(2, width / height)));
                    };
                    if (Platform.OS === "web")
                      Image.getSize(file.url, updateRatio, () => {
                        setPreviewFailed(true);
                      });
                    else {
                      const { width, height } = event.nativeEvent.source;
                      updateRatio(width, height);
                    }
                  }}
                  onError={() => {
                    setPreviewFailed(true);
                  }}
                />
              </Pressable>
            ) : (
              player
            )}
          </View>
          {save}
        </View>
      ) : (
        <ResourceCard
          title={file.filename ?? "Attachment"}
          detail={
            file.mediaType === "application/pdf"
              ? "PDF"
              : (file.filename?.split(".").pop()?.toUpperCase() ?? "Arquivo")
          }
          icon={FileText}
          tint={file.mediaType === "application/pdf" ? "#e64063" : "#4e87d8"}
          action={save}
        />
      )}
      {failed && (
        <Text accessibilityRole="alert" style={styles.error}>
          The file couldn’t be saved. Try again.
        </Text>
      )}
      {expanded && (
        <CompanionSheet
          title={file.filename ?? "Imagem"}
          onClose={() => {
            setExpanded(false);
          }}
        >
          <Image
            source={{ uri: file.url }}
            accessibilityLabel={file.filename ?? "Imagem"}
            style={styles.expanded}
            resizeMode="contain"
          />
          {save}
        </CompanionSheet>
      )}
    </View>
  );
}
function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { maxWidth: "100%", gap: 6 },
    mediaRow: {
      width: 390,
      maxWidth: "100%",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    media: {
      flex: 1,
      minWidth: 0,
      borderRadius: 24,
      borderCurve: "continuous",
      overflow: "hidden",
      backgroundColor: colors.wash,
    },
    audio: { padding: 5, borderRadius: 30 },
    expanded: { width: "100%", height: 440 },
    error: { fontFamily: systemFont, fontSize: 13, color: colors.danger },
  });
}
