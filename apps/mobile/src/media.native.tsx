import { useI18n, Translated } from "@zoen/companion-ui/i18n";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useVideoPlayer, VideoView } from "expo-video";
import { File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import { Pause, Play, RotateCcw } from "lucide-react-native";
import type { FileUIPart } from "ai";
import { inlineAttachmentSchema } from "@zoen/companion-ui/messages";

function NativeMedia({ file }: { file: FileUIPart }) {
  const { t } = useI18n();
  const [uri, setUri] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(
    () => () => {
      if (!uri) return;
      const temporary = new File(uri);
      if (temporary.exists) temporary.delete();
    },
    [uri]
  );
  if (failed)
    return (
      <Text accessibilityRole="alert">
        {t("Não foi possível abrir o arquivo.")}
      </Text>
    );
  if (!uri)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("Abrir controles de reprodução")}
        style={styles.button}
        onPress={() => {
          try {
            const parsed = inlineAttachmentSchema.parse(file);
            const temporary = new File(Paths.cache, `playback-${randomUUID()}`);
            temporary.write(parsed.url.slice(parsed.url.indexOf(",") + 1), {
              encoding: "base64",
            });
            setUri(temporary.uri);
          } catch {
            setFailed(true);
          }
        }}
      >
        <Play size={24} color="#0866c9" />
      </Pressable>
    );
  return file.mediaType.startsWith("video/") ? (
    <NativeVideo uri={uri} />
  ) : (
    <NativeAudio uri={uri} />
  );
}
function NativeVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return <VideoView player={player} nativeControls style={styles.video} />;
}
function NativeAudio({ uri }: { uri: string }) {
  const { t } = useI18n();
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const Icon = status.playing ? Pause : Play;
  return (
    <View style={styles.audio}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          status.playing ? t("Pausar áudio") : t("Reproduzir áudio")
        }
        style={styles.button}
        onPress={() => {
          if (status.playing) player.pause();
          else {
            if (status.didJustFinish) void player.seekTo(0);
            player.play();
          }
        }}
      >
        <Icon size={24} color="#0866c9" />
      </Pressable>
      <Text accessibilityLiveRegion="none" style={styles.time}>
        <Translated
          message="{value1} / {value2} s"
          values={{
            value1: Math.floor(status.currentTime),
            value2: Math.floor(status.duration),
          }}
        />
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("Voltar ao início")}
        style={styles.button}
        onPress={() => {
          void player.seekTo(0);
        }}
      >
        <RotateCcw size={20} color="#0866c9" />
      </Pressable>
      {status.error && (
        <Text accessibilityRole="alert">
          {t("Não foi possível reproduzir este áudio.")}
        </Text>
      )}
    </View>
  );
}
export function renderMedia(file: FileUIPart) {
  return <NativeMedia file={file} />;
}
const styles = StyleSheet.create({
  video: { width: 300, maxWidth: "100%", height: 200, borderRadius: 12 },
  audio: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  button: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  time: { flex: 1, fontVariant: ["tabular-nums"] },
});
