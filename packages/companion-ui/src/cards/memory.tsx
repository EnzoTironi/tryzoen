import { useI18n } from "./../i18n";
import type { ReactNode } from "react";
import { NotebookPen } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { AssistantMarkdown } from "../markdown";
import type { MemoryDocumentView } from "../personal-memory";
import { ResourceCard } from "./resource";

/** Private note previews share the document card without loading remote images. */
export function MemoryCard({
  document,
  action,
  children,
}: {
  readonly document: Pick<MemoryDocumentView, "title" | "text" | "updated">;
  readonly action?: ReactNode;
  readonly children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <ResourceCard
      title={document.title}
      detail={
        document.updated
          ? t("Updated {date}", { date: document.updated })
          : undefined
      }
      icon={NotebookPen}
      action={action}
      style={styles.card}
    >
      <View style={styles.body}>
        <AssistantMarkdown
          text={document.text || t("No notes in this document.")}
          allowImages={false}
        />
      </View>
      {children}
    </ResourceCard>
  );
}

const styles = StyleSheet.create({
  card: { width: "100%", marginTop: 16 },
  body: { paddingHorizontal: 2 },
});
