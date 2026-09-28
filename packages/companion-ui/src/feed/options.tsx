import { useState } from "react";
import type { z } from "zod";
import { Text } from "react-native";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import { pageStyles } from "../page";
import { colors } from "../theme";
import type { feedPostSchema } from "./schema";

export function FeedOptions({
  post,
  pending,
  error,
  onDelete,
  onClose,
}: {
  readonly post: z.infer<typeof feedPostSchema>;
  readonly pending: boolean;
  readonly error?: string;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <CompanionSheet
      title={confirm ? "Delete this post?" : "About this post"}
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <Text style={pageStyles.rowTitle}>{post.title}</Text>
      {confirm ? (
        <Text style={pageStyles.copy}>
          This permanently removes the post from your Feed. Conversations about
          it are kept.
        </Text>
      ) : (
        <>
          <Text style={pageStyles.copy}>
            Published {new Date(post.createdAt).toLocaleString()}
          </Text>
          <Text style={pageStyles.rowTitle}>Why this was created</Text>
          <Text style={pageStyles.copy}>{post.rationale}</Text>
        </>
      )}
      {error && (
        <Text accessibilityRole="alert" style={{ color: colors.danger }}>
          {error}
        </Text>
      )}
      <ActionButton
        quiet
        disabled={pending}
        onPress={() => {
          if (confirm) onDelete();
          else setConfirm(true);
        }}
      >
        {pending ? "Deleting…" : "Delete post"}
      </ActionButton>
      {confirm && (
        <ActionButton
          quiet
          disabled={pending}
          onPress={() => {
            setConfirm(false);
          }}
        >
          Keep post
        </ActionButton>
      )}
    </CompanionSheet>
  );
}
