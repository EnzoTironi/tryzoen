import { useState } from "react";
import { Text } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { CreatorStudioData } from "./studio";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import { pageStyles } from "../page";
import { CreatorReleaseReview } from "./release-review";
import { CreatorRelease } from "./release";

export function CreatorReleases({
  draftId,
  data,
  cacheScope,
  archived,
  onClose,
}: {
  readonly draftId: string;
  readonly data: CreatorStudioData;
  readonly cacheScope: string;
  readonly archived: boolean;
  readonly onClose: () => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [selected, setSelected] = useState<string>();
  const versions = useQuery({
    queryKey: ["creator-releases", cacheScope, draftId],
    queryFn: () => data.releases(draftId),
  });
  return (
    <CompanionSheet title="Approved versions" onClose={onClose}>
      <Text style={pageStyles.copy}>
        Keep a reviewed version with its playbook, selected examples, completed
        evaluations and approval notes. These versions remain private.
      </Text>
      {!archived && (
        <ActionButton
          onPress={() => {
            setReviewing(true);
          }}
        >
          Review current version
        </ActionButton>
      )}
      {versions.isPending && (
        <Text style={pageStyles.copy}>Loading approved versions…</Text>
      )}
      {versions.isError && (
        <>
          <Text accessibilityRole="alert" style={pageStyles.copy}>
            Approved versions could not be loaded.
          </Text>
          <ActionButton
            onPress={() => {
              void versions.refetch();
            }}
          >
            Try again
          </ActionButton>
        </>
      )}
      {versions.data?.length === 0 && (
        <Text style={pageStyles.copy}>No approved versions yet.</Text>
      )}
      {!versions.isError &&
        versions.data?.map((version) => (
          <ActionButton
            key={version.id}
            quiet
            onPress={() => {
              setSelected(version.id);
            }}
          >
            {`Approved ${new Date(version.createdAt).toLocaleString()}`}
          </ActionButton>
        ))}
      {reviewing && (
        <CreatorReleaseReview
          draftId={draftId}
          data={data}
          cacheScope={cacheScope}
          onClose={() => {
            setReviewing(false);
          }}
          onApproved={(id) => {
            setReviewing(false);
            setSelected(id);
            void versions.refetch();
          }}
        />
      )}
      {selected && (
        <CreatorRelease
          id={selected}
          data={data}
          cacheScope={cacheScope}
          onClose={() => {
            setSelected(undefined);
          }}
        />
      )}
    </CompanionSheet>
  );
}
