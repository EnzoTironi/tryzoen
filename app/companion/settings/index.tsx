"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { SettingsPanel, type SettingsPage } from "@zoen/companion-ui";
import { authClient } from "@web/auth/client";
import { useI18n } from "@web/i18n/context";
import { LanguagePicker } from "@web/i18n/language-picker";
import { ModelConnections } from "@app/(authenticated)/_components/model-connections";
import { WorkspaceSwitcher } from "@app/(authenticated)/_components/workspace-switcher";
import { AccountPrivacyWipeSection } from "@app/(authenticated)/account/(overview)/_components/privacy-wipe-section";
import { ConnectedMemory } from "../agent-panel";
import { SettingsConnections } from "./connections";
import { SettingsDevices } from "./devices";
import { SettingsPermissions } from "./permissions";
import { SettingsVault } from "./vault";
import { ConnectedCreatorStudio } from "./creators";

export function ConnectedSettings({
  onClose,
  onPrompt,
}: {
  readonly onClose: () => void;
  readonly onPrompt: (text: string) => void;
}) {
  const { t } = useI18n();
  const [page, setPage] = useState<SettingsPage>();
  const signOut = useMutation({
    mutationFn: async () => {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message);
      window.location.assign("/sign-in?callbackUrl=%2Fcompanion");
    },
  });
  return (
    <SettingsPanel
      page={page}
      onSelect={setPage}
      onBack={() => {
        setPage(undefined);
      }}
      onClose={onClose}
      onSignOut={() => {
        signOut.mutate();
      }}
      signingOut={signOut.isPending}
      error={signOut.error ? t("Could not sign out. Try again.") : undefined}
      translate={t}
    >
      <div className="space-y-6 pb-4">
        <SettingsContent
          page={page}
          onPrompt={(text) => {
            onClose();
            onPrompt(text);
          }}
        />
      </div>
    </SettingsPanel>
  );
}

function SettingsContent({
  page,
  onPrompt,
}: {
  readonly page?: SettingsPage;
  readonly onPrompt: (text: string) => void;
}) {
  const { t } = useI18n();
  switch (page) {
    case "general":
      return (
        <>
          <WorkspaceSwitcher />
          <LanguagePicker />
          <ModelConnections />
          <ConnectedCreatorStudio />
        </>
      );
    case "connectors":
      return <SettingsConnections />;
    case "channels":
      return <SettingsConnections channels />;
    case "wallet":
      return <SettingsVault wallet />;
    case "vault":
      return <SettingsVault />;
    case "permissions":
      return <SettingsPermissions />;
    case "devices":
      return <SettingsDevices />;
    case "data":
      return (
        <>
          <ConnectedMemory onPrompt={onPrompt} />
          <AccountPrivacyWipeSection />
        </>
      );
    case "help":
      return (
        <>
          <h2 className="type-section-title">{t("Help with Zoen")}</h2>
          <p className="type-supporting-body text-muted-foreground">
            {t(
              "Find guidance or report a problem. Only include information you want to share publicly in a GitHub issue."
            )}
          </p>
          <a
            className="block type-label underline"
            href="/docs"
            target="_blank"
            rel="noreferrer"
          >
            {t("Help center")}
          </a>
          <a
            className="block type-label underline"
            href="https://github.com/EnzoTironi/tryzoen/issues"
            target="_blank"
            rel="noreferrer"
          >
            {t("Report an issue")}
          </a>
        </>
      );
    case "legal":
      return (
        <>
          <h2 className="type-section-title">{t("About Zoen")}</h2>
          <p className="type-supporting-body text-muted-foreground">
            {t(
              "Zoen uses AI and can make mistakes. Review important information and requested actions before relying on them."
            )}
          </p>
          <p className="type-supporting-body text-muted-foreground">
            {t(
              "Connected services have their own terms and privacy policies. Review them when connecting an account."
            )}
          </p>
          <a
            className="block type-label underline"
            href="https://github.com/EnzoTironi/tryzoen"
            target="_blank"
            rel="noreferrer"
          >
            {t("Source code and license")}
          </a>
        </>
      );
    default:
      return null;
  }
}
