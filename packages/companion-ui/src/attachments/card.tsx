import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { Download, FileText } from "lucide-react-native";
import type { FileUIPart } from "ai";
import { useAttachments } from "./provider";
import { inlineAttachmentSchema } from "./schema";
import { colors } from "../theme";
import { IconButton } from "../icon-button";

export function AttachmentCard({ file }: { readonly file: FileUIPart }) {
  const attachments = useAttachments();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const valid = inlineAttachmentSchema.safeParse(file).success;
  const preview =
    valid && /^image\/(?:png|jpeg|webp|gif)$/u.test(file.mediaType);
  return (
    <View style={styles.card}>
      {preview && !previewFailed && (
        <Image
          source={{ uri: file.url }}
          accessibilityLabel={file.filename ?? "Attached image"}
          style={styles.image}
          resizeMode="contain"
          onError={() => {
            setPreviewFailed(true);
          }}
        />
      )}
      <View style={styles.row}>
        <FileText size={22} color={colors.muted} />
        <View style={styles.name}>
          <Text numberOfLines={2} style={styles.title}>
            {file.filename ?? "Attachment"}
          </Text>
          <Text style={styles.caption}>{file.mediaType}</Text>
        </View>
        {valid && attachments && (
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
        )}
      </View>
      {failed && (
        <Text accessibilityRole="alert" style={styles.error}>
          The file couldn’t be saved. Try again.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 8,
    borderRadius: 20,
    padding: 10,
    backgroundColor: colors.wash,
    maxWidth: 340,
  },
  image: { width: 300, maxWidth: "100%", height: 180, borderRadius: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontSize: 15, color: colors.ink },
  caption: { fontSize: 12, color: colors.muted },
  error: { fontSize: 13, color: colors.danger },
});
