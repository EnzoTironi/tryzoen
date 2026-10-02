import { useI18n } from "./../i18n";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pressable, StyleSheet } from "react-native";
import { FileText, Image, Music, Video, Download } from "lucide-react-native";
import type { z } from "zod";
import type { RoomData, roomMessageSchema } from "./schema";
import { AttachmentCard } from "../attachments/card";
import { useColors } from "../theme";
import { ResourceCard } from "../cards/resource";

export function RoomAttachment({
  item,
  data,
  roomId,
  cacheScope,
}: {
  item: z.infer<typeof roomMessageSchema>;
  data: Pick<RoomData, "media">;
  roomId: string;
  cacheScope: string;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const [opened, setOpened] = useState(false);
  const file = useQuery({
    queryKey: ["matrix-media", cacheScope, roomId, item.id],
    queryFn: () => data.media({ id: roomId, messageId: item.id }),
    enabled: opened,
    gcTime: 60_000,
    staleTime: 0,
    retry: false,
  });
  if (!item.media) return null;
  if (file.data && !file.isError) return <AttachmentCard file={file.data} />;
  const Icon = item.media.mediaType.startsWith("audio/")
    ? Music
    : item.media.mediaType.startsWith("video/")
      ? Video
      : item.media.mediaType.startsWith("image/")
        ? Image
        : FileText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("Abrir {value1}", { value1: item.media.filename })}
      disabled={file.isFetching}
      style={styles.card}
      onPress={() => {
        if (opened) void file.refetch();
        else setOpened(true);
      }}
    >
      <ResourceCard
        title={item.media.filename}
        icon={Icon}
        detail={
          file.isFetching
            ? t("Carregando…")
            : file.isError
              ? t("Não foi possível abrir. Toque para tentar novamente.")
              : item.media.size === undefined
                ? t("Toque para abrir")
                : `${Math.max(1, Math.round(item.media.size / 1024))} KB · Toque para abrir`
        }
        action={<Download size={20} color={colors.muted} />}
      />
    </Pressable>
  );
}
const styles = StyleSheet.create({
  card: { maxWidth: "100%", borderRadius: 24 },
});
