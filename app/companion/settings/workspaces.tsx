"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, WorkspaceCreation } from "@zoen/companion-ui";
import { useI18n } from "@zoen/companion-ui/i18n";
import { api } from "@web/trpc/client";
import { WorkspaceSwitcher } from "@app/(authenticated)/_components/workspace-switcher";

export function SettingsWorkspaces() {
  const { t } = useI18n();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const attempt = useRef<{ name: string; operationId: string } | undefined>(
    undefined
  );
  const create = api.workspaces.create.useMutation({
    retry: false,
    networkMode: "always",
  });
  return (
    <>
      <WorkspaceSwitcher />
      <ActionButton
        quiet
        onPress={() => {
          attempt.current = undefined;
          setCreating(true);
        }}
      >
        {t("Criar espaço")}
      </ActionButton>
      {creating && (
        <WorkspaceCreation
          onCreate={async (name) => {
            if (attempt.current?.name !== name)
              attempt.current = { name, operationId: crypto.randomUUID() };
            return (await create.mutateAsync(attempt.current)).workspaceId;
          }}
          onCreated={(workspaceId) => {
            setCreating(false);
            router.push(`/?space=${encodeURIComponent(workspaceId)}`, {
              scroll: false,
            });
          }}
          onClose={() => {
            setCreating(false);
          }}
        />
      )}
    </>
  );
}
