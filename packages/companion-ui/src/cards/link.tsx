import { useI18n } from "./../i18n";
import { useMemo, useState } from "react";
import {
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Globe, ImagePlus } from "lucide-react-native";
import { systemFont, useColors } from "../theme";
import { IconButton } from "../icon-button";
import { isSafeWebLink } from "../links";
import { useLinkPreviews } from "./provider";
import { ResourceCard } from "./resource";
import { messageLinks } from "./links";

export function MessageLinks({ text }: { text: string }) {
  return messageLinks(text).map((url) => <LinkCard key={url} url={url} />);
}
export function LinkCard({ url, title }: { url: string; title?: string }) {
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const source = useLinkPreviews();
  const [load, setLoad] = useState(false);
  const [failed, setFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const safe = isSafeWebLink(url);
  const preview = useQuery({
    queryKey: ["link-preview", source?.cacheScope, url],
    queryFn: () => {
      if (!source) throw new Error(t("Preview unavailable"));
      return source.load(url);
    },
    enabled: !!source && safe && load,
    staleTime: 300_000,
    gcTime: 300_000,
    retry: false,
  });
  if (!safe) return <Text>{title ?? url}</Text>;
  const domain = new URL(url).hostname.replace(/^www\./u, "");
  const open = () => {
    setFailed(false);
    void Linking.openURL(url).catch(() => {
      setFailed(true);
    });
  };
  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t("Abrir {value1}", {
          value1: title ?? preview.data?.title ?? domain,
        })}
        onPress={open}
        style={styles.card}
      >
        {!!preview.data?.image && !imageFailed && (
          <Image
            source={{ uri: preview.data.image }}
            style={styles.image}
            resizeMode="cover"
            onError={() => {
              setImageFailed(true);
            }}
            accessibilityLabel={t("Prévia do link")}
          />
        )}
        <ResourceCard
          title={title ?? preview.data?.title ?? domain}
          detail={domain}
          icon={Globe}
          tint="#7f93a7"
          action={<ArrowUpRight size={20} color={colors.muted} />}
        >
          {!!preview.data?.description && (
            <Text style={styles.description} numberOfLines={2}>
              {preview.data.description}
            </Text>
          )}
        </ResourceCard>
      </Pressable>
      {source && url.startsWith("https:") && !preview.data && (
        <View style={styles.preview}>
          <IconButton
            icon={ImagePlus}
            label={
              preview.isError
                ? t("Tentar carregar prévia novamente")
                : t("Carregar prévia do link")
            }
            disabled={preview.isFetching}
            onPress={() => {
              if (load) void preview.refetch();
              else setLoad(true);
            }}
          />
          <Text style={styles.caption}>
            {preview.isFetching
              ? t("Carregando prévia…")
              : preview.isError
                ? t("Prévia indisponível")
                : t("Carregar prévia")}
          </Text>
        </View>
      )}
      {failed && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("Não foi possível abrir o link.")}
        </Text>
      )}
    </View>
  );
}
function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { width: 340, maxWidth: "100%", gap: 2 },
    card: {
      overflow: "hidden",
      borderRadius: 24,
      backgroundColor: colors.wash,
    },
    image: { width: "100%", aspectRatio: 1.8 },
    description: {
      fontFamily: systemFont,
      fontSize: 14,
      lineHeight: 20,
      color: colors.muted,
    },
    preview: { flexDirection: "row", alignItems: "center" },
    caption: { fontFamily: systemFont, fontSize: 12, color: colors.muted },
    error: { fontFamily: systemFont, fontSize: 13, color: colors.danger },
  });
}
